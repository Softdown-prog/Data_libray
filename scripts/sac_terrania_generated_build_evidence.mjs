/**
 * SAC-PRE002: consumer of a pinned Terrania Angular build on an ephemeral CI runner.
 * The workflow performs the build first; this script inspects its generated file.
 * The regular real-snapshot audit remains read-only and never executes project code.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {lstat, readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeImportGraph} from '../packages/angular-precompiler/src/dependency-graph.mjs';

const require = createRequire(new URL('../packages/angular-postcompiler/smoke/package.json', import.meta.url));
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = path.join(root, '.sac-snapshots', 'terrania');
const sourceRoot = path.join(snapshot, 'src');
const generatedPath = 'src/app/runtime-config.ts';
const generatorPath = 'scripts/write-runtime-config.mjs';
const pinnedSha = '6ce58c1687ad21c1d3e01dc87061751ca07a09f1';
const pinnedGeneratorBlob = '036b8e812fb0d7c423d270c64c7fcca284fb04a8';
const expectedGenerated = 'export const runtimeConfig = {"multiplayerUrl":"","presenceUrl":""} as const;\n';
const maxFileBytes = 512 * 1024;
const maxTotalBytes = 2 * 1024 * 1024;
const readBounded = async (file, max = maxFileBytes) => {
  const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= max, 'sac-invalid-snapshot-file');
  const source = await readFile(file, 'utf8');
  assert.ok(Buffer.byteLength(source, 'utf8') <= max, 'sac-oversize-snapshot-file');
  return source;
};
const gitBlob = content => createHash('sha1')
  .update('blob ' + Buffer.byteLength(content, 'utf8') + '\0')
  .update(content).digest('hex');
const digest = content => createHash('sha256').update(content).digest('hex');

async function collectFiles() {
  let count = 0, bytes = 0;
  const files = [];
  async function visit(directory) {
    assert.ok(++count <= 256, 'sac-too-many-directories');
    const children = await readdir(directory, {withFileTypes: true});
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of children) {
      const absolute = path.join(directory, entry.name);
      assert.ok(absolute.startsWith(sourceRoot + path.sep), 'sac-path-outside-snapshot');
      assert.ok(!entry.isSymbolicLink(), 'sac-snapshot-symlink');
      if (entry.isDirectory()) {
        assert.notEqual(entry.name, 'node_modules', 'sac-dependency-tree-in-source');
        await visit(absolute);
      } else {
        assert.ok(entry.isFile(), 'sac-invalid-snapshot-entry');
        if (!/\.tsx?$/.test(entry.name)) continue;
        const relative = path.relative(snapshot, absolute).split(path.sep).join('/');
        const source = await readBounded(absolute);
        bytes += Buffer.byteLength(source, 'utf8');
        assert.ok(bytes <= maxTotalBytes && files.length < 128, 'sac-too-many-sources');
        files.push({path: relative, source});
      }
    }
  }
  await visit(sourceRoot);
  return files;
}

const revision = execFileSync('git', ['-C', snapshot, 'rev-parse', 'HEAD'],
  {encoding: 'utf8', timeout: 5000}).trim();
assert.equal(revision, pinnedSha, 'sac-unexpected-source-revision');
const generator = await readBounded(path.join(snapshot, generatorPath), 16 * 1024);
assert.equal(gitBlob(generator), pinnedGeneratorBlob, 'sac-unexpected-generator-version');
const generated = await readBounded(path.join(snapshot, generatedPath), 16 * 1024);
// No environment-specific URLs, credentials, or generated source escape this runner.
assert.equal(generated, expectedGenerated, 'sac-generated-content-not-reproducible');
const configText = await readBounded(path.join(snapshot, 'tsconfig.json'), 16 * 1024);
const allFiles = await collectFiles();
assert.equal(allFiles.length, 49, 'sac-generated-file-not-captured');
assert.equal(allFiles.filter(x => x.path === generatedPath).length, 1, 'sac-generated-file-not-unique');

const policy = {
  layers: [], allowImports: {},
  external: ['@angular/', 'rxjs', 'rxjs/', 'phaser', 'phaser/']
};
const args = {typescript: ts, policy, tsconfig: {path: 'tsconfig.json', text: configText}};
const before = analyzeImportGraph({
  ...args,
  files: allFiles.filter(x => x.path !== generatedPath),
  generatedFiles: [{path: generatedPath, generator: generatorPath}]
});
assert.equal(before.status, 'unverified', 'sac-expected-missing-source-evidence');
assert.equal(before.findings.filter(f => f.code === 'generated-source-not-captured').length, 2,
  'sac-expected-two-generated-imports');
const after = analyzeImportGraph({...args, files: allFiles});
const reverse = analyzeImportGraph({...args, files: [...allFiles].reverse()});
assert.deepEqual(after, reverse, 'sac-order-dependent-result');
assert.equal(after.status, 'pass', 'sac-build-capture-has-unresolved-imports');
assert.equal(after.findings.length, 0, 'sac-build-capture-has-findings');
assert.equal(after.nodes.length, 49, 'sac-build-capture-wrong-source-count');
assert.equal(after.edges.filter(e => e.to === generatedPath).length, 2,
  'sac-generated-module-not-connected');
assert.equal(after.root_cause_verified, false);
assert.equal(after.deployment_authorized, false);

// The enclosing CI run (not this script) proves the preceding Angular build step passed.
console.log(JSON.stringify({
  schema_version: 1,
  probe: 'sac-pre002-pinned-terrania-build-capture',
  source_revision: pinnedSha,
  generator_git_blob: pinnedGeneratorBlob,
  generated_file: generatedPath,
  generated_sha256: digest(generated),
  generated_file_captured: true,
  before: {
    sources: before.nodes.length, status: before.status,
    generated_source_not_captured: before.findings.filter(f => f.code === 'generated-source-not-captured').length
  },
  after: {
    sources: after.nodes.length, imports: after.edges.length, status: after.status,
    generated_module_imports: after.edges.filter(e => e.to === generatedPath).length
  },
  build_verification: 'refer_to_enclosing_ci_build_step',
  deployment_authorized: false
}, null, 2));

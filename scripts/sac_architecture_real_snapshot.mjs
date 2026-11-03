/**
 * SAC-PRE002 real-project regression probe.
 * Static only: pinned public GitHub snapshots are checked out by CI.
 * No importing app code, no project npm install, no network access here.
 * All filesystem reads are confined to the runner's snapshot directories.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {lstat, readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeImportGraph} from '../packages/angular-precompiler/src/dependency-graph.mjs';

const require = createRequire(new URL('../packages/angular-postcompiler/smoke/package.json', import.meta.url));
const ts = require('typescript');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOTS = path.join(ROOT, '.sac-snapshots');
const MAX_FILES = 128, MAX_PER_FILE = 512 * 1024, MAX_TOTAL = 2 * 1024 * 1024;
const MAX_DIRS = 256;
const BASE_POLICY = Object.freeze({
  layers: [],
  allowImports: {},
  external: ['@angular/', 'rxjs', 'rxjs/', 'phaser']
});
const TARGETS = Object.freeze([
  {
    id: 'painel',
    repo: 'Softdown-prog/Painel',
    sha: 'e610075418f1ef44256fd5d4778f811517f69390',
    subdir: 'angular',
    expectedTypescriptFiles: 26,
    inherited: ['tsconfig.app.json']
  },
  {
    id: 'lhs',
    repo: 'Softdown-prog/A7-forge-2D-',
    sha: 'db639a117024b2e14c4af844bfb69b90bef5da20',
    subdir: 'games/lan_house_simulator/frontend-angular',
    expectedTypescriptFiles: 38,
    inherited: ['tsconfig.app.json','tsconfig.site.json','tsconfig.site-rewrite.json']
  },
  {
    id: 'terrania',
    repo: 'Softdown-prog/Terrania',
    sha: '6ce58c1687ad21c1d3e01dc87061751ca07a09f1',
    subdir: '.',
    expectedTypescriptFiles: 48,
    inherited: []
  }
]);

const inside = (root, child) => child.startsWith(root + path.sep);
async function boundedFile(file, max) {
  const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= max,
    'snapshot-file-invalid-or-too-large');
  return readFile(file, 'utf8');
}
async function sourceFiles(workspace) {
  const root = path.join(workspace, 'src');
  const files = [];
  let bytes = 0, directories = 0;
  async function visit(dir) {
    assert.ok(dir === root || inside(root, dir), 'snapshot-directory-outside-root');
    assert.ok(++directories <= MAX_DIRS, 'snapshot-too-many-directories');
    const entries = await readdir(dir, {withFileTypes: true});
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      assert.ok(inside(root, absolute), 'snapshot-path-outside-root');
      assert.ok(!entry.isSymbolicLink(), 'snapshot-symlink-not-allowed');
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await visit(absolute);
        continue;
      }
      assert.ok(entry.isFile(), 'snapshot-special-file-not-allowed');
      if (!/\.tsx?$/.test(entry.name)) continue;
      const relative = path.relative(workspace, absolute).split(path.sep).join('/');
      assert.ok(files.length + 1 <= MAX_FILES, 'snapshot-too-many-ts-files');
      const source = await boundedFile(absolute, MAX_PER_FILE);
      bytes += Buffer.byteLength(source, 'utf8');
      assert.ok(bytes <= MAX_TOTAL, 'snapshot-source-size-limit');
      files.push({path:relative,source});
    }
  }
  await visit(root);
  return files;
}
function summarize(result) {
  const codes = {};
  for (const finding of result.findings) codes[finding.code] = (codes[finding.code] ?? 0) + 1;
  return {
    status:result.status,
    nodes:result.nodes.length,
    edges:result.edges.length,
    runtime_edges:result.edges.filter(e=>e.kind==='runtime').length,
    type_edges:result.edges.filter(e=>e.kind==='type').length,
    finding_count:result.findings.length,
    finding_codes:Object.fromEntries(Object.entries(codes).sort(([a],[b])=>a.localeCompare(b))),
    // Only stable code and bounded repository-relative file paths, never source text.
    finding_locations:result.findings.slice(0,12).map(f=>({
      code:f.code,
      file:typeof f.file==='string'?f.file:null,
      target:typeof f.target==='string'?f.target:null,
      members:Array.isArray(f.members)?f.members.slice(0,8):[]
    })),
    truncated:result.truncated,
    root_cause_verified:result.root_cause_verified,
    deployment_authorized:result.deployment_authorized
  };
}
const summaries = [];
for (const target of TARGETS) {
  const workspace = path.join(SNAPSHOTS, target.id, target.subdir);
  const files = await sourceFiles(workspace);
  assert.equal(files.length, target.expectedTypescriptFiles, 'snapshot-file-inventory-mismatch');
  const configText = await boundedFile(path.join(workspace,'tsconfig.json'), 16 * 1024);
  const main = analyzeImportGraph({
    files, policy: BASE_POLICY, typescript: ts,
    tsconfig:{path:'tsconfig.json',text:configText}
  });
  assert.equal(main.nodes.length, target.expectedTypescriptFiles);
  assert.equal(main.scope, 'enumerated-typescript-sources-only');
  assert.equal(main.root_cause_verified, false);
  assert.equal(main.deployment_authorized, false);
  // Repeat with opposite input order to ensure stable results on real source trees.
  const shuffled = analyzeImportGraph({
    files:[...files].reverse(), policy:BASE_POLICY, typescript:ts,
    tsconfig:{path:'tsconfig.json',text:configText}
  });
  assert.deepEqual(shuffled,main,'real-snapshot-analysis-not-deterministic');
  const apps = [];
  for (const name of target.inherited) {
    const text = await boundedFile(path.join(workspace,name), 16*1024);
    const inspected = analyzeImportGraph({
      files, policy:BASE_POLICY, typescript:ts,
      tsconfig:{path:'tsconfig.json',text}
    });
    // 'extends' must never be silently treated as a complete config.
    assert.notEqual(inspected.status,'pass','inherited-tsconfig-not-fail-closed');
    assert.ok(inspected.findings.some(f=>f.code==='unsupported-tsconfig-inheritance'),
      'missing-inheritance-evidence');
    apps.push({file:name, status:inspected.status, limitation:'unsupported-tsconfig-inheritance'});
  }
  const report={
    project:target.id,
    repository:target.repo,
    source_sha:target.sha,
    scope:'all-enumerated-ts-sources-under-project-src',
    source_files_checked:target.expectedTypescriptFiles,
    main_tsconfig:summarize(main),
    inherited_tsconfigs:apps
  };
  summaries.push(report);
  // Only summary metrics, stable enums and the known, pinned source SHA.
  console.error('[SAC-PRE002]',target.id,report.main_tsconfig.status,
    'TS files',report.source_files_checked,'edges',report.main_tsconfig.edges);
}
assert.equal(summaries.length,3);
console.log(JSON.stringify({
  schema_version:1,
  probe:'real-pinned-angular-snapshots-static-only',
  tests:'real-sources-ast-no-project-execution',
  source_files_checked:summaries.reduce((n,x)=>n+x.source_files_checked,0),
  projects:summaries,
  deployment_authorized:false
},null,2));

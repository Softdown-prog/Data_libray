import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, writeProject, metadata, mutateJSON } from '../../angular-precompiler/test/fixtures.mjs';
import { prepareBuild, sealBuild, auditPipeline } from '../src/index.mjs';
const key = Buffer.alloc(32, 7), sourceSha = 'a'.repeat(40);
async function setup(t, { mount = '/', mode = 'angular-only', project = '.' } = {}) {
  const { workspace } = await fixture(t);
  if (project !== '.') await writeProject(path.join(workspace, project), metadata());
  const base = project === '.' ? '' : project + '/';
  await writeFile(path.join(workspace, base, 'app.ts'), '// synthetic input');
  const resources = { workspace, project, dist: base + 'output', sourceFiles: [base + 'package.json', base + 'package-lock.json', base + 'app.ts'] };
  const profile = { schema_version: 1, profile_id: 'synthetic', angular_version: '19.3.1', capabilities: ['angular', 'workspace', 'static-dist'], mode, mount, bundle_hints: { index: 'index.html', angular_host: 'sample-shell', angular_entrypoints: ['main.js'], assets: [], legacy_react_entrypoints: ['react.js'] }, rules: ['SAC-PRE001', 'SAC-P001'].map(rule_id => ({ rule_id, version: '1.0.0', required: true, enforcement: 'blocking' })) };
  const args = { profile, resources, key, sourceSha };
  const prepared = await prepareBuild(args);
  assert.ok(prepared.session);
  await mkdir(path.join(workspace, resources.dist), { recursive: true });
  await writeFile(path.join(workspace, resources.dist, 'index.html'), `<base href="${mount}"><sample-shell></sample-shell><script type="module" src="main.js"></script>${mode === 'hybrid' ? '<script src="react.js"></script>' : ''}`);
  await writeFile(path.join(workspace, resources.dist, 'main.js'), '// synthetic bundle');
  await writeFile(path.join(workspace, resources.dist, 'react.js'), '// legacy');
  const receipt = await sealBuild({ ...args, session: prepared.session, buildStatus: 'pass' });
  return { ...args, receipt, session: prepared.session };
}
for (const options of [{}, { mount: '/tools/' }, { mode: 'hybrid', mount: '/mixed/' }, { project: 'apps/one' }, { project: 'apps/two' }]) test(`positive profile ${JSON.stringify(options)}`, async t => {
  const args = await setup(t, options), r = await auditPipeline(args);
  assert.equal(r.status, 'pass'); assert.equal(r.static_pipeline_pass, true); assert.equal(r.deployment_authorized, false);
  assert.deepEqual(r, await auditPipeline(args));
  assert.equal(r.phases.browser.executed, false); assert.equal(r.phases.deploy.status, 'unverified');
  assert.deepEqual(Object.keys(r.phases), ['pre', 'build', 'post', 'browser', 'deploy']);
});
for (const kind of ['absent', 'failed', 'forged', 'old-source', 'old-profile', 'artifact-changed', 'dist-absent', 'different-sha', 'wrong-key']) test(`closed build gate: ${kind}`, async t => {
  const a = await setup(t);
  if (kind === 'absent') a.receipt = null;
  if (kind === 'failed') a.receipt = await sealBuild({ ...a, buildStatus: 'fail' });
  if (kind === 'forged') a.receipt.data.build_status = 'fail';
  if (kind === 'old-source') await writeFile(path.join(a.resources.workspace, 'app.ts'), '// new revision');
  if (kind === 'old-profile') a.profile.profile_id = 'different';
  if (kind === 'artifact-changed') await rm(path.join(a.resources.workspace, a.resources.dist, 'main.js'));
  if (kind === 'dist-absent') await rm(path.join(a.resources.workspace, a.resources.dist), { recursive: true });
  if (kind === 'different-sha') a.sourceSha = 'b'.repeat(40);
  if (kind === 'wrong-key') a.key = Buffer.alloc(32, 8);
  const r = await auditPipeline(a); assert.equal(r.static_pipeline_pass, false); assert.equal(r.phases.post.executed, false);
});
for (const kind of ['incompatible-ts', 'missing-dependencies', 'observe-pre', 'observe-post', 'optional-pre', 'timeout', 'infra']) test(`mandatory coverage: ${kind}`, async t => {
  const a = await setup(t);
  if (kind === 'incompatible-ts') await mutateJSON(path.join(a.resources.workspace, 'node_modules/@angular/compiler-cli/package.json'), p => { p.peerDependencies.typescript = '<1'; });
  if (kind === 'missing-dependencies') await rm(path.join(a.resources.workspace, 'node_modules'), { recursive: true });
  if (kind === 'observe-pre') a.profile.rules[0].enforcement = 'observe';
  if (kind === 'observe-post') { a.profile.rules[1].enforcement = 'observe'; a.receipt = await sealBuild({ ...a, session: (await prepareBuild(a)).session, buildStatus: 'pass' }); }
  if (kind === 'optional-pre') a.profile.rules[0].required = false;
  if (kind === 'timeout') a.limits = { timeoutMs: 1 };
  if (kind === 'infra') a.resources.workspace = null;
  const r = await auditPipeline(a); assert.equal(r.static_pipeline_pass, false);
  if (kind !== 'observe-post') assert.equal(r.phases.post.executed, false);
});
for (const broken of ['main.js', 'index.html']) test(`signed broken build fails post ${broken}`, async t => {
  const a = await setup(t);
  if (broken === 'main.js') await rm(path.join(a.resources.workspace, a.resources.dist, broken));
  else await writeFile(path.join(a.resources.workspace, a.resources.dist, broken), '<wrong-shell></wrong-shell><script src="main.js"></script>');
  a.receipt = await sealBuild({ ...a, buildStatus: 'pass' });
  const r = await auditPipeline(a); assert.equal(r.phases.post.status, 'fail'); assert.equal(r.static_pipeline_pass, false);
});
test('cross-app receipt cannot mix independent locks/dist', async t => {
  const a = await setup(t, { project: 'apps/a' });
  await writeProject(path.join(a.resources.workspace, 'apps/b'), metadata({ angular: '20.0.0', ts: '6.1.0', tsRange: '^6.1.0' }));
  const b = await setup(t, { project: 'apps/b' }); b.receipt = a.receipt;
  assert.equal((await auditPipeline(b)).static_pipeline_pass, false);
});
test('non Angular is not applicable and does no IO', async () => {
  const profile = { schema_version: 1, profile_id: 'plain', angular_version: null, capabilities: [], mode: 'non-angular', mount: '/', bundle_hints: null, rules: [{ rule_id: 'SAC-PRE001', version: '1.0.0', required: false, enforcement: 'observe' }] };
  const r = await auditPipeline({ profile }); assert.equal(r.status, 'not-applicable'); assert.equal(r.static_pipeline_pass, false);
});
test('CLI authenticates trusted host receipt, never emits key or paths', async t => {
  const a = await setup(t);
  // Host inputs outside declared source set; no secrets are in the report.
  for (const [name, value] of Object.entries({ 'profile.json': a.profile, 'receipt.json': a.receipt, 'sources.json': a.resources.sourceFiles })) await writeFile(path.join(a.resources.workspace, name), JSON.stringify(value));
  await writeFile(path.join(a.resources.workspace, 'host-key'), key);
  const cli = new URL('../bin/pipeline.mjs', import.meta.url).pathname;
  const opts = ['--no-build', '--profile', path.join(a.resources.workspace, 'profile.json'), '--workspace', a.resources.workspace, '--dist', a.resources.dist, '--sources', path.join(a.resources.workspace, 'sources.json'), '--receipt', path.join(a.resources.workspace, 'receipt.json'), '--trust-key', path.join(a.resources.workspace, 'host-key'), '--source-sha', sourceSha];
  const r = spawnSync(process.execPath, [cli, ...opts], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).static_pipeline_pass, true); assert.ok(!r.stdout.includes(a.resources.workspace));
  const invalid = spawnSync(process.execPath, [cli, '--shell', 'echo secret'], { encoding: 'utf8' }); assert.equal(invalid.status, 1); assert.doesNotMatch(invalid.stdout, /secret/);
});
test('no process or network code in pipeline implementation', async () => {
  const source = await readFile(new URL('../src/index.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:(child_process|http|net)|\b(eval|fetch|spawn|writeFile)\s*\(/);
});
test('sealing rejects source changes between preflight and official build', async t => {
  const a = await setup(t);
  await writeFile(path.join(a.resources.workspace, 'app.ts'), '// changed during build');
  await assert.rejects(() => sealBuild({ ...a, buildStatus: 'pass' }), /sources-changed/);
});
for (const dist of ['../outside', '/outside', '.']) test(`unsafe dist ${dist} fails closed`, async t => {
  const a = await setup(t); a.resources.dist = dist;
  assert.equal((await auditPipeline(a)).static_pipeline_pass, false);
});
test('two subapps share one root while preserving independent preflight and evidence', async t => {
  const a = await setup(t, { project: 'apps/a' });
  const root = a.resources.workspace;
  await writeProject(path.join(root, 'apps/b'), metadata({ angular: '20.0.0', ts: '6.1.0', tsRange: '^6.1.0' }));
  await writeFile(path.join(root, 'apps/b/app.ts'), '// independent app');
  const b = { ...a, profile: { ...a.profile, profile_id: 'app-b', angular_version: '20.0.0' }, resources: { workspace: root, project: 'apps/b', dist: 'apps/b/output', sourceFiles: ['apps/b/package.json', 'apps/b/package-lock.json', 'apps/b/app.ts'] } };
  const { session } = await prepareBuild(b); assert.ok(session);
  await mkdir(path.join(root, b.resources.dist));
  await writeFile(path.join(root, b.resources.dist, 'index.html'), '<sample-shell></sample-shell><script src="main.js"></script>');
  await writeFile(path.join(root, b.resources.dist, 'main.js'), '// app b');
  b.receipt = await sealBuild({ ...b, session, buildStatus: 'pass' });
  assert.equal((await auditPipeline(a)).static_pipeline_pass, true);
  assert.equal((await auditPipeline(b)).static_pipeline_pass, true);
  assert.equal((await auditPipeline({ ...b, receipt: a.receipt })).static_pipeline_pass, false);
});

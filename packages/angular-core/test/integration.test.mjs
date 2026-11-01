import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RuleRegistry, execute, validateProfile } from '../src/index.mjs';
import { registerSACP001 } from '../src/sac-p001.mjs';
import { verify } from '../../angular-postcompiler/src/index.mjs';
import { selection } from './helpers.mjs';

const cases = [
  { id: 'root-spa', host: 'alpha-shell', mount: '/', mode: 'angular-only', main: 'alpha.js' },
  { id: 'subpath-spa', host: 'beta-app', mount: '/nested/tool/', mode: 'angular-only', main: 'beta.js' },
  { id: 'hybrid-shell', host: 'gamma-view', mount: '/mixed/', mode: 'hybrid', main: 'gamma.js' }
];
const registry = () => registerSACP001(new RuleRegistry());
async function fixture(t, c) {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'sac-core-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  const p = { schema_version: 1, profile_id: c.id, angular_version: '22.0.0', capabilities: ['angular', 'static-dist'], mode: c.mode, mount: c.mount,
    bundle_hints: { index: 'index.html', angular_host: c.host, angular_entrypoints: [c.main], assets: ['site.css'], legacy_react_entrypoints: ['old-react.js'] }, rules: [selection('SAC-P001')] };
  const html = `<html><head><base href="${c.mount}"><link rel="stylesheet" href="${c.mount}site.css"></head><body><${c.host}></${c.host}><script type="module" src="${c.main}"></script>${c.mode === 'hybrid' ? '<script src="old-react.js"></script>' : ''}</body></html>`;
  for (const [file, content] of Object.entries({ 'index.html': html, [c.main]: '/* synthetic static fixture */', 'site.css': 'body{}', 'old-react.js': '/* intentional hybrid */' })) await writeFile(path.join(dist, file), content);
  return { dist, p, html };
}
for (const c of cases) {
  for (const defect of ['none', 'missing-entry', 'wrong-root']) test(`${c.id}: ${defect}`, async t => {
    const { dist, p, html } = await fixture(t, c);
    if (defect === 'missing-entry') await rm(path.join(dist, c.main));
    if (defect === 'wrong-root') await writeFile(path.join(dist, 'index.html'), html.replaceAll(c.host, 'wrong-shell'));
    const report = await execute({ registry: registry(), profile: p, resources: { dist } });
    assert.equal(report.status, defect === 'none' ? 'pass' : 'fail');
    assert.equal(report.promotion_allowed, defect === 'none');
    assert.equal(report.results[0].phase, 'post');
    assert.notEqual(report.results[0].status, 'browser-pass');
  });
}
test('fourth non-Angular profile: not applicable, zero approved coverage', async () => {
  const p = { schema_version: 1, profile_id: 'static-only', angular_version: null, capabilities: ['static-dist'], mode: 'non-angular', mount: '/', bundle_hints: null, rules: [selection('SAC-P001', false)] };
  const report = await execute({ registry: registry(), profile: p });
  assert.equal(report.status, 'not-applicable'); assert.equal(report.results[0].status, 'not-applicable');
  assert.equal(report.promotion_allowed, false); assert.deepEqual(report.coverage, { required: 0, passed: 0 });
});
test('mount mismatch is a defect in core profile, independent of legacy contract', async t => {
  const { dist, p } = await fixture(t, cases[0]); p.mount = '/different/';
  assert.equal((await execute({ registry: registry(), profile: p, resources: { dist } })).status, 'fail');
});
test('absence of static-dist capability is explicitly not applicable', async t => {
  const { dist, p } = await fixture(t, cases[0]); p.capabilities = ['angular'];
  const r = await execute({ registry: registry(), profile: p, resources: { dist } });
  assert.equal(r.results[0].status, 'not-applicable'); assert.equal(r.promotion_allowed, false);
});
test('legacy API and CLI remain byte-equivalent before and after adapter registration', async t => {
  const { dist, p } = await fixture(t, cases[0]);
  const contract = { schema_version: 1, ...p.bundle_hints, mode: p.mode };
  const config = path.join(dist, 'contract.json'); await writeFile(config, JSON.stringify(contract));
  const cli = new URL('../../angular-postcompiler/bin/postcompile.mjs', import.meta.url).pathname;
  const before = await verify(dist, contract);
  const cliBefore = spawnSync(process.execPath, [cli, '--dist', dist, '--contract', config], { encoding: 'utf8' });
  const filesBefore = await Promise.all(['index.html', cases[0].main, 'site.css', 'old-react.js'].map(f => readFile(path.join(dist, f), 'utf8')));
  await execute({ registry: registry(), profile: p, resources: { dist } });
  assert.deepEqual(await verify(dist, contract), before);
  const after = spawnSync(process.execPath, [cli, '--dist', dist, '--contract', config], { encoding: 'utf8' });
  assert.equal(after.status, 0); assert.equal(after.stdout, cliBefore.stdout); assert.equal(after.stderr, cliBefore.stderr);
  assert.deepEqual(JSON.parse(after.stdout), before);
  assert.deepEqual(await Promise.all(['index.html', cases[0].main, 'site.css', 'old-react.js'].map(f => readFile(path.join(dist, f), 'utf8'))), filesBefore);
});
test('bundle paths and unknown instructions cannot enter project configuration', () => {
  const base = { schema_version: 1, profile_id: 'test', angular_version: '23.0.1', capabilities: ['angular'], mode: 'angular-only', mount: '/', bundle_hints: { index: 'index.html', angular_host: 'x-shell', angular_entrypoints: ['main.js'], assets: [], legacy_react_entrypoints: [] }, rules: [selection('SAC-P001')] };
  for (const invalid of ['../main.js', 'https://evil.invalid/main.js', '/absolute.js', 'x\\main.js', 'main.js?token=secret', './main.js', 'x/../main.js', 'x/', 'x//main.js', 'x%2fmain.js']) assert.throws(() => validateProfile({ ...base, bundle_hints: { ...base.bundle_hints, angular_entrypoints: [invalid] } }));
});
test('core and adapter never import network/subprocess or mutate repositories', async () => {
  for (const name of ['index.mjs', 'sac-p001.mjs']) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /node:(child_process|http|https|net|tls|dgram)|\b(fetch|eval|exec|spawn|writeFile)\s*\(/);
    assert.doesNotMatch(source, /vps_daemon|batch_worker|git\s+(push|merge|checkout)|npm\s+publish/);
    assert.doesNotMatch(source, /TEST-DUMMY/);
  }
});
test('root SPA without explicit base href remains valid', async t => {
  const { dist, p, html } = await fixture(t, cases[0]);
  await writeFile(path.join(dist, 'index.html'), html.replace('<base href="/">', ''));
  assert.equal((await execute({ registry: registry(), profile: p, resources: { dist } })).status, 'pass');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verify } from '../src/index.mjs';

const cli = new URL('../bin/postcompile.mjs', import.meta.url);
const contract = () => ({ schema_version: 1, index: 'index.html', angular_host: 'custom-shell', mode: 'angular-only', angular_entrypoints: ['main.js'], assets: ['style.css'], legacy_react_entrypoints: ['react.js'] });
const shell = '<custom-shell></custom-shell><script type="module" src="main.js"></script><link rel="stylesheet" href="style.css">';
async function fixture(t, html = shell) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sac-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, 'dist');
  await mkdir(dist);
  for (const [file, text] of Object.entries({ 'index.html': html, 'main.js': 'console.log("static fixture, not Angular runtime")', 'style.css': 'body{}', 'react.js': '/* legacy */' })) await writeFile(path.join(dist, file), text);
  return { root, dist };
}

test('positive fixture; stable evidence and configurable Angular host', async t => {
  const { dist } = await fixture(t);
  const report = await verify(dist, contract());
  assert.equal(report.status, 'pass');
  assert.equal(report.schema_version, 1);
  assert.equal(report.rule_id, 'SAC-P001');
  assert.deepEqual(report, await verify(dist, contract()));
  assert.deepEqual(report.evidence.find(e => e.assertion === 'html-resources').resources, [{ path: 'main.js', kind: 'script' }, { path: 'style.css', kind: 'stylesheet' }]);
});
for (const [name, html, status] of [
  ['missing root', shell.replaceAll('custom-shell', 'other-shell'), 'fail'],
  ['comment is not a host', '<!-- <custom-shell></custom-shell> -->' + shell.replaceAll('custom-shell', 'other-shell'), 'fail'],
  ['template is inert', '<template>' + shell + '</template>', 'fail'],
  ['missing script', shell.replace('main.js', 'missing.js'), 'fail'],
  ['missing CSS', shell.replace('style.css', 'missing.css'), 'fail'],
  ['entrypoint exists but unreferenced', shell.replace('<script type="module" src="main.js"></script>', ''), 'fail'],
  ['forbidden React entry', shell + '<script src="react.js"></script>', 'fail'],
  ['traversal', shell.replace('main.js', '../main.js'), 'fail'],
  ['encoded traversal', shell.replace('main.js', '%2e%2e/main.js'), 'fail'],
  ['encoded separator', shell.replace('main.js', 'x%2fmain.js'), 'fail'],
  ['backslash', shell.replace('main.js', 'x\\main.js'), 'fail'],
  ['external URL', shell.replace('main.js', 'https://example.invalid/main.js'), 'unverified'],
  ['protocol relative', shell.replace('main.js', '//example.invalid/main.js'), 'unverified'],
  ['data URL', shell.replace('main.js', 'data:text/javascript,alert(1)'), 'unverified'],
  ['inline executable', shell + '<script>import("hidden.js")</script>', 'unverified'],
  ['remote base', '<base href="https://example.invalid/">' + shell, 'unverified'],
  ['multiple bases', '<base href="/"><base href="/app/">' + shell, 'unverified'],
  ['outside mount', '<base href="/app/">' + shell.replace('main.js', '/other/main.js'), 'unverified'],
  ['local base mount', '<base href="/app/">' + shell, 'pass'],
  ['file-like base unsupported', '<base href="/app">' + shell, 'unverified'],
  ['inert entry script', shell.replace('type="module"', 'type="application/json"'), 'unverified'],
  ['nomodule selection', shell.replace('type="module"', 'nomodule'), 'unverified'],
  ['relative base mount', '<base href="./">' + shell, 'pass'],
  ['absolute resource under base', '<base href="/app/">' + shell.replace('main.js', '/app/main.js'), 'pass'],
  ['query and fragment', shell.replace('main.js', 'main.js?v=1#entry'), 'pass'],
  ['HTML entities decoded', shell.replace('main.js', 'main.js?v=1&amp;x=2'), 'pass'],
  ['dynamic text not required', shell + '<!-- runtime renders content -->', 'pass'],
]) test(name, async t => {
  const { dist } = await fixture(t, html);
  assert.equal((await verify(dist, contract())).status, status);
});

test('hybrid explicitly permits referenced legacy React', async t => {
  const { dist } = await fixture(t, shell + '<script src="react.js"></script>');
  assert.equal((await verify(dist, { ...contract(), mode: 'hybrid' })).status, 'pass');
});
test('unreferenced legacy file does not imply an entrypoint', async t => {
  const { dist } = await fixture(t);
  assert.equal((await verify(dist, contract())).status, 'pass');
});
for (const file of ['index.html', 'main.js', 'style.css']) {
  for (const action of ['missing', 'empty', 'directory', 'symlink-outside']) test(`${file}: ${action}`, async t => {
    const { root, dist } = await fixture(t);
    const target = path.join(dist, file);
    await rm(target);
    if (action === 'empty') await writeFile(target, '');
    if (action === 'directory') await mkdir(target);
    if (action === 'symlink-outside') { await writeFile(path.join(root, 'outside'), shell); await symlink(path.join(root, 'outside'), target); }
    assert.equal((await verify(dist, contract())).status, 'fail');
  });
}
test('in-root symlink supported', async t => {
  const { dist } = await fixture(t);
  await writeFile(path.join(dist, 'actual.js'), '/* module */');
  await rm(path.join(dist, 'main.js'));
  await symlink('actual.js', path.join(dist, 'main.js'));
  assert.equal((await verify(dist, contract())).status, 'pass');
});
test('symlink directory cannot escape root', async t => {
  const { root, dist } = await fixture(t, shell.replace('main.js', 'linked/main.js'));
  await symlink(root, path.join(dist, 'linked'));
  await writeFile(path.join(root, 'main.js'), 'outside');
  assert.equal((await verify(dist, contract())).status, 'fail');
});
for (const mutation of [c => null, c => ({}), c => ({ ...c, schema_version: 2 }), c => ({ ...c, angular_entrypoints: [] }), c => ({ ...c, assets: null }), c => ({ ...c, mode: 'react' }), c => ({ ...c, angular_host: 'app-root onclick=x' }), c => ({ ...c, index: '../index.html' }), c => ({ ...c, angular_entrypoints: ['/main.js'] }), c => ({ ...c, command: 'curl example.invalid' }), c => ({ ...c, legacy_react_entrypoints: ['main.js'] })]) test('invalid contract rejects without success', async t => {
  const { dist } = await fixture(t);
  assert.equal((await verify(dist, mutation(contract()))).status, 'fail');
});
test('absent dist fails', async t => {
  const { root } = await fixture(t);
  assert.equal((await verify(path.join(root, 'absent'), contract())).status, 'fail');
});
test('CLI outputs JSON, readable stderr and nonzero for every non-pass', async t => {
  const { root, dist } = await fixture(t);
  const config = path.join(root, 'contract.json');
  await writeFile(config, JSON.stringify(contract()));
  const run = () => spawnSync(process.execPath, [cli.pathname, '--dist', dist, '--contract', config], { encoding: 'utf8' });
  let result = run();
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).status, 'pass');
  assert.match(result.stderr, /SAC-P001: pass/);
  await writeFile(path.join(dist, 'index.html'), '<script src="https://example.invalid/a.js"></script><custom-shell></custom-shell>');
  result = run(); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, 'unverified');
  await writeFile(config, '{');
  result = run(); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, 'fail');
  await rm(config); await mkdir(config);
  result = run(); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, 'infra-error');
  result = spawnSync(process.execPath, [cli.pathname], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, 'fail');
});
test('production module has no network, subprocess, publication or write imports', async () => {
  for (const relative of ['../src/index.mjs', '../bin/postcompile.mjs']) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /node:(child_process|http|https|net|tls|dgram)|\b(fetch|exec|spawn|writeFile|symlink|unlink)\s*\(/);
    assert.doesNotMatch(source, /vps_daemon|batch_worker|git\s+(push|merge|checkout)|npm\s+publish/);
  }
});

test('nested index mapping is unverified', async t => {
  const { dist } = await fixture(t);
  assert.equal((await verify(dist, { ...contract(), index: 'browser/index.html' })).status, 'unverified');
});

test('oversized HTML cannot be parsed into an unbounded in-memory tree', async t => {
  const { dist } = await fixture(t);
  await writeFile(path.join(dist, 'index.html'), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
  const result = await verify(dist, contract());
  assert.equal(result.status, 'unverified');
  assert.equal(result.evidence.find(e => e.assertion === 'index').status, 'unverified');
});

test('oversized build resource is unverified rather than loaded', async t => {
  const { dist } = await fixture(t);
  await writeFile(path.join(dist, 'main.js'), Buffer.alloc(16 * 1024 * 1024 + 1, 0x61));
  const result = await verify(dist, contract());
  assert.equal(result.status, 'unverified');
  assert.equal(result.evidence.find(e => e.assertion === 'html-resources').status, 'unverified');
});

test('combined build artifact reads stay within the bounded memory budget', async t => {
  const { dist } = await fixture(t);
  const assets = Array.from({ length: 5 }, (_, index) => `asset-${index}.js`);
  await writeFile(path.join(dist, 'index.html'),
    shell + assets.map(asset => `<script src="${asset}"></script>`).join(''));
  for (const asset of assets) {
    await writeFile(path.join(dist, asset), Buffer.alloc(13 * 1024 * 1024, 0x61));
  }
  const result = await verify(dist, contract());
  assert.equal(result.status, 'unverified');
  assert.equal(result.evidence.find(e => e.assertion === 'html-resources').status, 'unverified');
});

test('an excessive number of resource references is not silently approved', async t => {
  const { dist } = await fixture(t);
  const references = '<link rel="stylesheet" href="style.css">'.repeat(513);
  await writeFile(path.join(dist, 'index.html'), shell + references);
  const result = await verify(dist, contract());
  assert.equal(result.status, 'unverified');
  assert.equal(result.evidence.find(e => e.assertion === 'html-resources').status, 'unverified');
});

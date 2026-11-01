import test from 'node:test';
import { get } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { browserContract } from '../src/browser-contract.mjs';
import { serveArtifact } from '../src/artifact-server.mjs';
import { verifyPipelineBrowser } from '../src/pipeline.mjs';
const contract = () => ({ schema_version: 1, timeout_ms: 1000, cases: [{ id: 'click-state', path: '/', expect_visible: ['h1'], actions: [{ click: 'button', expect_visible: '.changed' }] }] });
const hash = b => createHash('sha256').update(b).digest('hex');
for (const mutation of [c => ({ ...c, schema_version: 2 }), c => ({ ...c, baseUrl: 'http://localhost:123' }), c => ({ ...c, cases: [] }), c => ({ ...c, timeout_ms: 999999 }), c => ({ ...c, cases: [{ ...c.cases[0], path: '//other/' }] }), c => ({ ...c, cases: [{ ...c.cases[0], path: '/../' }] }), c => ({ ...c, cases: [{ ...c.cases[0], actions: [] }] }), c => ({ ...c, cases: [{ ...c.cases[0], actions: [{ click: 'button', expect_visible: 'p', eval: 'secret' }] }] })]) test('strict bounded browser contract rejects unsupported execution or absent assertions', () => { assert.throws(() => browserContract(mutation(contract()))); });
test('versioned contract is cloned and accepts declared subpath routes', () => {
 const c = contract(); c.cases[0].path = '/settings/'; assert.deepEqual(browserContract(c), c); assert.notEqual(browserContract(c), c);
});
test('non-applicable integration never launches browser or requires a URL', async () => {
 const profile = { schema_version: 1, profile_id: 'plain', angular_version: null, capabilities: [], mode: 'non-angular', mount: '/', bundle_hints: null, rules: [{ rule_id: 'SAC-PRE001', version: '1.0.0', required: false, enforcement: 'observe' }] };
 const r = await verifyPipelineBrowser({ pipeline: { profile } }); assert.equal(r.browser.status, 'not-applicable'); assert.equal(r.browser_pass, false);
});
test('static failure never launches browser', async () => {
 const r = await verifyPipelineBrowser({ pipeline: { profile: {} }, guardian: contract() }); assert.equal(r.browser.executed, false); assert.equal(r.browser_pass, false);
});
async function fixture(t) {
 const dist = await mkdtemp(path.join(os.tmpdir(), 'guardian-dist-')); t.after(() => rm(dist, { recursive: true, force: true }));
 await writeFile(path.join(dist, 'index.html'), 'exact fixture');
 return { dist, digest: hash(JSON.stringify([['index.html', hash('exact fixture')]])), mount: '/app/', routes: ['/', '/settings/'] };
}
test('artifact server ephemeral loopback, exact bytes and only declared SPA routes', async t => {
 const args = await fixture(t); const server = await serveArtifact(args); t.after(() => server.close());
 const other = await serveArtifact(args); t.after(() => other.close()); assert.notEqual(server.origin, other.origin);
 assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
 assert.equal(await (await fetch(server.origin + '/app/')).text(), 'exact fixture');
 assert.equal(await (await fetch(server.origin + '/app/settings/')).text(), 'exact fixture');
 for (const p of ['/private', '/app/undeclared/', '/app/%2e%2e/private']) assert.equal((await fetch(server.origin + p)).status, 404);
 assert.equal((await fetch(server.origin + '/app/', { method: 'POST' })).status, 404);
});
test('wrong host/other server cannot be used as artifact evidence', async t => {
 const args = await fixture(t); await assert.rejects(() => serveArtifact({ ...args, digest: '0'.repeat(64) }));
 const server = await serveArtifact(args); t.after(() => server.close());
 const status = await new Promise((resolve, reject) => { const req = get(server.origin + '/app/', { headers: { Host: 'localhost:1' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
 assert.equal(status, 404);
});
test('artifact symlink rejected before binding a port', async t => {
 const args = await fixture(t); await symlink('index.html', path.join(args.dist, 'other.html'));
 await assert.rejects(() => serveArtifact(args));
});

// Trusted ephemeral CI host; no commands are supplied by contracts.
import { spawnSync } from 'node:child_process';
import { writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { prepareBuild, sealBuild, auditPipeline } from '../../angular-pipeline/src/index.mjs';
import { verifyPipelineBrowser } from '../src/pipeline.mjs';
const workspace = fileURLToPath(new URL('../smoke/', import.meta.url));
const key = randomBytes(32), sourceSha = process.env.GITHUB_SHA ?? 'a'.repeat(40);
const guardian = { schema_version: 1, timeout_ms: 2000, cases: [{ id: 'reactive-click', path: '/', expect_visible: ['h1'], actions: [{ click: 'button', expect_visible: '.done' }] }] };
const reports = [];
for (const [name, mount, mode, hybrid] of [['root', '/', 'positive', false], ['subpath', '/tools/', 'positive', false], ['hybrid', '/mixed/', 'positive', true], ['broken', '/', 'broken', false], ['runtime', '/', 'runtime', false], ['http', '/', 'http', false], ['external', '/', 'external', false], ['websocket', '/', 'websocket', false], ['popup', '/', 'popup', false], ['redirect', '/', 'redirect', false]]) {
  await writeFile(new URL('../smoke/src/mode.ts', import.meta.url), `export const mode: string = '${mode}';\n`);
  await writeFile(new URL('../smoke/src/index.html', import.meta.url), `<html><head><base href="${mount}"></head><body><sac-smoke></sac-smoke></body></html>`);
  const profile = { schema_version: 1, profile_id: name, angular_version: '22.0.0', capabilities: ['angular', 'workspace', 'static-dist'], mode: hybrid ? 'hybrid' : 'angular-only', mount, bundle_hints: { index: 'index.html', angular_host: 'sac-smoke', angular_entrypoints: ['main.js'], assets: ['styles.css'], legacy_react_entrypoints: ['react.js'] }, rules: ['SAC-PRE001', 'SAC-P001'].map(rule_id => ({ rule_id, version: '1.0.0', required: true, enforcement: 'blocking' })) };
  const resources = { workspace, dist: 'dist/browser', sourceFiles: ['package.json', 'package-lock.json', 'angular.json', 'tsconfig.json', 'src/main.ts', 'src/mode.ts', 'src/index.html', 'src/styles.css'] };
  const pipeline = { profile, resources, key, sourceSha };
  const { session } = await prepareBuild(pipeline); assert.ok(session);
  await rm(new URL('../smoke/dist/', import.meta.url), { recursive: true, force: true });
  const build = spawnSync(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'build', 'smoke'], { cwd: workspace, shell: false, timeout: 120000, stdio: ['ignore', 2, 2], env: { ...process.env, NG_CLI_ANALYTICS: 'false' } });
  assert.equal(build.status, 0);
  if (hybrid) {
    await writeFile(new URL('../smoke/dist/browser/react.js', import.meta.url), '/* synthetic intentional legacy coexistence */');
    const index = new URL('../smoke/dist/browser/index.html', import.meta.url);
    await writeFile(index, (await readFile(index, 'utf8')).replace('</body>', '<script src="react.js"></script></body>'));
  }
  pipeline.receipt = await sealBuild({ ...pipeline, session, buildStatus: 'pass' });
  assert.equal((await auditPipeline(pipeline)).static_pipeline_pass, true);
  const result = await verifyPipelineBrowser({ pipeline, guardian });
  reports.push({ name, result });
  assert.equal(result.static_pipeline_pass, true);
  assert.equal(result.browser_pass, mode === 'positive', JSON.stringify(result));
  if (mode !== 'positive') assert.equal(result.browser.status, 'fail', JSON.stringify(result));
  assert.equal(result.deployment_authorized, false);
  const expectedCode = { external: 'network-policy-blocked', redirect: 'network-policy-blocked', websocket: 'websocket-blocked', popup: 'popup-blocked', http: 'http-error' }[mode];
  if (expectedCode) assert.ok(result.browser.cases[0].codes.includes(expectedCode), JSON.stringify(result));
  if (name === 'root') {
    const missing = await verifyPipelineBrowser({ pipeline }); assert.equal(missing.browser.status, 'unverified'); reports.push({ name: 'missing-contract', result: missing });
    const timeout = await verifyPipelineBrowser({ pipeline, guardian, timeoutMs: 1 }); assert.equal(timeout.browser.status, 'infra-error'); reports.push({ name: 'worker-timeout', result: timeout });
    const previous = process.env.PLAYWRIGHT_BROWSERS_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH = '/nonexistent-sac-browser-fixture';
    try {
      const unavailable = await verifyPipelineBrowser({ pipeline, guardian });
      assert.equal(unavailable.browser.status, 'infra-error'); reports.push({ name: 'chromium-unavailable', result: unavailable });
    } finally { if (previous === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH; else process.env.PLAYWRIGHT_BROWSERS_PATH = previous; }
    const slow = verifyPipelineBrowser({ pipeline, guardian: { ...guardian, cases: [{ ...guardian.cases[0], actions: [{ click: 'button', expect_visible: '.never' }] }] } });
    const mutate = setTimeout(() => { void writeFile(new URL('../smoke/dist/browser/extra.js', import.meta.url), '// mutation'); }, 300);
    const changed = await slow; clearTimeout(mutate); assert.equal(changed.browser_pass, false); reports.push({ name: 'mutation', result: changed });
  }
}
await mkdir(new URL('../smoke/reports/', import.meta.url), { recursive: true });
await writeFile(new URL('../smoke/reports/browser.json', import.meta.url), JSON.stringify({ schema_version: 1, reports }, null, 2) + '\n');
console.log(`Verified ${reports.length} Angular/browser scenarios`);

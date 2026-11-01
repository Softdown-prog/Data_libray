// Real SAC-008C integration: official Angular AOT, trusted receipt,
// Node supervisor and isolated Chromium; no external repo, deployment or VPS.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBuild, sealBuild } from '../packages/angular-pipeline/src/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = path.join(root, 'packages/angular-guardian/smoke');
const key = randomBytes(32);
const sourceSha = process.env.GITHUB_SHA ?? spawnSync('git', ['rev-parse','HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const image = process.env.SAC_SANDBOX_IMAGE;
assert.match(sourceSha, /^[a-f0-9]{40}$/);
assert.match(image ?? '', /^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/);
const dir = await mkdtemp(path.join(os.tmpdir(), 'sac-supervised-test-'));
const job = { schema_version: 1, job_id: 'gha-999-1', project_id: 'synthetic-app',
  profile_id: 'integration-ci', source_sha: sourceSha, kind: 'angular-validate' };
const profile = { schema_version: 1, profile_id: 'integration-ci', angular_version: '22.0.0',
  capabilities: ['angular','workspace','static-dist'], mode: 'angular-only', mount: '/',
  bundle_hints: { index: 'index.html', angular_host: 'sac-smoke',
    angular_entrypoints: ['main.js'], assets: ['styles.css'], legacy_react_entrypoints: [] },
  rules: ['SAC-PRE001','SAC-P001'].map(rule_id => ({ rule_id, version: '1.0.0',
    required: true, enforcement: 'blocking' })) };
const resources = { workspace, dist: 'dist/browser',
  sourceFiles: ['package.json','package-lock.json','angular.json','tsconfig.json',
    'src/main.ts','src/mode.ts','src/index.html','src/styles.css'] };
const guardian = { schema_version: 1, timeout_ms: 2000,
  cases: [{ id: 'button-updates-dom', path: '/', expect_visible: ['h1'],
    actions: [{ click: 'button', expect_visible: '.done' }] }] };
const write = async (name, value) => {
  const target = path.join(dir, name);
  await writeFile(target, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  return target;
};
const test = (manifest, source) => {
  const proc = spawnSync(process.execPath,
    [path.join(root, 'scripts/sac_supervised_runner.mjs'), '--manifest', manifest], {
      cwd: root, input: JSON.stringify({ ...job, source_sha: source }), encoding: 'utf8',
      timeout: 100000, maxBuffer: 30000,
      env: { PATH: process.env.PATH, HOME: os.tmpdir() }
    });
  assert.equal(proc.status, 0, 'auditor failed to run');
  const report = proc.stdout.split('\n').filter(line => line.startsWith('SAC_AUDIT_RESULT '));
  assert.equal(report.length, 1, proc.stdout.slice(0, 3500));
  return JSON.parse(report[0].slice('SAC_AUDIT_RESULT '.length));
};
try {
  await writeFile(path.join(workspace, 'src/mode.ts'), "export const mode: string = 'positive';\n");
  await writeFile(path.join(workspace, 'src/index.html'),
    '<html><head><base href="/"></head><body><sac-smoke></sac-smoke></body></html>');
  const pre = await prepareBuild({ profile, resources, sourceSha, key });
  assert.ok(pre.session, JSON.stringify(pre.report));
  await rm(path.join(workspace, 'dist'), { recursive: true, force: true });
  const build = spawnSync(process.execPath,
    ['node_modules/@angular/cli/bin/ng.js', 'build', 'smoke'], { cwd: workspace,
      shell: false, timeout: 120000, stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, NG_CLI_ANALYTICS: 'false' } });
  assert.equal(build.status, 0, 'official Angular AOT build failed');
  const receipt = await sealBuild({ profile, resources, sourceSha, key,
    session: pre.session, buildStatus: 'pass' });
  const keyFile = await write('secret-key', key);
  const receiptFile = await write('receipt.json', receipt);
  const manifest = await write('manifest.json', {
    schema_version: 1, project_id: job.project_id, profile_id: job.profile_id,
    workspace, profile_file: await write('profile.json', profile),
    resources_file: await write('resources.json', resources), receipt_file: receiptFile,
    guardian_file: await write('guardian.json', guardian), trust_key_file: keyFile,
    sandbox_image: image
  });
  const passed = test(manifest, sourceSha);
  assert.equal(passed.status, 'pass', JSON.stringify(passed));
  assert.equal(passed.static_pipeline_pass, true);
  assert.equal(passed.browser_pass, true);
  assert.equal(passed.deployment_authorized, false);

  const badSha = test(manifest, 'f'.repeat(40));
  assert.notEqual(badSha.status, 'pass', 'mismatched checkout must not verify');
  await writeFile(receiptFile, JSON.stringify({ ...receipt, signature: '0'.repeat(64) }));
  const tampered = test(manifest, sourceSha);
  assert.notEqual(tampered.status, 'pass', 'invalid CI receipt must not verify');
  console.log('SAC-008C: official Angular AOT + isolated Chromium verified; SHA/receipt negatives rejected');
} finally {
  await rm(dir, { recursive: true, force: true });
}

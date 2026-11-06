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
const test = (manifest, source, enableBuild = false) => {
  const proc = spawnSync(process.execPath,
    [path.join(root, 'scripts/sac_supervised_runner.mjs'), '--manifest', manifest,
      ...(enableBuild ? ['--enable-build'] : [])], {
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
  const manifestData = {
    schema_version: 1, project_id: job.project_id, profile_id: job.profile_id,
    workspace, profile_file: await write('profile.json', profile),
    resources_file: await write('resources.json', resources), receipt_file: receiptFile,
    guardian_file: await write('guardian.json', guardian), trust_key_file: keyFile,
    sandbox_image: image
  };
  const manifest = await write('manifest.json', manifestData);

  // Exercise the actual Node supervisor (not just the pure formatter).
  // Angular 22 is installed in this fixture, but the operator-approved
  // synthetic profile claims 19.0.0. The supervisor must block the build
  // before invoking Docker/Guardian and report the verified preflight phase.
  const incompatibleProfileFile = await write('incompatible-profile.json',
    { ...profile, angular_version: '19.0.0' });
  const blockedManifest = await write('blocked-manifest.json', {
    ...manifestData, profile_file: incompatibleProfileFile,
    build: { project_name: 'smoke' }
  });
  const blocked = test(blockedManifest, sourceSha, true);
  assert.equal(blocked.status, 'fail', JSON.stringify(blocked));
  assert.equal(blocked.code, 'preflight-failed');
  assert.equal(blocked.execution, 'sac-build-audit');
  assert.equal(blocked.static_pipeline_pass, false);
  assert.equal(blocked.browser_pass, false);
  assert.equal(blocked.deployment_authorized, false);
  assert.equal(blocked.diagnostic.checks.pre, 'fail');
  assert.equal(blocked.diagnostic.checks.build, 'unverified');
  assert.equal(blocked.diagnostic.checks.post, 'unverified');
  assert.equal(blocked.diagnostic.checks.browser, 'unverified');
  assert.ok(blocked.diagnostic.findings.some(f =>
    f.phase === 'pre' && f.code === 'profile-installed-angular-mismatch'),
    JSON.stringify(blocked));
  assert.equal('technical_report' in blocked, false);
  console.log('SAC_PREFLIGHT_SUPERVISOR_BLOCKS_DOCKER_PASS');

  // The dependency preflight succeeds, but the trusted snapshot references a
  // source that does not exist. This must NOT be called a preflight failure.
  const unavailableResources=await write('unavailable-resources.json',{
    ...resources,sourceFiles:[...resources.sourceFiles,'src/missing-source.ts']
  });
  const incompleteManifest=await write('incomplete-manifest.json',{
    ...manifestData,resources_file:unavailableResources,build:{project_name:'smoke'}
  });
  const snapshotBlocked=test(incompleteManifest,sourceSha,true);
  assert.equal(snapshotBlocked.status,'unverified',JSON.stringify(snapshotBlocked));
  assert.equal(snapshotBlocked.code,'build-prerequisites-unverified');
  assert.equal(snapshotBlocked.diagnostic.checks.pre,'pass');
  assert.equal(snapshotBlocked.diagnostic.checks.build,'unverified');
  assert.equal(snapshotBlocked.diagnostic.checks.browser,'unverified');
  assert.equal(snapshotBlocked.deployment_authorized,false);
  assert.equal('technical_report' in snapshotBlocked,false);
  console.log('SAC_SNAPSHOT_NO_FALSE_PREFLIGHT_FAILURE_PASS');

  const passed = test(manifest, sourceSha);
  assert.equal(passed.status, 'pass', JSON.stringify(passed));
  assert.equal(passed.static_pipeline_pass, true);
  assert.equal(passed.browser_pass, true);
  assert.equal(passed.deployment_authorized, false);
  assert.equal(passed.diagnostic?.schema_version, 1);
  assert.equal(passed.diagnostic.status, 'pass');
  assert.deepEqual(passed.diagnostic.findings, []);
  assert.equal(passed.diagnostic.location_verified, false);
  assert.equal(passed.diagnostic.deployment_authorized, false);

  // End-to-end 008B inbox -> Python supervisor -> fixed Node auditor -> Docker Guardian.
  const python = `
import json,sys
from pathlib import Path
from scripts import sac_job_queue as queue
from scripts import sac_execution as executor
state=Path(sys.argv[1]) / "one-worker"
policy={"schema_version":1,"projects":[{"project_id":"synthetic-app","profile_id":"integration-ci"}]}
registry={"schema_version":1,"projects":[{"project_id":"synthetic-app","profile_id":"integration-ci","manifest":sys.argv[2]}]}
job={"schema_version":1,"job_id":"gha-999-1","project_id":"synthetic-app",
     "profile_id":"integration-ci","source_sha":sys.argv[3],"kind":"angular-validate"}
queue.enqueue(state,job,policy)
received=queue.receive_pending(state,policy)
assert received["received"]==1, received
first=executor.execute_received(state,policy,registry,executor=sys.argv[4],timeout=100)
assert first["processed"]==1, first
result=json.loads((state/"sac-results"/"gha-999-1.json").read_text())
assert result["status"]=="pass" and result["browser_pass"]==True and result["deployment_authorized"]==False, result
assert result["diagnostic"]["status"]=="pass" and result["diagnostic"]["checks"]["browser"]=="pass", result
assert result["diagnostic"]["location_verified"]==False and result["diagnostic"]["deployment_authorized"]==False, result
again=executor.execute_received(state,policy,registry,executor=sys.argv[4],timeout=100)
assert again["processed"]==0, again
print("SAC_WORKER_CHAIN_PASS")
`;
  const chain = spawnSync('python3', ['-c', python, dir, manifest, sourceSha, process.execPath], {
    cwd: root, encoding: 'utf8', timeout: 130000, maxBuffer: 20000,
    env: { PATH: process.env.PATH, HOME: os.tmpdir() }
  });
  assert.equal(chain.status, 0, chain.stderr?.slice(0, 3000));
  assert.match(chain.stdout, /SAC_WORKER_CHAIN_PASS/);
  const badSha = test(manifest, 'f'.repeat(40));
  assert.notEqual(badSha.status, 'pass', 'mismatched checkout must not verify');
  assert.equal(badSha.diagnostic.status, 'infra-error');
  await writeFile(receiptFile, JSON.stringify({ ...receipt, authentication: '0'.repeat(64) }));
  const tampered = test(manifest, sourceSha);
  assert.notEqual(tampered.status, 'pass', 'invalid CI receipt must not verify');
  assert.equal(tampered.diagnostic.deployment_authorized, false);
  console.log('SAC-008C: official Angular AOT + isolated Chromium verified; SHA/receipt negatives rejected');
} finally {
  await rm(dir, { recursive: true, force: true });
}

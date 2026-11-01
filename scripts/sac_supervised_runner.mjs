// SAC-008C trusted host auditor. All executable paths come from installed code.
// stdin carries only the 008B identity; the root-owned manifest supplies resources.
// Never execute npm, shell, git checkout, deployment or source-defined scripts.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyPipelineBrowserSandbox } from '../packages/angular-guardian/src/sandbox.mjs';

const code = /^[a-z][a-z0-9-]{0,63}$/;
const sha = /^[a-f0-9]{40}$/;
const pinned = /^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/;
const record = (value, keys) => value && !Array.isArray(value) &&
  typeof value === 'object' && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function fail(job, reason) {
  return { schema_version: 1, job_id: job.job_id, project_id: job.project_id,
    profile_id: job.profile_id, source_sha: job.source_sha, status: 'infra-error',
    static_pipeline_pass: false, browser_pass: false, deployment_authorized: false,
    execution: 'sac-audit', code: reason };
}
let job;
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--manifest' || !path.isAbsolute(process.argv[3])) throw Error('args');
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 2048) throw Error('too-large');
  }
  job = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!record(job, ['schema_version', 'job_id', 'project_id', 'profile_id', 'source_sha', 'kind']) ||
      job.schema_version !== 1 || job.kind !== 'angular-validate' ||
      !/^gha-[0-9]{1,15}-[1-9][0-9]{0,3}$/.test(job.job_id) ||
      !code.test(job.project_id) || !code.test(job.profile_id) || !sha.test(job.source_sha)) throw Error('identity');
  const manifest = JSON.parse(await readFile(process.argv[3], 'utf8'));
  if (!record(manifest, ['schema_version','project_id','profile_id','workspace','profile_file',
    'resources_file','receipt_file','guardian_file','trust_key_file','sandbox_image'])) throw Error('manifest');
  if (manifest.schema_version !== 1 || manifest.project_id !== job.project_id ||
      manifest.profile_id !== job.profile_id || !pinned.test(manifest.sandbox_image)) throw Error('policy');
  if (![manifest.workspace, manifest.profile_file, manifest.resources_file, manifest.receipt_file,
    manifest.guardian_file, manifest.trust_key_file].every(v => typeof v === 'string' && path.isAbsolute(v))) throw Error('resources');
  // Local checkout check: selected source SHA must be the actual checkout revision,
  // not only a user-supplied JSON claim. SourceFiles and the CI receipt add coverage.
  const revision = execFileSync('git', ['-C', manifest.workspace, 'rev-parse', '--verify', 'HEAD'],
    { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (revision !== job.source_sha) throw Error('revision');
  const [profile, resources, receipt, guardian, key] = await Promise.all([
    readFile(manifest.profile_file, 'utf8').then(JSON.parse),
    readFile(manifest.resources_file, 'utf8').then(JSON.parse),
    readFile(manifest.receipt_file, 'utf8').then(JSON.parse),
    readFile(manifest.guardian_file, 'utf8').then(JSON.parse),
    readFile(manifest.trust_key_file),
  ]);
  if (resources.workspace !== manifest.workspace || profile.profile_id !== job.profile_id ||
      key.length < 32) throw Error('binding');
  const result = await verifyPipelineBrowserSandbox({
    pipeline: { profile, resources, sourceSha: job.source_sha, receipt, key },
    guardian, image: manifest.sandbox_image, timeoutMs: 60000,
  });
  const verified = result.static_pipeline_pass === true && result.browser_pass === true &&
    result.network_isolation === 'container-network-none' &&
    result.deployment_authorized === false && result.browser?.sandbox === 'docker-network-none';
  const status = verified ? 'pass' : result.browser?.status === 'fail' || result.status === 'fail' ? 'fail'
    : 'unverified';
  const response = { schema_version: 1, job_id: job.job_id, project_id: job.project_id,
    profile_id: job.profile_id, source_sha: job.source_sha,
    status, static_pipeline_pass: result.static_pipeline_pass === true,
    browser_pass: verified, deployment_authorized: false, execution: 'sac-audit',
    code: verified ? 'isolated-browser-pass' : 'audit-not-verified' };
  process.stdout.write('SAC_AUDIT_RESULT ' + JSON.stringify(response) + '\n');
} catch {
  if (job && typeof job.job_id === 'string' && /^gha-[0-9]{1,15}-[1-9][0-9]{0,3}$/.test(job.job_id)) {
    process.stdout.write('SAC_AUDIT_RESULT ' + JSON.stringify(fail(job, 'audit-infrastructure-error')) + '\n');
  } else {
    process.exitCode = 2;
  }
}

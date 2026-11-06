// SAC-008C trusted host auditor. All executable paths come from installed code.
// stdin carries only the 008B identity; the root-owned manifest supplies resources.
// Never execute npm, shell, git checkout, deployment or source-defined scripts.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyPipelineBrowserSandbox } from '../packages/angular-guardian/src/sandbox.mjs';
import { prepareBuild, sealBuild } from '../packages/angular-pipeline/src/index.mjs';
import { isolatedAngularBuild } from './sac_sandbox_builder.mjs';
import { makeDiagnosticReport } from './sac_diagnostic_report.mjs';
import { makeBuildTechnicalReport } from './sac_technical_report.mjs';
import { makeBlockedPreflightResult } from './sac_preflight_result.mjs';

const code = /^[a-z][a-z0-9-]{0,63}$/;
const sha = /^[a-f0-9]{40}$/;
const pinned = /^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/;
const record = (value, keys) => value && !Array.isArray(value) &&
  typeof value === 'object' && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
let buildRequested = false;
function fail(job, reason) {
  return { schema_version: 1, job_id: job.job_id, project_id: job.project_id,
    profile_id: job.profile_id, source_sha: job.source_sha, status: 'infra-error',
    static_pipeline_pass: false, browser_pass: false, deployment_authorized: false,
    execution: buildRequested ? 'sac-build-audit' : 'sac-audit', code: reason,
    diagnostic: makeDiagnosticReport({status:'infra-error',browser:{status:'infra-error',code:reason,cases:[]}}) };
}
let job;
try {
  if (![4,5].includes(process.argv.length) || process.argv[2] !== '--manifest' ||
      !path.isAbsolute(process.argv[3]) ||
      (process.argv.length === 5 && process.argv[4] !== '--enable-build')) throw Error('args');
  buildRequested = process.argv.length === 5;
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
  const manifestKeys = ['schema_version','project_id','profile_id','workspace','profile_file',
    'resources_file','receipt_file','guardian_file','trust_key_file','sandbox_image'];
  if (!record(manifest, buildRequested ? [...manifestKeys,'build'] : manifestKeys)) throw Error('manifest');
  if (buildRequested && (!record(manifest.build, ['project_name']) ||
      !code.test(manifest.build.project_name))) throw Error('build-policy');
  if (manifest.schema_version !== 1 || manifest.project_id !== job.project_id ||
      manifest.profile_id !== job.profile_id || !pinned.test(manifest.sandbox_image)) throw Error('policy');
  if (![manifest.workspace, manifest.profile_file, manifest.resources_file, manifest.receipt_file,
    manifest.guardian_file, manifest.trust_key_file].every(v => typeof v === 'string' && path.isAbsolute(v))) throw Error('resources');
  // Local checkout check: selected source SHA must be the actual checkout revision,
  // not only a user-supplied JSON claim. SourceFiles and the CI receipt add coverage.
  const revision = execFileSync('git', ['-C', manifest.workspace, 'rev-parse', '--verify', 'HEAD'],
    { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (revision !== job.source_sha) throw Error('revision');
  const [profile, resources, existingReceipt, guardian, key] = await Promise.all([
    readFile(manifest.profile_file, 'utf8').then(JSON.parse),
    readFile(manifest.resources_file, 'utf8').then(JSON.parse),
    buildRequested ? Promise.resolve(null) : readFile(manifest.receipt_file, 'utf8').then(JSON.parse),
    readFile(manifest.guardian_file, 'utf8').then(JSON.parse),
    readFile(manifest.trust_key_file),
  ]);
  if (resources.workspace !== manifest.workspace || profile.profile_id !== job.profile_id ||
      key.length < 32) throw Error('binding');
  let receipt = existingReceipt;
  let factualBuildFailure = null;
  if (buildRequested) {
    const params = { profile, resources, sourceSha: job.source_sha, key };
    const { session, report: preflightReport } = await prepareBuild(params);
    if (!session) {
      factualBuildFailure = makeBlockedPreflightResult(job, preflightReport);
    }
    if (session) {
      const built = await isolatedAngularBuild({
      resources, projectName: manifest.build.project_name,
      image: manifest.sandbox_image, timeoutMs: 120000
    });
    if (built.status === 'fail' && built.code === 'angular-compiler-failed' &&
        built.compiler_evidence) {
      // An observed TS/NG compiler error is a code failure, not a Docker infra error.
      const technical_report = makeBuildTechnicalReport(job, built.compiler_evidence);
      const diagnostic = makeDiagnosticReport({
        status:'fail',
        static_result:{phases:{
          pre:{status:'pass'},
          build:{status:'fail',code:'angular-compiler-failed'},
          post:{status:'unverified',code:'not-executed'}
        }},
        browser:{status:'unverified',executed:false,code:'not-executed',cases:[]}
      });
      factualBuildFailure = {schema_version:1,job_id:job.job_id,
        project_id:job.project_id,profile_id:job.profile_id,
        source_sha:job.source_sha,status:'fail',static_pipeline_pass:false,
        browser_pass:false,deployment_authorized:false,
        execution:'sac-build-audit',code:'angular-compiler-failed',
        diagnostic,technical_report};
    } else {
      if (!built.built || built.status !== 'pass') throw Error('isolated-build');
      receipt = await sealBuild({ ...params, session, buildStatus: 'pass' });
    }
    }
  }
  if (factualBuildFailure) {
    process.stdout.write('SAC_AUDIT_RESULT ' + JSON.stringify(factualBuildFailure) + '\n');
  } else {
  const result = await verifyPipelineBrowserSandbox({
    pipeline: { profile, resources, sourceSha: job.source_sha, receipt, key },
    guardian, image: manifest.sandbox_image, timeoutMs: 60000,
  });
  const verified = result.static_pipeline_pass === true && result.browser_pass === true &&
    result.network_isolation === 'container-network-none' &&
    result.deployment_authorized === false && result.browser?.sandbox === 'docker-network-none';
  const diagnostic = makeDiagnosticReport(result);
  const status = diagnostic.status;
  const response = { schema_version: 1, job_id: job.job_id, project_id: job.project_id,
    profile_id: job.profile_id, source_sha: job.source_sha,
    status, static_pipeline_pass: result.static_pipeline_pass === true,
    browser_pass: verified, deployment_authorized: false, execution: buildRequested ? 'sac-build-audit' : 'sac-audit',
    code: verified ? (buildRequested ? 'isolated-build-browser-pass' : 'isolated-browser-pass') : 'audit-not-verified',
    diagnostic };
  process.stdout.write('SAC_AUDIT_RESULT ' + JSON.stringify(response) + '\n');
  }
} catch {
  if (job && typeof job.job_id === 'string' && /^gha-[0-9]{1,15}-[1-9][0-9]{0,3}$/.test(job.job_id)) {
    process.stdout.write('SAC_AUDIT_RESULT ' + JSON.stringify(fail(job, 'audit-infrastructure-error')) + '\n');
  } else {
    process.exitCode = 2;
  }
}

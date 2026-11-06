/**
 * Transport a trusted prepareBuild() rejection without pretending Docker or
 * Chromium ran. The caller has already checked local job and checkout identity.
 * This is NOT a build receipt, evidence of deployment, or permission to execute.
 */
import { makeDiagnosticReport } from './sac_diagnostic_report.mjs';

const JOB=/^gha-[0-9]{1,15}-[1-9][0-9]{0,3}$/;
const ID=/^[a-z][a-z0-9-]{0,63}$/;
const SHA=/^[a-f0-9]{40}$/;
const phaseStates=new Set(['pass','fail','unverified','infra-error']);
const blockedStates=new Set(['fail','unverified','infra-error']);

export function makeBlockedPreflightResult(job, report) {
  if (!job || job.schema_version!==1 || job.kind!=='angular-validate' ||
      !JOB.test(job.job_id) || !ID.test(job.project_id) ||
      !ID.test(job.profile_id) || !SHA.test(job.source_sha)) {
    throw Error('invalid-preflight-job');
  }
  const pre=report?.phases?.pre;
  const snapshot=report?.phases?.build;
  const acceptedSnapshot=snapshot && snapshot.status===report?.status &&
    blockedStates.has(snapshot.status) && snapshot.code!=='not-executed';
  if (!pre || !phaseStates.has(pre.status) || !blockedStates.has(report.status) ||
      (pre.status==='pass'
        ? !(acceptedSnapshot || (report.status==='unverified' &&
            snapshot?.status==='unverified' && snapshot?.code==='not-executed'))
        : pre.status!==report.status)) {
    throw Error('invalid-preflight-evidence');
  }
  const status=report.status;
  const code=pre.status==='pass'
    ? status==='fail' ? 'build-prerequisites-failed'
      : status==='infra-error' ? 'build-prerequisites-infra-error'
      : 'build-prerequisites-unverified'
    : status==='fail' ? 'preflight-failed'
      : status==='infra-error' ? 'preflight-infra-error' : 'preflight-unverified';
  // Missing preflight evidence must not turn into an unrelated browser error.
  const preEntry=pre.status==='pass'?{status:'pass'}:
    {...pre, code: typeof pre.code==='string' ? pre.code : code};
  const buildEntry=pre.status==='pass'
    ? {status:'unverified',code}
    : {status:'unverified',code:'not-executed'};
  const diagnostic=makeDiagnosticReport({
    status,static_pipeline_pass:false,browser_pass:false,
    deployment_authorized:false,
    static_result:{phases:{
      pre:preEntry,build:buildEntry,
      post:{status:'unverified',code:'not-executed'}
    }},
    browser:{status:'unverified',executed:false,code:'not-executed',cases:[]}
  });
  if (diagnostic.status!==status || diagnostic.checks.browser!=='unverified' ||
      diagnostic.checks.build!=='unverified') throw Error('invalid-preflight-diagnostic');
  return {
    schema_version:1,job_id:job.job_id,project_id:job.project_id,
    profile_id:job.profile_id,source_sha:job.source_sha,
    status,static_pipeline_pass:false,browser_pass:false,
    deployment_authorized:false,execution:'sac-build-audit',code,diagnostic
  };
}

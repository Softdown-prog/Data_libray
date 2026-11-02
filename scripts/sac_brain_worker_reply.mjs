/** Safe reader of the *sanitized* result of Panel's sac_worker job query.
 * No network; checking JSON shape cannot authenticate GitHub/OIDC provenance. */
import {analyzeSacDiagnostic} from './sac_brain.mjs';
const SLUG=/^[a-z][a-z0-9-]{0,63}$/;
const JOB=/^gha-[0-9]{1,15}-[1-9][0-9]{0,3}$/;
const SHA=/^[a-f0-9]{40}$/;
const RUN=/^[0-9]{1,15}$/;
const REF=/^[0-9]{1,15}-[1-9][0-9]{0,3}-sac_worker-infrastructure$/;
const STATES=['pass','fail','unverified','infra-error'];
const EXEC=['sac-audit','sac-build-audit'];
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const good=(v,re)=>typeof v==='string'&&re.test(v);
const fail=()=>{throw Error('invalid-worker-reply');};
const unknown=code=>({schema_version:1,engine:'sac-brain-v1',
 source:'panel-sac-worker-job',status:'unverified',code,
 origin_verified:false,read_only:true,deployment_authorized:false,findings:[]});
export function interpretWorkerReply(reply){
 if(!obj(reply)||JSON.stringify(reply).length>16384||reply.exitCode!==0)
  return unknown('worker-query-not-completed');
 if(reply.operation!=='sac_worker'||reply.project!=='infrastructure'||
  !good(reply.runId,RUN)||!good(reply.id,REF)||
  !reply.id.startsWith(reply.runId+'-')||!obj(reply.sacWorker))fail();
 const w=reply.sacWorker;
 if(w.action!=='job'||w.readOnly!==true||!good(w.jobId,JOB))fail();
 if(w.status==='not-recorded')return {...unknown('job-not-recorded'),job_id:w.jobId};
 if(!STATES.includes(w.status)||!good(w.projectId,SLUG)||
  !good(w.profileId,SLUG)||!good(w.sourceSha,SHA)||
  !good(w.code,SLUG)||!EXEC.includes(w.execution)||
  typeof w.staticPipelinePass!=='boolean'||typeof w.browserPass!=='boolean'||
  w.deploymentAuthorized!==false||
  (w.browserPass&&!w.staticPipelinePass))fail();
 if(w.status==='pass'&&(!w.staticPipelinePass||!w.browserPass||
  w.code!==(w.execution==='sac-build-audit'?
   'isolated-build-browser-pass':'isolated-browser-pass')))fail();
 const identity={job_id:w.jobId,project_id:w.projectId,
  profile_id:w.profileId,source_sha:w.sourceSha};
 if(!Object.prototype.hasOwnProperty.call(w,'diagnostic'))
  return {...unknown('worker-diagnostic-not-recorded'),...identity,worker_status:w.status};
 const report=analyzeSacDiagnostic(w.diagnostic);
 if(report.status!==w.status)fail();
 return {schema_version:1,engine:'sac-brain-v1',source:'panel-sac-worker-job',
  status:report.status,code:'diagnostic-available',...identity,
  worker_execution:w.execution,static_pipeline_pass:w.staticPipelinePass,
  browser_pass:w.browserPass,known:report.known,unknown:report.unknown,
  checks:report.checks,findings:report.findings,truncated:report.truncated,
  root_cause_verified:false,file_location_verified:false,
  origin_verified:false,read_only:true,deployment_authorized:false};
}

/**
 * SAC-041: immutable, bounded, factual sidecar for postcompiler/Guardian failures.
 *
 * Source is a trusted verifyPipelineBrowserSandbox result with an authenticated
 * build receipt. This module does NOT authenticate receipts, start processes,
 * diagnose causes or replace the historical Worker schema v1.
 */
import { makeDiagnosticReport } from './sac_diagnostic_report.mjs';

const JOB=/^gha-[0-9]{1,15}-[1-9][0-9]{0,3}$/;
const ID=/^[a-z][a-z0-9-]{0,63}$/;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const STATUS=new Set(['fail','infra-error','unverified']);
const POST_CODES=new Set([
  'legacy-static-result','legacy-static-check','mount-mismatch',
  'artifact-mismatch','diagnostic-unclassified'
]);
const BROWSER_CODES=new Set([
  'application-pageerror','application-console-error','http-error','request-failed',
  'network-policy-blocked','websocket-blocked','popup-blocked',
  'unexpected-navigation','required-assertion-failed','no-observable-transition',
  'angular-bootstrap-unverified','browser-timeout','contract-missing',
  'artifact-mutated-during-browser','browser-isolation-unverified',
  'invalid-browser-contract','sandbox-runtime-error','sandbox-timeout',
  'sandbox-preparation-error','sandbox-report-invalid','sandbox-report-missing',
  'browser-infrastructure','diagnostic-unclassified'
]);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&
  !Array.isArray(value)&&Object.keys(value).sort().join(',')===
  keys.slice().sort().join(',');
const invalid=()=>{throw Error('invalid-factual-phase-evidence');};
const sanitize=(value,allowed)=>allowed.has(value)?value:'diagnostic-unclassified';
const assertion=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(value)
  ?value:null;
const check=(r,phase)=>r.checks[phase];
const TEXT_STATUS={pass:'aprovado',fail:'falhou',
  unverified:'não comprovado','infra-error':'erro de infraestrutura',
  'not-run':'não executado'};
function projectText(report){
  const lines=[
    'Projeto '+report.project_id+', commit '+report.source_sha+'.',
    'Pré-compilação: '+TEXT_STATUS[check(report,'pre')]+'.',
    'Build autenticado: '+TEXT_STATUS[check(report,'build')]+'.',
    'Pós-compilação: '+TEXT_STATUS[check(report,'post')]+'.',
    'Guardian: '+TEXT_STATUS[check(report,'browser')]+'.',
    'Etapa registrada: '+(report.phase==='post'?'pós-compilação':'Guardian')+
      '; estado: '+TEXT_STATUS[report.status]+
      '; executada: '+(report.executed?'sim':'não')+'.'
  ];
  for(const f of report.findings){
    lines.push('Evento observado em '+(f.phase==='post'?'pós-compilação':'Guardian')+
      ': '+f.code+(f.assertion===null?'':'; cenário/verificação '+f.assertion)+'.');
  }
  if(report.truncated)lines.push('Outras ocorrências foram omitidas pelo limite do coletor.');
  if(report.blocked_by==='post'){
    lines.push('Guardian não executado porque a pós-compilação não foi aprovada.');
  }
  lines.push('Arquivo, linha e coluna: não comprovados por este relatório.');
  lines.push('Este relatório não atribui causa raiz, não sugere correções e não autoriza deploy.');
  return lines.join('\n');
}
export function validatePhaseEvidenceV2(report){
  if(!exact(report,['schema_version','source','job_id','project_id','profile_id',
    'source_sha','phase','status','executed','checks','findings','truncated',
    'blocked_by','location_verified','root_cause_verified',
    'deployment_authorized','text'])||
    report.schema_version!==2||report.source!=='authenticated-angular-pipeline'||
    !JOB.test(report.job_id)||!ID.test(report.project_id)||
    !ID.test(report.profile_id)||!SHA.test(report.source_sha)||
    !['post','browser'].includes(report.phase)||!STATUS.has(report.status)||
    typeof report.executed!=='boolean'||
    !exact(report.checks,['pre','build','post','browser'])||
    report.checks.pre!=='pass'||report.checks.build!=='pass'||
    !['pass',...STATUS].includes(report.checks.post)||
    !['pass',...STATUS,'not-run'].includes(report.checks.browser)||
    !Array.isArray(report.findings)||report.findings.length>8||
    typeof report.truncated!=='boolean'||
    report.location_verified!==false||report.root_cause_verified!==false||
    report.deployment_authorized!==false||
    typeof report.text!=='string')invalid();
  if(report.phase==='post'){
    if(report.executed!==true||report.checks.post!==report.status||
      report.checks.browser!=='not-run'||report.blocked_by!=='post')invalid();
  }else if(report.checks.post!=='pass'||report.checks.browser!==report.status||
    report.blocked_by!==null)invalid();
  const known=report.phase==='post'?POST_CODES:BROWSER_CODES;
  for(const f of report.findings){
    if(!exact(f,['phase','status','code','assertion'])||
      f.phase!==report.phase||!STATUS.has(f.status)||
      !known.has(f.code)||f.assertion!==assertion(f.assertion)||
      f.code.length>64)invalid();
  }
  if(projectText(report)!==report.text||JSON.stringify(report).length>4096)invalid();
  return report;
}
export function makePhaseEvidenceV2(job,result){
  if(!exact(job,['schema_version','job_id','project_id','profile_id','source_sha','kind'])||
    job.schema_version!==1||job.kind!=='angular-validate'||!JOB.test(job.job_id)||
    !ID.test(job.project_id)||!ID.test(job.profile_id)||!SHA.test(job.source_sha)||
    result?.deployment_authorized!==false||result.browser_pass!==false)invalid();
  const staticReport=result?.static_result;
  const pre=staticReport?.phases?.pre;
  const build=staticReport?.phases?.build;
  const post=staticReport?.phases?.post;
  const browser=result?.browser;
  if(staticReport?.source_sha_claim!==job.source_sha||
    staticReport?.profile_id!==job.profile_id||
    pre?.status!=='pass'||build?.status!=='pass'||
    build.code!=='authenticated-ci-build'||!DIGEST.test(build.artifact_digest)||
    !post||!browser)invalid();

  let phase,status,executed,blockedBy;
  if(STATUS.has(post.status)){
    if(post.executed!==true||result.static_pipeline_pass!==false||
      result.status!==post.status||browser.status!=='unverified'||
      browser.executed!==false||browser.code!=='not-executed')invalid();
    phase='post';status=post.status;executed=true;blockedBy='post';
  }else if(post.status==='pass' && result.static_pipeline_pass===true &&
    STATUS.has(browser.status)&&result.status===browser.status){
    phase='browser';status=browser.status;executed=browser.executed;
    blockedBy=null;
    if(typeof executed!=='boolean')invalid();
    if(executed &&
      (browser.sandbox!=='docker-network-none'||
       result.network_isolation!=='container-network-none'||
       result.binding?.source_sha_claim!==job.source_sha||
       result.binding?.artifact_digest!==build.artifact_digest))invalid();
    if(!executed&&Array.isArray(browser.cases)&&browser.cases.length)invalid();
  }else invalid();

  const checks={pre:'pass',build:'pass',post:post.status,
    browser:phase==='post'?'not-run':browser.status};
  const legacy=makeDiagnosticReport(result);
  const allowed=phase==='post'?POST_CODES:BROWSER_CODES;
  const findings=legacy.findings.filter(f=>f.phase===phase).map(f=>({
    phase,status:f.status,code:sanitize(f.code,allowed),assertion:assertion(f.assertion)
  })).slice(0,8);
  // The legacy formatter may contain unrelated advice; only fixed code tokens
  // and safe assertion IDs are carried into this factual sidecar.
  if(findings.length===0){
    const possible=phase==='post'?post.code:browser.code;
    findings.push({phase,status,code:sanitize(possible,allowed),assertion:null});
  }
  const report={schema_version:2,source:'authenticated-angular-pipeline',
    job_id:job.job_id,project_id:job.project_id,profile_id:job.profile_id,
    source_sha:job.source_sha,phase,status,executed,checks,
    findings,truncated:legacy.truncated,blocked_by:blockedBy,
    location_verified:false,root_cause_verified:false,
    deployment_authorized:false,text:''};
  report.text=projectText(report);
  return validatePhaseEvidenceV2(report);
}

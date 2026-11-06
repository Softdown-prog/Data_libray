import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeBuildTechnicalReport,validateTechnicalReport} from '../scripts/sac_technical_report.mjs';
const job={schema_version:1,job_id:'gha-456-1',project_id:'synthetic-app',
 profile_id:'angular-test',source_sha:'a'.repeat(40),kind:'angular-validate'};
const issue={tool:'typescript',code:'TS2322',file:'src/mode.ts',line:1,column:13,
 message:'O compilador TypeScript registrou atribuição entre tipos incompatíveis.',
 location_verified:true};
const evidence={schema_version:2,source:'angular-cli-compiler-output',phase:'build',
 status:'fail',exit_code:1,findings:[issue],truncated:false,location_verified:true,
 post_status:'not-run',browser_status:'not-run',
 root_cause_verified:false,deployment_authorized:false};
test('creates deterministic report bound to source SHA and actual code location',()=>{
 const a=makeBuildTechnicalReport(job,evidence);
 assert.deepEqual(a,makeBuildTechnicalReport(job,evidence));
 assert.match(a.text,/TS2322/);assert.match(a.text,/src\/mode.ts, linha 1, coluna 13/);
 assert.match(a.text,/não executados/);
 assert.equal(a.deployment_authorized,false);
 assert.equal(a.root_cause_verified,false);
 assert.ok(JSON.stringify(a).length<4096);
});
test('missing location cannot become fabricated',()=>{
 const f={...issue,file:null,line:null,column:null,location_verified:false};
 const a=makeBuildTechnicalReport(job,{...evidence,findings:[f],location_verified:false});
 assert.match(a.text,/posição não confirmados/);
 assert.equal(a.findings[0].file,null);
});
test('invalid job identity and extra evidence fields fail closed',()=>{
 assert.throws(()=>makeBuildTechnicalReport({...job,source_sha:'wrong'},evidence));
 assert.throws(()=>makeBuildTechnicalReport(job,{...evidence,secret:'LEAK'}));
 assert.throws(()=>makeBuildTechnicalReport(job,{...evidence,findings:[{...issue,
  message:'Arbitrary user log SECRET'}]}));
});
test('forged pass, root cause, deployment, missing phase and arbitrary text rejected',()=>{
 const valid=makeBuildTechnicalReport(job,evidence);
 for(const forged of [
  {...valid,status:'pass'}, {...valid,root_cause_verified:true},
  {...valid,deployment_authorized:true},{...valid,post_status:'pass'},
  {...valid,text:'Trabalho aprovado. SECRET'}
 ]) assert.throws(()=>validateTechnicalReport(forged));
});
test('truncation and unknown TS code remain factual',()=>{
 const f={...issue,code:'TS9999',
  message:'O compilador Angular registrou um erro TypeScript.'};
 const r=makeBuildTechnicalReport(job,{...evidence,findings:[f],truncated:true});
 assert.match(r.text,/ocorrências omitidas/);
 assert.match(r.text,/TS9999/);
});

test('NG template diagnostics remain factual and tied to the same job',()=>{
 const ng={tool:'angular',code:'NG8002',file:'src/view.html',line:3,column:6,
  message:'O compilador Angular registrou um diagnóstico NG.',location_verified:true};
 const report=makeBuildTechnicalReport(job,{...evidence,findings:[ng]});
 assert.equal(report.findings[0].tool,'angular');
 assert.match(report.text,/NG8002 no arquivo src\/view.html, linha 3, coluna 6/);
 assert.equal(validateTechnicalReport(report),report);
 for(const bad of [
  {...ng,tool:'typescript'},
  {...ng,message:'Senha vazada'},
  {...ng,file:'../secrets.html'},
  {...ng,code:'NG800200'},
  {...issue,file:'src/view.html'}
 ])assert.throws(()=>makeBuildTechnicalReport(job,{...evidence,findings:[bad]}));
});
test('mixed Angular and TypeScript compiler findings survive one bounded report',()=>{
 const ng={tool:'angular',code:'NG5002',file:null,line:null,column:null,
  message:'O compilador Angular registrou um diagnóstico NG.',location_verified:false};
 const r=makeBuildTechnicalReport(job,{...evidence,findings:[issue,ng],location_verified:false});
 assert.deepEqual(r.findings.map(f=>f.code),['TS2322','NG5002']);
 assert.match(r.text,/arquivo e posição não confirmados/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBlockedPreflightResult } from '../scripts/sac_preflight_result.mjs';
const job={schema_version:1,job_id:'gha-123-1',project_id:'synthetic-app',
  profile_id:'angular-test',source_sha:'a'.repeat(40),kind:'angular-validate'};
const pre=(status,results=[])=>({status,executed:true,results});

test('a verified peer incompatibility remains preflight fail, not infrastructure error',()=>{
 const report={status:'fail',phases:{pre:pre('fail',[{evidence:[{
   status:'fail',assertion:'typescript-peers',code:'typescript-peer-incompatible',
   message:'TOKEN=secret'
 }]}])}};
 const r=makeBlockedPreflightResult(job,report);
 assert.equal(r.status,'fail');assert.equal(r.code,'preflight-failed');
 assert.equal(r.execution,'sac-build-audit');
 assert.deepEqual(r.diagnostic.checks,{pre:'fail',build:'unverified',
   post:'unverified',browser:'unverified'});
 assert.equal(r.diagnostic.findings[0].code,'typescript-peer-incompatible');
 assert.equal(JSON.stringify(r).includes('TOKEN'),false);
 assert.equal(r.deployment_authorized,false);
 assert.equal(r.static_pipeline_pass,false);
 assert.equal(r.browser_pass,false);
 assert.equal('technical_report' in r,false);
});
test('unverified preflight is not marked as verified, and browser stays not-run',()=>{
 const r=makeBlockedPreflightResult(job,{status:'unverified',
   phases:{pre:pre('unverified')}});
 assert.equal(r.status,'unverified');
 assert.equal(r.code,'preflight-unverified');
 assert.equal(r.diagnostic.checks.pre,'unverified');
 assert.equal(r.diagnostic.findings[0].phase,'pre');
 assert.equal(r.diagnostic.findings[0].code,'preflight-unverified');
 assert.equal(r.diagnostic.findings.some(f=>f.code==='audit-infrastructure-error'),false);
});
test('real preflight IO failure is distinguished from source validation failure',()=>{
 const r=makeBlockedPreflightResult(job,{status:'infra-error',phases:{
   pre:{status:'infra-error',executed:false,code:'host-io-error'}}});
 assert.equal(r.status,'infra-error');
 assert.equal(r.code,'preflight-infra-error');
 assert.equal(r.diagnostic.findings[0].code,'host-io-error');
});
test('preflight passed but source snapshot lacks proof is still blocked',()=>{
 const r=makeBlockedPreflightResult(job,{status:'unverified',phases:{
   pre:{status:'pass',executed:true,promotion_allowed:true},
   build:{status:'unverified',executed:false,code:'resource-missing'}}});
 assert.equal(r.code,'build-prerequisites-unverified');
 assert.equal(r.diagnostic.checks.pre,'pass');
 assert.equal(r.diagnostic.checks.build,'unverified');
 assert.equal(r.diagnostic.findings[0].phase,'build');
 assert.equal(r.diagnostic.findings[0].code,'build-prerequisites-unverified');
});
for(const [state,code,reason] of [
 ['fail','build-prerequisites-failed','unsafe-source-selection'],
 ['infra-error','build-prerequisites-infra-error','host-io-error']
]) test('snapshot '+state+' after preflight pass retains phase and blocks build',()=>{
 const r=makeBlockedPreflightResult(job,{status:state,phases:{
   pre:{status:'pass',executed:true,promotion_allowed:true},
   build:{status:state,executed:false,code:reason}
 }});
 assert.equal(r.status,state);
 assert.equal(r.code,code);
 assert.deepEqual(r.diagnostic.checks,
   {pre:'pass',build:'unverified',post:'unverified',browser:'unverified'});
 assert.equal(r.diagnostic.findings[0].phase,'build');
 assert.equal(r.diagnostic.findings[0].code,code);
 assert.equal(r.deployment_authorized,false);
 assert.equal('technical_report' in r,false);
});
test('malformed, inconsistent or forged pass evidence is rejected',()=>{
 for(const report of [
   null,{status:'pass',phases:{pre:pre('pass')}},
   {status:'fail',phases:{pre:pre('pass')}},
   {status:'unverified',phases:{pre:pre('pass')}},
   {status:'fail',phases:{pre:pre('pass'),build:{status:'unverified',code:'not-executed'}}},
   {status:'infra-error',phases:{pre:pre('fail')}},
   {status:'unverified',phases:{pre:pre('fail')}},
   {status:'fail',phases:{pre:{status:'pass'}}},
   {status:'not-applicable',phases:{pre:{status:'not-applicable'}}},
 ]) assert.throws(()=>makeBlockedPreflightResult(job,report));
 assert.throws(()=>makeBlockedPreflightResult({...job,source_sha:'b'},{
   status:'fail',phases:{pre:pre('fail')}}));
});
test('many untrusted preflight findings stay bounded and sanitized',()=>{
 const r=makeBlockedPreflightResult(job,{status:'fail',phases:{pre:pre(
   'fail',Array.from({length:60},(_,i)=>({evidence:[{
     status:'fail',code:'private-token-https-example-'+i,
     assertion:'unsafe/secret',message:'SECRET=DO_NOT_LEAK'
   }]})))}});
 assert.equal(r.diagnostic.findings.length,8);
 assert.equal(r.diagnostic.truncated,true);
 assert.equal(JSON.stringify(r).includes('DO_NOT_LEAK'),false);
 assert.equal(r.diagnostic.deployment_authorized,false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makePhaseEvidenceV2,validatePhaseEvidenceV2 } from '../scripts/sac_phase_evidence_v2.mjs';
const job={schema_version:1,job_id:'gha-555-1',project_id:'synthetic-app',
  profile_id:'synthetic',source_sha:'a'.repeat(40),kind:'angular-validate'};
const base=()=>({schema_version:1,status:'pass',static_pipeline_pass:true,
  browser_pass:false,deployment_authorized:false,
  network_isolation:'container-network-none',
  static_result:{status:'pass',profile_id:'synthetic',
    source_sha_claim:job.source_sha,
    phases:{pre:{status:'pass',executed:true},build:{status:'pass',
      code:'authenticated-ci-build',artifact_digest:'b'.repeat(64),executed:false},
      post:{status:'pass',executed:true}}},
  browser:{status:'fail',executed:true,sandbox:'docker-network-none',
    cases:[{id:'broken-click',status:'fail',codes:['required-assertion-failed']}],
    code:'isolated-chromium-result'},
  binding:{source_sha_claim:job.source_sha,artifact_digest:'b'.repeat(64)}
});
test('Guardian browser failure is factual: no paths, causes or suggestions',()=>{
 const r=makePhaseEvidenceV2(job,{...base(),status:'fail'});
 assert.equal(r.phase,'browser');
 assert.equal(r.executed,true);
 assert.equal(r.checks.post,'pass');
 assert.equal(r.checks.browser,'fail');
 assert.deepEqual(r.findings,[{phase:'browser',status:'fail',
   code:'required-assertion-failed',assertion:'broken-click'}]);
 assert.equal(r.blocked_by,null);
 assert.equal(r.location_verified,false);
 assert.equal(r.root_cause_verified,false);
 assert.equal(r.deployment_authorized,false);
 assert.doesNotMatch(r.text,/corrija|provável|recomenda|https:\/\//i);
 assert.deepEqual(validatePhaseEvidenceV2(r),r);
});
test('postcompiler failure keeps Guardian not-run and never labels it as failure',()=>{
 const x=base();
 x.static_pipeline_pass=false;
 x.static_result.status='fail';
 x.static_result.phases.post={status:'fail',executed:true,
   results:[{evidence:[{status:'fail',code:'mount-mismatch',assertion:'mount',
     message:'PRIVATE_TOKEN=secret'}]}]};
 x.browser={status:'unverified',executed:false,code:'not-executed'};
 x.status='fail';
 const r=makePhaseEvidenceV2(job,x);
 assert.equal(r.phase,'post');
 assert.deepEqual(r.checks,{pre:'pass',build:'pass',post:'fail',browser:'not-run'});
 assert.equal(r.blocked_by,'post');
 assert.equal(r.executed,true);
 assert.equal(r.findings[0].code,'mount-mismatch');
 assert.ok(!JSON.stringify(r).includes('secret'));
 assert.match(r.text,/Guardian não executado/);
});
test('incomplete browser contract is failure, but no execution is invented',()=>{
 const x=base();
 x.status='fail';x.network_isolation='application-routing-external-sandbox-required';
 x.browser={status:'fail',executed:false,code:'invalid-browser-contract'};
 delete x.binding;
 const r=makePhaseEvidenceV2(job,x);
 assert.equal(r.executed,false);
 assert.equal(r.findings[0].code,'invalid-browser-contract');
 assert.equal(r.checks.browser,'fail');
});
test('missing proof, false pass and mismatched identities are rejected',()=>{
 const a={...base(),status:'fail'};
 for(const x of [
  {...a,static_result:{...a.static_result,source_sha_claim:'c'.repeat(40)}},
  {...a,static_result:{...a.static_result,profile_id:'other'}},
  {...a,browser_pass:true},
  {...a,deployment_authorized:true},
  {...a,network_isolation:'unknown'},
  {...a,binding:{...a.binding,artifact_digest:'c'.repeat(64)}},
  {...a,static_result:{...a.static_result,phases:{
     ...a.static_result.phases,build:{status:'pass',code:'build-claimed',
       artifact_digest:'b'.repeat(64)}}}},
 ]) assert.throws(()=>makePhaseEvidenceV2(job,x));
 assert.throws(()=>makePhaseEvidenceV2({...job,source_sha:'b'.repeat(40)},a));
});
test('tampered phase text, code, coordinates and status are rejected',()=>{
 const x={...base(),status:'fail'};
 const good=makePhaseEvidenceV2(job,x);
 for(const broken of [
  {...good,text:'root cause: private key'},
  {...good,root_cause_verified:true},
  {...good,location_verified:true},
  {...good,deployment_authorized:true},
  {...good,status:'pass'},
  {...good,checks:{...good.checks,post:'fail'}},
  {...good,findings:[{...good.findings[0],code:'password-leaked'}]},
  {...good,findings:[{...good.findings[0],file:'src/private.ts'}]},
 ]) assert.throws(()=>validatePhaseEvidenceV2(broken));
});
test('bad scenario codes become unclassified, never raw secret',()=>{
 const x={...base(),status:'fail'};
 x.browser.cases=[{id:'case-1',status:'fail',codes:['secret-token-proxy']}];
 const r=makePhaseEvidenceV2(job,x);
 assert.equal(r.findings[0].code,'diagnostic-unclassified');
 assert.ok(!JSON.stringify(r).includes('secret-token-proxy'));
});
test('only browser failures with authenticated bound sandbox are considered executed',()=>{
 const x={...base(),status:'fail'};
 x.browser.status='infra-error';x.status='infra-error';
 x.browser.cases=[];x.browser.executed=false;x.browser.code='sandbox-timeout';
 x.network_isolation='application-routing-external-sandbox-required';
 delete x.binding;
 const r=makePhaseEvidenceV2(job,x);
 assert.equal(r.status,'infra-error');
 assert.equal(r.executed,false);
 assert.equal(r.findings[0].code,'sandbox-timeout');
});

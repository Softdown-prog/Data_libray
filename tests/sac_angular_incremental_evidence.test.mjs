import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compareAngularIncrementalEvidence as compare} from '../scripts/sac_angular_incremental_evidence.mjs';
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
const evidence={baseline_sha256:a,warm_sha256:b,cold_sha256:b,
 baseline_build_pass:true,warm_build_pass:true,cold_build_pass:true,
 negative_build_failed:true,negative_diagnostic:'TS2339'};
test('changed baseline and matching warm/cold outputs are concordant',()=>{
 const r=compare(evidence);
 assert.equal(r.status,'pass');assert.equal(r.code,'warm-clean-output-concordant');
 assert.equal(r.cache_hit_verified,false);assert.equal(r.production_aot_verified,false);
 assert.equal(r.deployment_authorized,false);assert.ok(Object.isFrozen(r));
});
test('stale artifact with previous digest is caught even with process success',()=>{
 const r=compare({...evidence,warm_sha256:a});
 assert.equal(r.status,'fail');assert.equal(r.code,'stale-artifact-not-updated');
});
test('independent cold build divergence is a separate failure',()=>{
 const r=compare({...evidence,cold_sha256:c});
 assert.equal(r.status,'fail');
 assert.equal(r.code,'incremental-clean-artifact-divergence');
});
test('bad official negative diagnostic cannot be interpreted as successful probe',()=>{
 for(const changes of [
  {negative_build_failed:false},{negative_diagnostic:'TS2307'},
  {negative_diagnostic:null},{baseline_build_pass:false},
  {warm_build_pass:false},{cold_build_pass:false}
 ])assert.equal(compare({...evidence,...changes}).status,'unverified');
});
test('invalid input and hashes fail closed without echoing sources',()=>{
 for(const bad of [
  {},null,[],{...evidence,warm_sha256:'PRIVATE_TOKEN'},
  {...evidence,cold_sha256:'1'.repeat(65)},
  {...evidence,baseline_sha256:'../'+'0'.repeat(61)}
 ]){
  const r=compare(bad);
  assert.equal(r.status,'unverified');assert.equal(r.deployment_authorized,false);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE_TOKEN/);
 }
});

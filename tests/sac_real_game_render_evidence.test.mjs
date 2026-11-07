import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeRealGameRenderOutput,validateRealGameRenderReport} from
 '../packages/sac-multistack/src/real-game-render-evidence.mjs';
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
const valid={schema_version:1,game:'terrania',artifact_digest:a,
 status:'pass',executed:true,dpr_variants_checked:2,
 samples:[1,2].map(dpr=>({
  dpr,base_sha256:a,changed_sha256:b,seed_sample_sha256:c,
  painted_pixels:20000
 })),codes:[],runtime_scope:'isolated-renderer-only',
 gameplay_verified:false,multiplayer_verified:false,
 deployment_authorized:false};
test('both games can return a truthful renderer-only receipt',()=>{
 for(const game of ['lhs','terrania']){
  const report=validateRealGameRenderReport({...valid,game},game,a);
  assert.equal(report.status,'pass');
  assert.equal(report.gameplay_verified,false);
  assert.equal(report.deployment_authorized,false);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.samples));
 }
});
test('a green report without two pixel viewports is rejected',()=>{
 for(const changes of [
  {dpr_variants_checked:1,samples:valid.samples.slice(0,1)},
  {executed:false},
  {status:'pass',codes:['javascript-exception']},
  {gameplay_verified:true},
  {multiplayer_verified:true},
  {deployment_authorized:true},
  {secret:'PRIVATE'},
  {samples:[valid.samples[0],{...valid.samples[1],base_sha256:b,changed_sha256:b}]},
  {artifact_digest:b}
 ])assert.throws(()=>validateRealGameRenderReport({...valid,...changes},'terrania',a));
});
test('bounded decoder rejects duplicated forged output and arbitrary codes',()=>{
 const wire='SAC_REAL_GAME_RENDER_REPORT '+JSON.stringify(valid)+'\n';
 const r=decodeRealGameRenderOutput(wire,'terrania',a);
 assert.equal(r.status,'pass');
 assert.throws(()=>decodeRealGameRenderOutput(wire+wire,'terrania',a));
 assert.throws(()=>decodeRealGameRenderOutput('PRIVATE_VALUE','terrania',a));
 assert.throws(()=>validateRealGameRenderReport({
  ...valid,status:'fail',codes:['PRIVATE_VALUE']
 },'terrania',a));
});
test('negative renderer evidence may be fail but never authorize deploy',()=>{
 const r=validateRealGameRenderReport({
  ...valid,status:'fail',codes:['same-scene-pixels-differ']
 },'terrania',a);
 assert.equal(r.status,'fail');
 assert.equal(r.deployment_authorized,false);
});

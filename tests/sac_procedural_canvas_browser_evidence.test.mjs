import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCanvasBrowserReport,decodeCanvasBrowserOutput} from
 '../packages/sac-multistack/src/canvas-evidence.mjs';
const digest='a'.repeat(64);
const valid={schema_version:1,scenario:'canvas-seeded-2d',
 artifact_digest:digest,status:'pass',executed:true,
 dpr_variants_verified:2,same_seed_repeated:true,
 different_seed_checked:true,blank_frame_negative_checked:true,
 codes:[],deployment_authorized:false};
test('accept only pinned success with both DPR pixel checks',()=>{
 const r=validateCanvasBrowserReport(valid,digest);
 assert.equal(r.status,'pass');assert.equal(r.deployment_authorized,false);
 assert.ok(Object.isFrozen(r));
 const parsed=decodeCanvasBrowserOutput(
  'note\nSAC_CANVAS_BROWSER_REPORT '+JSON.stringify(valid)+'\n',digest);
 assert.deepEqual(parsed,r);
});
test('fabricated browser green, wrong digest and unexpected keys fail closed',()=>{
 for(const r of [
  {...valid,artifact_digest:'b'.repeat(64)},
  {...valid,dpr_variants_verified:1},
  {...valid,executed:false},
  {...valid,project_verified:true},
  {...valid,codes:['application-leaked-secret']},
  {...valid,deployment_authorized:true}
 ])assert.throws(()=>validateCanvasBrowserReport(r,digest));
});
test('negative Canvas report contains a fixed detection code only',()=>{
 const r={...valid,status:'fail',codes:['blank-frame-negative-missed'],
  dpr_variants_verified:1};
 assert.equal(validateCanvasBrowserReport(r,digest).status,'fail');
 assert.throws(()=>decodeCanvasBrowserOutput(
  'SAC_CANVAS_BROWSER_REPORT '+JSON.stringify(valid)+'\n'+
  'SAC_CANVAS_BROWSER_REPORT '+JSON.stringify(valid),digest));
 assert.throws(()=>decodeCanvasBrowserOutput('PRIVATE_VALUE',digest));
});

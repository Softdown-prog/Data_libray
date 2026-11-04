import test from 'node:test';
import assert from 'node:assert/strict';
import {makeLhsObservationReport} from '../packages/angular-core/src/lhs-observation-report.mjs';
import {makeAuthenticatedLhsObservation} from '../packages/angular-core/src/lhs-authenticated-observation.mjs';

const SHA='c5139c2cc5088adc3bbf0bf85d2952e64e2fc5ac';
const A='a'.repeat(64),B='b'.repeat(64);
function fixture(){
  const hashes=[A,B],targets=[
    ['canvas','src/main.ts','game/js/main.js'],
    ['save','src/site-rewrite/account.ts','game/js/sim/saveTransfer.js']
  ];
  const artifactEvidence={
    schema_version:1,probe:'sac-pre002-lhs-pinned-angular-artifact-evidence',
    source_commit:SHA,game_angular_js_chunks:1,site_angular_js_chunks:1,
    rule_id:'SAC-PRE002-EXT',status:'unverified',
    scope:'pinned-LHS-build-artifacts-only',
    emitted_artifacts_consistent:true,angular_bootstrap_observed:true,
    entries:targets.map(([entry,source_reference,runtime_target],i)=>({
      entry,source_reference,runtime_target,
      source_url_observed:true,source_dynamic_import_observed:true,
      bundle_url_observed:true,bundle_dynamic_import_observed:true,
      target_file_present:true,target_sha256:hashes[i],artifact_link_evidence:true
    })),
    runtime_execution_verified:false,deployment_authorized:false,
    note:'untrusted-input-not-printed'
  };
  const toPage=phase=>({phase,navigation_status:200,canvas_import_status:200,
    angular_bootstrap:true,touch_emulation:true,pageerror_count:0,horizontal_overflow_px:0});
  const toSave=phase=>({phase,import_executed:true,export_detected:true,status:200});
  const toControl=(phase,width)=>({
    phase,viewport_width:width,tab_switch:true,options_open_close:true,
    game_started:phase==='initial',saved_game_continued:phase==='reload',
    zoom_in_and_out:true,fit_scene:true,returned_to_menu:true,
    canvas_swipe:{native_touch_swipe:true,canvas_scrolled:true,scroll_delta_px:160,
      game_clicks:0,admin_remained_closed:true,shop_remained_closed:true,
      placement_remained_closed:true,synthetic_post_drag_click_blocked:true}
  });
  const browserEvidence={
    schema_version:1,rule_id:'SAC-PRE002-EXT-BROWSER',source_commit:SHA,
    scope:'isolated-loopback-browser-dynamic-imports',browser:'chromium',
    server:'127.0.0.1',
    game:{navigation_status:200,angular_bootstrap:true,
      canvas_dynamic_request_observed:true,canvas_response_status:200,
      pageerror_count:0,status:200,javascript_mime:true,csp_header:true,sha256:A},
    save:{dynamic_import_executed:true,export_detected:true,status:200,
      javascript_mime:true,csp_header:true,sha256:B},
    negative_tests:{missing_module_rejected:true,incorrect_mime_rejected:true,
      restrictive_csp_rejected:true},
    mobile_reload_evidence:[[360,800],[414,896]].map(([width,height])=>({
      viewport_width:width,viewport_height:height,
      game:['initial','reload'].map(toPage),save:['initial','reload'].map(toSave),
      touch_controls:['initial','reload'].map(phase=>toControl(phase,width)),
      no_page_errors:true
    })),
    external_network_blocked_count:5,browser_module_load_verified:true,
    gameplay_verified:false,authentication_attempted:false,payment_attempted:false,
    deployment_authorized:false
  };
  return {sourceCommit:SHA,artifactEvidence,browserEvidence};
}
test('reconcile all four phases without issuing any approval or promotion',()=>{
  const x=fixture();
  const report=makeLhsObservationReport(x);
  assert.equal(report.schema_version,1);
  assert.equal(report.observation_status,'unverified');
  assert.equal(report.checks.build.observation,'observed');
  assert.equal(report.checks.module_loading.observation,'observed');
  assert.equal(report.checks.interface.observation,'observed');
  assert.equal(report.checks.gameplay.observation,'unverified');
  assert.ok(Object.values(report.checks).every(c=>c.approval==='unverified'));
  assert.equal(report.provenance.runner_attestation_verified,false);
  assert.equal(report.promotion_allowed,false);
  assert.equal(report.deployment_authorized,false);
  assert.deepEqual(report.artifact_digests.map(x=>x.sha256),[A,B]);
  assert.deepEqual(report,makeLhsObservationReport(x));
});
test('different pinned revisions fail closed instead of mixing CI snapshots',()=>{
  const x=fixture();x.browserEvidence.source_commit='c'.repeat(40);
  assert.throws(()=>makeLhsObservationReport(x),/sac-core-observation-source-mismatch/);
  const y=fixture();y.artifactEvidence.source_commit='d'.repeat(40);
  assert.throws(()=>makeLhsObservationReport(y),/sac-core-observation-source-mismatch/);
});
test('build artifact inconsistency is visible without fabricating successes',()=>{
  const x=fixture();x.artifactEvidence.entries[0].target_file_present=false;
  const r=makeLhsObservationReport(x);
  assert.equal(r.checks.build.observation,'unverified');
  assert.equal(r.checks.module_loading.observation,'observed');
  assert.equal(r.checks.interface.observation,'observed');
  assert.equal(r.promotion_allowed,false);
});
test('MIME failure and hash mismatch stay separate from successful build observation',()=>{
  const x=fixture();x.browserEvidence.game.javascript_mime=false;
  let r=makeLhsObservationReport(x);
  assert.equal(r.checks.build.observation,'observed');
  assert.equal(r.checks.module_loading.observation,'unverified');
  x.browserEvidence.game.javascript_mime=true;
  x.browserEvidence.save.sha256='c'.repeat(64);
  r=makeLhsObservationReport(x);
  assert.equal(r.checks.module_loading.observation,'unverified');
  assert.equal(r.checks.build.observation,'observed');
});
test('mobile UI regression does not masquerade as a gameplay failure',()=>{
  const x=fixture();
  x.browserEvidence.mobile_reload_evidence[1].touch_controls[1].canvas_swipe.game_clicks=1;
  const r=makeLhsObservationReport(x);
  assert.equal(r.checks.interface.observation,'unverified');
  assert.equal(r.checks.module_loading.observation,'observed');
  assert.equal(r.checks.gameplay.observation,'unverified');
});
test('coverage holes and fake user-account or gameplay claims fail closed',()=>{
  let x=fixture();x.browserEvidence.mobile_reload_evidence.pop();
  assert.throws(()=>makeLhsObservationReport(x),/coverage-shape-invalid/);
  x=fixture();x.browserEvidence.gameplay_verified=true;
  assert.throws(()=>makeLhsObservationReport(x),/contract-invalid/);
  x=fixture();x.browserEvidence.payment_attempted=true;
  assert.throws(()=>makeLhsObservationReport(x),/contract-invalid/);
  x=fixture();x.artifactEvidence.deployment_authorized=true;
  assert.throws(()=>makeLhsObservationReport(x),/contract-invalid/);
});
test('unsafe output does not echo arbitrary secrets or user-controlled strings',()=>{
  const x=fixture();const token='SUPER-PRIVATE-TOKEN-DO-NOT-LEAK';
  x.artifactEvidence.untrusted={token};
  x.browserEvidence.untrusted={error:token};
  x.browserEvidence.mobile_reload_evidence[0].touch_controls[0].untrusted=token;
  const out=JSON.stringify(makeLhsObservationReport(x));
  assert.ok(!out.includes(token));
  assert.ok(out.length<4096);
  assert.ok(!out.includes('https://'));
});
test('source, module name and digest cannot silently change',()=>{
  const x=fixture();x.artifactEvidence.entries[0].runtime_target='../../.env';
  assert.throws(()=>makeLhsObservationReport(x),/artifact-binding-invalid/);
  const y=fixture();y.artifactEvidence.entries[0].target_sha256='bad';
  assert.throws(()=>makeLhsObservationReport(y),/artifact-binding-invalid/);
});


test('authenticated adapter refuses absent receipt even with observed Chromium',async()=>{
  const x=fixture();
  await assert.rejects(
    makeAuthenticatedLhsObservation({...x,profile:{},resources:{},key:Buffer.alloc(32,4)}),
    /sac-lhs-authenticated-build-binding-invalid/
  );
});
test('forged receipt without host HMAC never becomes authenticated evidence',async()=>{
  const x=fixture();
  const receipt={data:{source_sha_claim:SHA,build_status:'pass',
    artifact_digest:'f'.repeat(64)},authentication:'0'.repeat(64)};
  await assert.rejects(
    makeAuthenticatedLhsObservation({...x,profile:null,resources:null,
      receipt,key:Buffer.alloc(32,4)}),
    /sac-lhs-authenticated-build-binding-invalid/
  );
});
test('tampered source evidence fails before a receipt is considered',async()=>{
  const x=fixture();x.browserEvidence.source_commit='0'.repeat(40);
  await assert.rejects(
    makeAuthenticatedLhsObservation({...x,profile:null,resources:null,
      receipt:{data:{}},key:Buffer.alloc(32,8)}),
    /sac-core-observation-source-mismatch/
  );
});

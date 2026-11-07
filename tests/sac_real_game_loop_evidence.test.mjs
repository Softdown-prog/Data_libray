import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeRealGameLoopOutput,validateRealGameLoopReport} from
 '../packages/sac-multistack/src/real-game-loop-evidence.mjs';
const hash='a'.repeat(64);
const common={schema_version:1,artifact_digest:hash,status:'pass',executed:true,
 codes:[],network:'none',multiplayer_verified:false,
 complete_gameplay_verified:false,deployment_authorized:false};
const lhs={...common,game:'lhs',runtime_step:'lhs-step-game',
 gameplay_scope:'offline-simulator-minute-steps',
 observations:{minutes_advanced:90,cumulative_visitors:5,frame_changed_pixels:1024,
  replayed_game_state_equal:true,seed_sensitive_rng:true,save_contract_valid:true}};
const terr={...common,game:'terrania',runtime_step:'terrania-phaser-input',
 gameplay_scope:'offline-phaser-input-only',
 observations:{phaser_scene_created:true,hud_updates_before:9,hud_updates_after:26,
  moved_from_tile_x:0,moved_to_tile_x:1,resize_width:380,
  renderer_screenshot_sha256:'b'.repeat(64),cleaned_up:true}};
test('LHS and Terrania game loops report only their actual scope',()=>{
 for(const r of [lhs,terr]){
  const proof=validateRealGameLoopReport(r,r.game,hash);
  assert.equal(proof.status,'pass');
  assert.equal(proof.complete_gameplay_verified,false);
  assert.equal(proof.multiplayer_verified,false);
  assert.equal(proof.deployment_authorized,false);
  assert.equal(decodeRealGameLoopOutput(
   'SAC_REAL_GAME_LOOP_REPORT '+JSON.stringify(r)+'\n',r.game,hash).status,'pass');
 }
});
test('fake passed Phaser movement, canvas or partial loop cannot be accepted',()=>{
 for(const observation of [
  {...terr.observations,moved_to_tile_x:0},
  {...terr.observations,hud_updates_after:9},
  {...terr.observations,phaser_scene_created:false},
  {...terr.observations,renderer_screenshot_sha256:'tampered'},
  {...terr.observations,cleaned_up:false}
 ])assert.throws(()=>validateRealGameLoopReport({
  ...terr,observations:observation
 },'terrania',hash));
});
test('fake LHS minute ticks, missing visitors and forged hashes are blocked',()=>{
 for(const mutation of [
  {...lhs.observations,minutes_advanced:0},
  {...lhs.observations,cumulative_visitors:0},
  {...lhs.observations,frame_changed_pixels:0},
  {...lhs.observations,save_contract_valid:false}
 ])assert.throws(()=>validateRealGameLoopReport({
  ...lhs,observations:mutation
 },'lhs',hash));
 assert.throws(()=>validateRealGameLoopReport({
  ...lhs,artifact_digest:'c'.repeat(64)
 },'lhs',hash));
});
test('cannot falsely assert multiplayer or deployment',()=>{
 for(const item of [{multiplayer_verified:true},{complete_gameplay_verified:true},
  {deployment_authorized:true},{unknown:'secret'},{codes:['extra-code']}])
  assert.throws(()=>validateRealGameLoopReport({...terr,...item},
   'terrania',hash));
 const line='SAC_REAL_GAME_LOOP_REPORT '+JSON.stringify(terr)+'\n';
 assert.throws(()=>decodeRealGameLoopOutput(line+line,'terrania',hash));
 assert.throws(()=>decodeRealGameLoopOutput('secret information','terrania',hash));
});

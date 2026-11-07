import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGameBehaviorReport,decodeGameBehaviorOutput} from
 '../packages/sac-multistack/src/game-behavior-evidence.mjs';
const digest='a'.repeat(64);
const base={schema_version:1,artifact_digest:digest,status:'pass',
 executed:true,codes:[],source_scope:'pinned-production-offline-game-logic',
 multiplayer_verified:false,complete_gameplay_verified:false,
 deployment_authorized:false};
const lhs={...base,game:'lhs',stage:'customer-queue',observations:{
 minutes:180,unique_visitors:11,max_counter_queue:3,
 queue_observed:true,moving_visitors:8,stage_changes:12,
 invalid_positions:0,duplicate_ids:0,counter_slot_violations:0,
 queue_slots_separated:true,valid_save:true,same_seed_same_traffic:true,
 distinct_seeds_different_traffic:true}};
const terr={...base,game:'terrania',stage:'phaser-pursuit-combat',
 observations:{combat_target:'-2,-2,0',initial_tile_x:-21,initial_tile_y:-32,
 final_tile_x:-20,final_tile_y:-31,movement_observed:true,
 kills:1,experience:30,mob_defeated:true,invalid_target_rejected:true,
 hud_updates_before:6,hud_updates_after:200,offline:true,canvas_cleaned:true}};
test('accepts exact real-logic proofs but never overall gameplay or deploy',()=>{
 for(const record of [lhs,terr]){
  const v=validateGameBehaviorReport(record,record.game,digest);
  assert.equal(v.status,'pass');
  assert.equal(v.complete_gameplay_verified,false);
  assert.equal(v.deployment_authorized,false);
  assert.ok(Object.isFrozen(v.observations));
  assert.equal(decodeGameBehaviorOutput(
   'SAC_GAME_BEHAVIOR_REPORT '+JSON.stringify(record)+'\n',
   record.game,digest).status,'pass');
 }
});
test('false combat proof, fake kill and fake target rejection cannot pass',()=>{
 for(const o of [
  {...terr.observations,experience:20},
  {...terr.observations,invalid_target_rejected:false},
  {...terr.observations,mob_defeated:false},
  {...terr.observations,movement_observed:false},
  {...terr.observations,final_tile_x:-21,final_tile_y:-32},
  {...terr.observations,hud_updates_after:5}
 ])assert.throws(()=>validateGameBehaviorReport({
  ...terr,observations:o
 },'terrania',digest));
});
test('customer flow must really advance, move, change stages and stay valid',()=>{
 for(const o of [
  {...lhs.observations,queue_observed:false},
  {...lhs.observations,moving_visitors:0},
  {...lhs.observations,stage_changes:0},
  {...lhs.observations,duplicate_ids:1},
  {...lhs.observations,invalid_positions:1},
  {...lhs.observations,queue_slots_separated:false},
  {...lhs.observations,valid_save:false},
  {...lhs.observations,same_seed_same_traffic:false},
  {...lhs.observations,minutes:0}
 ])assert.throws(()=>validateGameBehaviorReport({
  ...lhs,observations:o
 },'lhs',digest));
});
test('rejects forged digest, unknown fields, secrets and duplicate reports',()=>{
 for(const r of [
  {...lhs,artifact_digest:'b'.repeat(64)},
  {...lhs,deployment_authorized:true},
  {...lhs,multiplayer_verified:true},
  {...lhs,complete_gameplay_verified:true},
  {...lhs,secret:'EXFIL'},
  {...lhs,codes:['unknown-code']}
 ])assert.throws(()=>validateGameBehaviorReport(r,'lhs',digest));
 const wire='SAC_GAME_BEHAVIOR_REPORT '+JSON.stringify(lhs)+'\n';
 assert.throws(()=>decodeGameBehaviorOutput(wire+wire,'lhs',digest));
 assert.throws(()=>decodeGameBehaviorOutput('TOKEN: secret\n','lhs',digest));
});

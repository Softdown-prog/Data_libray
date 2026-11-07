import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRealStressReport,decodeRealStressOutput} from
 '../packages/sac-multistack/src/real-stress-evidence.mjs';
const digest='a'.repeat(64);
const base={schema_version:1,artifact_digest:digest,status:'pass',
 executed:true,codes:[],source_scope:'pinned-offline-engine-properties',
 full_gameplay_verified:false,multiplayer_verified:false,
 deployment_authorized:false};
const layout=(name,item)=>({
 layout:name,item,edited:true,slots_available:12,
 slots_separated:true,counter_slot_conflict:false,
 duration_minutes:210,remaining:0,purchases:8,revenue:80,expenses:0,
 cash_balanced:true,overlap_count:0,wall_crossings:0,
 teleports:0,movement_count:53
});
const lhs={...base,game:'lhs',stage:'retail-layouts',
 observations:{replay_equal:true,layouts:[
  layout('default','soda'),layout('east-expanded','soda'),
  layout('interior-partition','candy')
 ]}};
const terrania={...base,game:'terrania',stage:'obstacle-pursuit-multitarget',
 observations:{replay_equal:true,
  passable_wall:{kind:'wall',initiallyBlocked:true,walked:true,
   forbidden:0,reached:true,final_x:135,final_y:62,clear_after:true},
  impassable_wall:{kind:'sealed',initiallyBlocked:true,walked:true,
   forbidden:0,reached:false,final_x:64,final_y:20,clear_after:false},
  selected_target_switch:{
   first_destination_x:235,moved_target_destination_x:260,
   new_target_destination_y:204,new_direction_y:.8,
   suspended_destination_cleared:true},
  focused_combat:{selected:true,strikes:2,focus_hp:0,
   bystander_hp:2,bystander_damaged:false,kills:1,experience:10,
   focus_defeated:true,invalid_rejected:true,dead_target_rejected:true}
 }};
test('accepts only bounded true renderer-independent engine receipts',()=>{
 for(const record of [lhs,terrania]){
  const p=validateRealStressReport(record,record.game,digest);
  assert.equal(p.status,'pass');
  assert.equal(p.multiplayer_verified,false);
  assert.equal(p.deployment_authorized,false);
  const decoded=decodeRealStressOutput(
   'SAC_REAL_STRESS_REPORT '+JSON.stringify(record)+'\n',
   record.game,digest);
  assert.equal(decoded.status,'pass');
 }
});
test('blocked wall crossing and bystander damage can never look green',()=>{
 for(const mutation of [
  {passable_wall:{...terrania.observations.passable_wall,forbidden:1}},
  {impassable_wall:{...terrania.observations.impassable_wall,reached:true}},
  {selected_target_switch:{
   ...terrania.observations.selected_target_switch,new_direction_y:0}},
  {focused_combat:{...terrania.observations.focused_combat,
   bystander_hp:1,bystander_damaged:true}},
  {focused_combat:{...terrania.observations.focused_combat,
   kills:0,focus_defeated:false}}
 ])assert.throws(()=>validateRealStressReport({
  ...terrania,observations:{...terrania.observations,...mutation}
 },'terrania',digest));
});
test('three real retail layouts must finish without overlap/teleport or false billing',()=>{
 for(const mutation of [
  {remaining:2},{teleports:1},{wall_crossings:1},{overlap_count:1},
  {purchases:0},{cash_balanced:false},{slots_separated:false},
  {counter_slot_conflict:true},{duration_minutes:360}
 ]){
  const modified={...lhs.observations.layouts[1],...mutation};
  assert.throws(()=>validateRealStressReport({
   ...lhs,observations:{...lhs.observations,
    layouts:[lhs.observations.layouts[0],modified,lhs.observations.layouts[2]]}
  },'lhs',digest));
 }
});
test('rejects fake success, wrong artifact digest, extra fields and duplicate logs',()=>{
 for(const change of [
  {artifact_digest:'b'.repeat(64)},{deployment_authorized:true},
  {full_gameplay_verified:true},{multiplayer_verified:true},
  {secret:'PRIVATE_VALUE'},{codes:['unknown-finding']},
  {observations:{...lhs.observations,replay_equal:false}}
 ])assert.throws(()=>validateRealStressReport({...lhs,...change},'lhs',digest));
 const wire='SAC_REAL_STRESS_REPORT '+JSON.stringify(lhs)+'\n';
 assert.throws(()=>decodeRealStressOutput(wire+wire,'lhs',digest));
 assert.throws(()=>decodeRealStressOutput('NOT_A_REPORT PRIVATE_VALUE','lhs',digest));
});

test('sandbox host calls the stress decoder, not the old game-behavior decoder',async()=>{
 const {readFile}=await import('node:fs/promises');
 const script=await readFile(new URL('../scripts/sac_game_stress_layouts_obstacles_probe.mjs',
  import.meta.url),'utf8');
 assert.match(script,/import \{decodeRealStressOutput\} from/);
 assert.match(script,/const proof=decodeRealStressOutput\(browser\.stdout,name,digest\)/);
 assert.doesNotMatch(script,/decodeGameBehaviorOutput/);
});

// Strict artifact-bound receipt for LHS multi-layout and Terrania wall
// and multi-target tests. A successful browser process alone is NOT a pass.
const SHA=/^[a-f0-9]{64}$/;
const CODES=new Set(['external-request-blocked','websocket-request-blocked',
 'game-script-exception','seeded-replay-nondeterministic',
 'layout-editor-failed','retail-slot-layout-invalid',
 'retail-customers-did-not-exit','customer-collision-or-teleport',
 'purchase-accounting-invalid','pursuit-through-avoidable-wall-failed',
 'impassable-wall-crossed','target-switch-path-stale',
 'focused-swing-not-confirmed','bystander-or-target-selection-invalid',
 'stress-probe-exception']);
const FIELDS=['schema_version','game','artifact_digest','status','executed',
 'stage','observations','codes','source_scope',
 'full_gameplay_verified','multiplayer_verified','deployment_authorized'];
const LHS_FIELDS=['layout','item','edited','slots_available','slots_separated',
 'counter_slot_conflict','duration_minutes','remaining','purchases',
 'revenue','expenses','cash_balanced','overlap_count',
 'wall_crossings','teleports','movement_count'];
const TERR_FIELDS=['passable_wall','impassable_wall',
 'selected_target_switch','focused_combat','replay_equal'];
const CHASE_FIELDS=['kind','initiallyBlocked','walked','forbidden','reached',
 'final_x','final_y','clear_after'];
const SWITCH_FIELDS=['first_destination_x','moved_target_destination_x',
 'new_target_destination_y','new_direction_y','suspended_destination_cleared'];
const FIGHT_FIELDS=['selected','strikes','focus_hp','bystander_hp',
 'bystander_damaged','kills','experience','focus_defeated',
 'invalid_rejected','dead_target_rejected'];
const exact=(obj,fields)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join(',')===fields.slice().sort().join(',');
const integer=(x,a,b)=>Number.isInteger(x)&&x>=a&&x<=b;
const finite=(x)=>typeof x==='number'&&Number.isFinite(x);
function validateLHS(o){
 if(!exact(o,['layouts','replay_equal'])||o.replay_equal!==true||
    !Array.isArray(o.layouts)||o.layouts.length!==3)
  throw Error('invalid-lhs-layout-proof');
 for(const [i,item] of o.layouts.entries()){
  if(!exact(item,LHS_FIELDS)||
   item.layout!==['default','east-expanded','interior-partition'][i]||
   item.item!==['soda','soda','candy'][i]||
   item.edited!==true||!integer(item.slots_available,8,30)||
   item.slots_separated!==true||item.counter_slot_conflict!==false||
   !integer(item.duration_minutes,1,359)||item.remaining!==0||
   !integer(item.purchases,8,16)||
   !finite(item.revenue)||!finite(item.expenses)||
   item.cash_balanced!==true||item.overlap_count!==0||
   item.wall_crossings!==0||item.teleports!==0||
   !integer(item.movement_count,1,10000))
   throw Error('invalid-lhs-layout-proof');
 }
}
function validateTerrania(o){
 if(!exact(o,TERR_FIELDS)||o.replay_equal!==true)
  throw Error('invalid-terrania-stress-proof');
 for(const [label,result] of [['wall',o.passable_wall],['sealed',o.impassable_wall]]){
  if(!exact(result,CHASE_FIELDS)||result.kind!==label||
   result.initiallyBlocked!==true||
   !integer(result.forbidden,0,0)||
   !finite(result.final_x)||!finite(result.final_y))
   throw Error('invalid-terrania-chase-proof');
 }
 if(!o.passable_wall.walked||!o.passable_wall.reached||
    o.passable_wall.clear_after!==true||
    o.impassable_wall.reached!==false||
    o.impassable_wall.final_x>=70)
  throw Error('invalid-terrania-chase-proof');
 const s=o.selected_target_switch;
 if(!exact(s,SWITCH_FIELDS)||!finite(s.first_destination_x)||
  s.first_destination_x<=100||
  !finite(s.moved_target_destination_x)||s.moved_target_destination_x<=200||
  !finite(s.new_target_destination_y)||s.new_target_destination_y<=160||
  !finite(s.new_direction_y)||s.new_direction_y<=0||
  s.suspended_destination_cleared!==true)
  throw Error('invalid-terrania-target-switch-proof');
 const c=o.focused_combat;
 if(!exact(c,FIGHT_FIELDS)||c.selected!==true||
  c.strikes!==2||!finite(c.focus_hp)||c.focus_hp>0||
  c.bystander_hp!==2||c.bystander_damaged!==false||
  c.kills!==1||!integer(c.experience,1,1e7)||
  c.focus_defeated!==true||c.invalid_rejected!==true||
  c.dead_target_rejected!==true)
  throw Error('invalid-terrania-combat-proof');
}
export function validateRealStressReport(v,game,digest){
 if(!['lhs','terrania'].includes(game)||!SHA.test(digest)||
   !exact(v,FIELDS)||v.schema_version!==1||v.game!==game||
   v.artifact_digest!==digest||
   !['pass','fail','infra-error'].includes(v.status)||
   typeof v.executed!=='boolean'||
   v.source_scope!=='pinned-offline-engine-properties'||
   v.full_gameplay_verified!==false||v.multiplayer_verified!==false||
   v.deployment_authorized!==false||!Array.isArray(v.codes)||
   v.codes.length>CODES.size||v.codes.some(x=>!CODES.has(x))||
   v.codes.some((x,i)=>i>0&&x<=v.codes[i-1])||
   (v.status==='pass'&&(!v.executed||v.codes.length!==0||
    v.stage!==(game==='lhs'?'retail-layouts':'obstacle-pursuit-multitarget')))||
   (v.status==='fail'&&(!v.executed||v.codes.length===0))||
   (v.status==='infra-error'&&(v.executed||v.codes.length!==0)))
   throw Error('real-stress-report-unverified');
 if(v.status==='pass'){
  if(game==='lhs')validateLHS(v.observations);
  else validateTerrania(v.observations);
 }else if(!v.observations||typeof v.observations!=='object'||
   Array.isArray(v.observations)||JSON.stringify(v.observations).length>10000)
   throw Error('real-stress-observations-unverified');
 return Object.freeze({...v,observations:Object.freeze(v.observations),
  codes:Object.freeze([...v.codes])});
}
export function decodeRealStressOutput(stdout,game,digest){
 if(typeof stdout!=='string'||stdout.length>32768)
  throw Error('real-stress-output-unverified');
 const records=stdout.split('\n').filter(x=>
  x.startsWith('SAC_REAL_STRESS_REPORT '));
 if(records.length!==1)throw Error('real-stress-output-unverified');
 let parsed;
 try{parsed=JSON.parse(records[0].slice('SAC_REAL_STRESS_REPORT '.length));}
 catch{throw Error('real-stress-output-unverified');}
 return validateRealStressReport(parsed,game,digest);
}

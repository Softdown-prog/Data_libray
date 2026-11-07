// Host-side strictly bounded, artifact-bound proof. Green only if all
// required game-specific measurements exist; never authorizes a deploy.
const SHA=/^[0-9a-f]{64}$/;
const ALLOWED=new Set(['external-request-blocked','websocket-blocked',
 'javascript-exception','clock-not-advanced',
 'counter-queue-invariant-failed','customer-state-invalid',
 'customer-movement-or-lifecycle-absent','customer-queue-nondeterministic',
 'customer-seed-diversity-unobserved','invalid-target-accepted',
 'pursuit-or-kill-missing','combat-progress-missing',
 'phaser-frame-loop-stalled','network-session-unexpected',
 'phaser-canvas-not-disposed','behavior-probe-exception']);
const FIELDS=['schema_version','game','artifact_digest','status','executed',
 'stage','observations','codes','source_scope','multiplayer_verified',
 'complete_gameplay_verified','deployment_authorized'];
const LHS=['minutes','unique_visitors','max_counter_queue','queue_observed',
 'moving_visitors','stage_changes','invalid_positions','duplicate_ids',
 'counter_slot_violations','queue_slots_separated','valid_save',
 'same_seed_same_traffic','distinct_seeds_different_traffic'];
const TERR=['combat_target','initial_tile_x','initial_tile_y',
 'final_tile_x','final_tile_y','movement_observed','kills','experience',
 'mob_defeated','invalid_target_rejected','hud_updates_before',
 'hud_updates_after','offline','canvas_cleaned'];
const exact=(obj,fields)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join(',')===fields.slice().sort().join(',');
const bounded=(n,low,high)=>Number.isInteger(n)&&n>=low&&n<=high;
export function validateGameBehaviorReport(report,game,digest){
 if(!['lhs','terrania'].includes(game)||!SHA.test(digest)||
    !exact(report,FIELDS)||report.schema_version!==1||report.game!==game||
    report.artifact_digest!==digest||
    !['pass','fail','infra-error'].includes(report.status)||
    typeof report.executed!=='boolean'||
    report.stage!==(game==='lhs'?'customer-queue':'phaser-pursuit-combat')&&
       report.status==='pass'||
    !Array.isArray(report.codes)||report.codes.length>ALLOWED.size||
    report.codes.some(x=>!ALLOWED.has(x))||
    report.codes.some((x,i)=>i>0&&x<=report.codes[i-1])||
    report.source_scope!=='pinned-production-offline-game-logic'||
    report.multiplayer_verified!==false||
    report.complete_gameplay_verified!==false||
    report.deployment_authorized!==false||
    (report.status==='pass'&&(!report.executed||report.codes.length))||
    (report.status==='fail'&&(!report.executed||!report.codes.length))||
    (report.status==='infra-error'&&(report.executed||report.codes.length)))
   throw Error('game-behavior-evidence-unverified');
 const o=report.observations;
 if(report.status==='pass'){
  if(game==='lhs'){
   if(!exact(o,LHS)||o.minutes!==180||
    !bounded(o.unique_visitors,2,1000)||
    !bounded(o.max_counter_queue,1,10)||
    o.queue_observed!==true||
    !bounded(o.moving_visitors,1,1000)||
    !bounded(o.stage_changes,1,10000)||
    o.invalid_positions!==0||o.duplicate_ids!==0||
    o.counter_slot_violations!==0||
    o.queue_slots_separated!==true||
    o.valid_save!==true||o.same_seed_same_traffic!==true||
    o.distinct_seeds_different_traffic!==true)
    throw Error('lhs-queue-proof-invalid');
  }else{
   if(!exact(o,TERR)||o.combat_target!=='-2,-2,0'||
    !bounded(o.initial_tile_x,-100000,100000)||
    !bounded(o.initial_tile_y,-100000,100000)||
    !bounded(o.final_tile_x,-100000,100000)||
    !bounded(o.final_tile_y,-100000,100000)||
    o.initial_tile_x===o.final_tile_x&&o.initial_tile_y===o.final_tile_y||
    o.movement_observed!==true||
    !bounded(o.kills,1,1000)||!bounded(o.experience,30,1e6)||
    o.mob_defeated!==true||o.invalid_target_rejected!==true||
    !bounded(o.hud_updates_before,1,1e6)||
    !bounded(o.hud_updates_after,o.hud_updates_before+1,1e6)||
    o.offline!==true||o.canvas_cleaned!==true)
    throw Error('terrania-combat-proof-invalid');
  }
 }else if(!o||typeof o!=='object'||Array.isArray(o)||
   Object.keys(o).length>18)throw Error('behavior-observations-unverified');
 return Object.freeze({...report,
  observations:Object.freeze({...o}),codes:Object.freeze([...report.codes])});
}
export function decodeGameBehaviorOutput(stdout,game,digest){
 if(typeof stdout!=='string'||stdout.length>32768)
  throw Error('game-behavior-output-unverified');
 const lines=stdout.split('\n').filter(x=>x.startsWith('SAC_GAME_BEHAVIOR_REPORT '));
 if(lines.length!==1)throw Error('game-behavior-output-unverified');
 let record;
 try{record=JSON.parse(lines[0].slice('SAC_GAME_BEHAVIOR_REPORT '.length));}
 catch{throw Error('game-behavior-output-unverified');}
 return validateGameBehaviorReport(record,game,digest);
}

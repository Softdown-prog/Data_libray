// Strict, digest-bound SAC evidence for true offline LHS/Phaser game loops.
const SHA=/^[0-9a-f]{64}$/;
const allowed=new Set([
 'external-request-blocked','outbound-websocket-blocked',
 'page-javascript-error','artifact-http-failure','runtime-probe-exception',
 'lhs-clock-did-not-advance','lhs-simulation-nondeterministic',
 'lhs-seed-insensitive','lhs-arrivals-unobserved','lhs-frame-did-not-update',
 'lhs-save-contract-invalid','lhs-canvas-shape-invalid',
 'phaser-canvas-empty','phaser-keyboard-no-tile-movement',
 'phaser-game-loop-not-updating','phaser-resize-invalid',
 'phaser-destroy-left-canvas'
]);
const fields=['schema_version','game','artifact_digest','status','executed',
 'runtime_step','observations','codes','network','gameplay_scope',
 'multiplayer_verified','complete_gameplay_verified','deployment_authorized'];
const keysEqual=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
const finiteInt=x=>Number.isInteger(x)&&x>=0&&x<=1e9;
const lhsFields=['minutes_advanced','cumulative_visitors','frame_changed_pixels',
 'replayed_game_state_equal','seed_sensitive_rng','save_contract_valid'];
const phaserFields=['phaser_scene_created','hud_updates_before',
 'hud_updates_after','moved_from_tile_x','moved_to_tile_x',
 'resize_width','renderer_screenshot_sha256','cleaned_up'];
export function validateRealGameLoopReport(v,game,digest){
 if(!['lhs','terrania'].includes(game)||!SHA.test(digest)||!keysEqual(v,fields)||
    v.schema_version!==1||v.game!==game||v.artifact_digest!==digest||
    !['pass','fail','infra-error'].includes(v.status)||
    typeof v.executed!=='boolean'||!Array.isArray(v.codes)||
    v.codes.length>17||v.codes.some(x=>!allowed.has(x))||
    !v.codes.every((x,i)=>i===0||x>v.codes[i-1])||
    v.network!=='none'||
    v.multiplayer_verified!==false||v.complete_gameplay_verified!==false||
    v.deployment_authorized!==false||
    v.runtime_step!==(game==='lhs'?'lhs-step-game':'terrania-phaser-input')&&
       v.status==='pass'||
    v.gameplay_scope!==(game==='lhs'?'offline-simulator-minute-steps':
      'offline-phaser-input-only')||
    (v.status==='pass'&&(!v.executed||v.codes.length!==0))||
    (v.status==='fail'&&(!v.executed||v.codes.length===0))||
    (v.status==='infra-error'&&(v.executed||v.codes.length!==0)))
    throw Error('invalid-game-loop-evidence');
 if(v.status==='pass'){
  const o=v.observations;
  if(game==='lhs'){
   if(!keysEqual(o,lhsFields)||o.minutes_advanced!==90||
     !finiteInt(o.cumulative_visitors)||o.cumulative_visitors<1||
     !finiteInt(o.frame_changed_pixels)||o.frame_changed_pixels<1||
     o.replayed_game_state_equal!==true||o.seed_sensitive_rng!==true||
     o.save_contract_valid!==true)throw Error('invalid-lhs-loop-proof');
  }else{
   if(!keysEqual(o,phaserFields)||o.phaser_scene_created!==true||
    !finiteInt(o.hud_updates_before)||o.hud_updates_before<1||
    !finiteInt(o.hud_updates_after)||o.hud_updates_after<=o.hud_updates_before||
    !Number.isInteger(o.moved_from_tile_x)||
    !Number.isInteger(o.moved_to_tile_x)||
    o.moved_to_tile_x<=o.moved_from_tile_x||
    !finiteInt(o.resize_width)||o.resize_width<300||o.resize_width>800||
    !SHA.test(o.renderer_screenshot_sha256)||
    o.cleaned_up!==true)throw Error('invalid-phaser-loop-proof');
  }
 }else{
  if(!v.observations||typeof v.observations!=='object'||
     Array.isArray(v.observations))throw Error('unverified-loop-observations');
 }
 return Object.freeze({...v,codes:Object.freeze([...v.codes]),
  observations:Object.freeze({...v.observations})});
}
export function decodeRealGameLoopOutput(stdout,game,digest){
 if(typeof stdout!=='string'||stdout.length>32768)
  throw Error('unverified-loop-output');
 const matches=stdout.split('\n').filter(line=>
  line.startsWith('SAC_REAL_GAME_LOOP_REPORT '));
 if(matches.length!==1)throw Error('unverified-loop-output');
 let v;
 try{v=JSON.parse(matches[0].slice('SAC_REAL_GAME_LOOP_REPORT '.length));}
 catch{throw Error('unverified-loop-output');}
 return validateRealGameLoopReport(v,game,digest);
}

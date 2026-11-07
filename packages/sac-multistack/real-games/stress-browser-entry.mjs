// Pinned offline game stress harness: real production engine code only.
// Runs inside the existing network-none Chromium Docker, not the SAC worker.
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serveArtifact} from './artifact-server.mjs';

let input=null,server=null,browser=null,context=null;
let status='infra-error',executed=false,stage='init',observations={};
const errors=new Set();
try{
 input=JSON.parse(await readFile('/opt/sac-input.json','utf8'));
 if(!['lhs','terrania'].includes(input?.game)||
    !/^[a-f0-9]{64}$/.test(input?.digest??''))
  throw Error('invalid-stress-input');
 server=await serveArtifact({dist:'/opt/sac-dist',digest:input.digest,
  mount:'/',routes:['/']});
 browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:15000,
  args:['--disable-background-networking',
   '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 executed=true;
 context=await browser.newContext({viewport:{width:1000,height:700},
  serviceWorkers:'block',permissions:[],acceptDownloads:false});
 await context.route('**/*',async route=>{
  const req=route.request();let allowed=false;
  try{
   const url=new URL(req.url());
   allowed=url.origin===server.origin&&['GET','HEAD'].includes(req.method());
  }catch{}
  if(!allowed){errors.add('external-request-blocked');await route.abort();}
  else await route.continue();
 });
 await context.routeWebSocket('**/*',socket=>{
  errors.add('websocket-request-blocked');socket.close();
 });
 const page=await context.newPage();
 page.on('pageerror',()=>errors.add('game-script-exception'));
 const response=await page.goto(server.origin+'/',{waitUntil:'load',timeout:12000});
 if(response?.status()!==200)throw Error('game-stress-page-unavailable');
 await page.waitForFunction(()=>!!window.__sacStress,null,{timeout:8000});
 stage=input.game==='lhs'?'retail-layouts':'obstacle-pursuit-multitarget';
 const summary=await page.evaluate(game=>{
  if(window.__sacStress.game!==game)throw Error('wrong-game-bundle');
  const first=window.__sacStress.run(),second=window.__sacStress.run();
  return {first,repeated:JSON.stringify(first)===JSON.stringify(second)};
 },input.game);
 if(!summary.repeated)errors.add('seeded-replay-nondeterministic');
 if(input.game==='lhs'){
  const trials=summary.first;
  if(!Array.isArray(trials)||trials.length!==3)
   throw Error('lhs-layout-shape-invalid');
  for(const result of trials){
   if(!result.edited)errors.add('layout-editor-failed');
   if(result.slots_available<8||!result.slots_separated||
      result.counter_slot_conflict)errors.add('retail-slot-layout-invalid');
   if(result.remaining!==0||result.duration_minutes>=360||
      result.movement_count<1)
    errors.add('retail-customers-did-not-exit');
   if(result.overlap_count||result.wall_crossings||result.teleports)
    errors.add('customer-collision-or-teleport');
   if(result.purchases<8||result.purchases>16||!result.cash_balanced)
    errors.add('purchase-accounting-invalid');
  }
  observations={layouts:trials,replay_equal:summary.repeated};
 }else{
  const {passable_wall,impassable_wall,selected_target_switch,focused_combat}=summary.first;
  if(!passable_wall.initiallyBlocked||!passable_wall.walked||
      !passable_wall.reached||passable_wall.forbidden!==0||
      !passable_wall.clear_after)
   errors.add('pursuit-through-avoidable-wall-failed');
  if(!impassable_wall.initiallyBlocked||impassable_wall.reached||
      impassable_wall.forbidden!==0||impassable_wall.final_x>=70)
   errors.add('impassable-wall-crossed');
  if(selected_target_switch.first_destination_x<=100||
      selected_target_switch.moved_target_destination_x<=200||
      selected_target_switch.new_target_destination_y<=160||
      selected_target_switch.new_direction_y<=0||
      !selected_target_switch.suspended_destination_cleared)
   errors.add('target-switch-path-stale');
  if(!focused_combat.selected||focused_combat.strikes!==2||
      focused_combat.focus_hp>0||!focused_combat.focus_defeated||
      focused_combat.kills!==1||focused_combat.experience<=0)
   errors.add('focused-swing-not-confirmed');
  if(focused_combat.bystander_hp!==2||
      focused_combat.bystander_damaged||
      !focused_combat.invalid_rejected||
      !focused_combat.dead_target_rejected)
   errors.add('bystander-or-target-selection-invalid');
  observations={...summary.first,replay_equal:summary.repeated};
 }
 status=errors.size?'fail':'pass';
}catch{
 if(!executed){status='infra-error';errors.clear();}
 else{status='fail';errors.add('stress-probe-exception');}
}finally{
 try{await context?.close();}catch{}
 try{await browser?.close();}catch{}
 try{await server?.close();}catch{}
}
process.stdout.write('SAC_REAL_STRESS_REPORT '+JSON.stringify({
 schema_version:1,game:input?.game??null,artifact_digest:input?.digest??null,
 status,executed,stage,observations,codes:[...errors].sort(),
 source_scope:'pinned-offline-engine-properties',
 full_gameplay_verified:false,multiplayer_verified:false,
 deployment_authorized:false
})+'\n');

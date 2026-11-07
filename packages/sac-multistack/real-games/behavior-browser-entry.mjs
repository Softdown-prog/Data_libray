// Real game behavior evidence: run only within SAC's pinned network-none Chrome.
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serveArtifact} from './artifact-server.mjs';

let input=null,server=null,browser=null,context=null,stage='init';
const errors=new Set();let executed=false,status='infra-error',observations={};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
try{
 input=JSON.parse(await readFile('/opt/sac-input.json','utf8'));
 if(!['lhs','terrania'].includes(input?.game)||
    !/^[a-f0-9]{64}$/.test(input?.digest??''))
  throw Error('invalid-input');
 server=await serveArtifact({
  dist:'/opt/sac-dist',digest:input.digest,mount:'/',routes:['/']
 });
 browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:15000,
  args:['--disable-background-networking',
   '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 executed=true;
 context=await browser.newContext({viewport:{width:1100,height:750},
  deviceScaleFactor:1,permissions:[],serviceWorkers:'block',
  acceptDownloads:false});
 await context.route('**/*',async route=>{
  const req=route.request();let allow=false;
  try{
   const url=new URL(req.url());
   allow=url.origin===server.origin&&['GET','HEAD'].includes(req.method());
  }catch{}
  if(!allow){errors.add('external-request-blocked');await route.abort();}
  else await route.continue();
 });
 await context.routeWebSocket('**/*',ws=>{
  errors.add('websocket-blocked');ws.close();
 });
 const page=await context.newPage();
 page.on('pageerror',()=>errors.add('javascript-exception'));
 const url=server.origin+'/?modo=classico&passos=1&seed=842136';
 const response=await page.goto(url,{waitUntil:'load',timeout:12000});
 if(response?.status()!==200)throw Error('page-unavailable');
 await page.waitForFunction(()=>Boolean(window.__sacBehavior),null,{timeout:8000});
 if(input.game==='lhs'){
  stage='customer-queue';
  const sample=await page.evaluate(()=>{
   const run=window.__sacBehavior.run;
   if(window.__sacBehavior.game!=='lhs')throw Error('adapter-identity');
   const first=run(72421,180),repeated=run(72421,180),
    other=run(72422,180);
   return {first,repeatEqual:JSON.stringify(first)===JSON.stringify(repeated),
    otherDifferent:first.unique_visitors!==other.unique_visitors||
     first.stage_changes!==other.stage_changes||
     first.moved_customer_ids!==other.moved_customer_ids};
  });
  const a=sample.first;
  if(a.minutes!==180)errors.add('clock-not-advanced');
  if(!a.queue_slots_separated||a.counter_slot_violations>0||
     a.max_counter_queue<1||!a.queue_seen)
   errors.add('counter-queue-invariant-failed');
  if(a.invalid_positions||a.duplicate_ids||!a.saved_state_valid)
   errors.add('customer-state-invalid');
  if(a.unique_visitors<2||a.moved_customer_ids<1||a.stage_changes<1)
   errors.add('customer-movement-or-lifecycle-absent');
  if(!sample.repeatEqual)errors.add('customer-queue-nondeterministic');
  if(!sample.otherDifferent)errors.add('customer-seed-diversity-unobserved');
  observations={minutes:a.minutes,unique_visitors:a.unique_visitors,
   max_counter_queue:a.max_counter_queue,queue_observed:a.queue_seen,
   moving_visitors:a.moved_customer_ids,stage_changes:a.stage_changes,
   invalid_positions:a.invalid_positions,duplicate_ids:a.duplicate_ids,
   counter_slot_violations:a.counter_slot_violations,
   queue_slots_separated:a.queue_slots_separated,
   valid_save:a.saved_state_valid,
   same_seed_same_traffic:sample.repeatEqual,
   distinct_seeds_different_traffic:sample.otherDifferent};
 }else{
  stage='phaser-pursuit-combat';
  await page.waitForFunction(()=>window.__sacBehavior?.game==='terrania'&&
   window.__sacBehavior.state().creature_visible,null,{timeout:15000});
  const before=await page.evaluate(()=>window.__sacBehavior.state());
  await page.evaluate(()=>window.__sacBehavior.select('invalid-target-id'));
  await page.waitForTimeout(100);
  const afterInvalid=await page.evaluate(()=>window.__sacBehavior.state());
  if(afterInvalid.target!==null)errors.add('invalid-target-accepted');
  await page.evaluate(()=>window.__sacBehavior.select('-2,-2,0'));
  await page.waitForFunction(()=>{
    const s=window.__sacBehavior.saved();
    return s?.defeated?.includes('-2,-2,0')&&s.kills>=1&&s.experience>=30;
  },null,{timeout:22000,polling:250});
  const final=await page.evaluate(()=>({
   state:window.__sacBehavior.state(),save:window.__sacBehavior.saved()
  }));
  const moved=before.hero?.tileX!==final.state.hero?.tileX||
   before.hero?.tileY!==final.state.hero?.tileY;
  if(!moved||final.save.defeated?.includes('-2,-2,0')!==true)
   errors.add('pursuit-or-kill-missing');
  if(final.save.kills<1||final.save.experience<30)
   errors.add('combat-progress-missing');
  if(final.state.updates<=before.updates)
   errors.add('phaser-frame-loop-stalled');
  if(final.state.online)errors.add('network-session-unexpected');
  const cleaned=await page.evaluate(()=>window.__sacBehavior.destroy());
  if(!cleaned)errors.add('phaser-canvas-not-disposed');
  observations={combat_target:'-2,-2,0',
   initial_tile_x:before.hero?.tileX??null,
   initial_tile_y:before.hero?.tileY??null,
   final_tile_x:final.state.hero?.tileX??null,
   final_tile_y:final.state.hero?.tileY??null,
   movement_observed:moved,
   kills:final.save.kills,experience:final.save.experience,
   mob_defeated:final.save.defeated?.includes('-2,-2,0')??false,
   invalid_target_rejected:afterInvalid.target===null,
   hud_updates_before:before.updates,hud_updates_after:final.state.updates,
   offline:!final.state.online,canvas_cleaned:cleaned};
 }
 status=errors.size?'fail':'pass';
}catch{
 if(!executed){status='infra-error';errors.clear();}
 else{status='fail';errors.add('behavior-probe-exception');}
}finally{
 try{await context?.close();}catch{}
 try{await browser?.close();}catch{}
 try{await server?.close();}catch{}
}
process.stdout.write('SAC_GAME_BEHAVIOR_REPORT '+JSON.stringify({
 schema_version:1,game:input?.game??null,artifact_digest:input?.digest??null,
 status,executed,stage,observations,codes:[...errors].sort(),
 source_scope:'pinned-production-offline-game-logic',
 multiplayer_verified:false,complete_gameplay_verified:false,
 deployment_authorized:false
})+'\n');

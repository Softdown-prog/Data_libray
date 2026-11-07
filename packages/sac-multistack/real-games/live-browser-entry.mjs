// SAC: real Phaser tick/input and LHS customer-time simulation in offline Chrome.
// Execute only inside the existing resource-limited, network-none Docker browser.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {serveArtifact} from './artifact-server.mjs';

let input,server,browser,context;
const codes=new Set();
let executed=false,status='infra-error',runtimeStep='not-run';
const observations={};
try{
 input=JSON.parse(await readFile('/opt/sac-input.json','utf8'));
 if(!['lhs','terrania'].includes(input?.game)||
    !/^[a-f0-9]{64}$/.test(input?.digest??''))
   throw Error('invalid-adapter-config');
 server=await serveArtifact({dist:'/opt/sac-dist',digest:input.digest,
  mount:'/',routes:['/']});
 browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:15000,
  args:['--disable-background-networking',
   '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 executed=true;
 context=await browser.newContext({viewport:{width:1100,height:750},
  deviceScaleFactor:1,serviceWorkers:'block',permissions:[],
  acceptDownloads:false});
 await context.route('**/*',async route=>{
  const request=route.request();
  let permitted=false;
  try{
   const url=new URL(request.url());
   permitted=url.origin===server.origin&&['GET','HEAD'].includes(request.method());
  }catch{}
  if(!permitted){codes.add('external-request-blocked');await route.abort();}
  else await route.continue();
 });
 await context.routeWebSocket('**/*',ws=>{
  codes.add('outbound-websocket-blocked');ws.close();
 });
 const page=await context.newPage();
 page.on('pageerror',()=>codes.add('page-javascript-error'));
 page.on('response',res=>{
  if(res.status()>=400&&['document','script'].includes(res.request().resourceType()))
   codes.add('artifact-http-failure');
 });
 const url=server.origin+'/?modo=classico&passos=1&seed=842136';
 const response=await page.goto(url,{waitUntil:'load',timeout:12000});
 if(response?.status()!==200)throw Error('harness-navigation-failed');
 await page.waitForFunction(()=>Boolean(window.__sacLive),null,{timeout:8000});
 if(input.game==='lhs'){
  runtimeStep='lhs-step-game';
  const result=await page.evaluate(()=>{
   if(window.__sacLive.kind!=='lhs')throw Error('adapter-mismatch');
   const run=window.__sacLive.run;
   const start=run(72421,0);
   const after=run(72421,90);
   const replay=run(72421,90);
   const other=run(72422,90);
   return {start,after,
    same_state:JSON.stringify(after.state)===JSON.stringify(replay.state),
    different_rng:after.state.rng!==other.state.rng,
    initial_count:start.state.nextCustomerId,
    end_count:after.state.nextCustomerId,
    replay_pixel_pixels_changed_equal:after.changed===replay.changed,
    replay_frame_size_equal:after.width===replay.width&&after.height===replay.height};
  });
  if(result.after.state.minute!==90||result.start.state.minute!==0)
   codes.add('lhs-clock-did-not-advance');
  if(!result.same_state||!result.replay_pixel_pixels_changed_equal)
   codes.add('lhs-simulation-nondeterministic');
  if(!result.different_rng)codes.add('lhs-seed-insensitive');
  if(result.end_count<=result.initial_count)codes.add('lhs-arrivals-unobserved');
  if(result.after.changed===0||result.after.nontransparent<50000)
   codes.add('lhs-frame-did-not-update');
  if(!result.after.save_valid)codes.add('lhs-save-contract-invalid');
  if(!result.replay_frame_size_equal||result.after.width!==1000||
      result.after.height!==610)codes.add('lhs-canvas-shape-invalid');
  observations.minutes_advanced=result.after.state.minute;
  observations.cumulative_visitors=result.end_count-result.initial_count;
  observations.frame_changed_pixels=result.after.changed;
  observations.replayed_game_state_equal=result.same_state;
  observations.seed_sensitive_rng=result.different_rng;
  observations.save_contract_valid=result.after.save_valid;
 }else{
  runtimeStep='terrania-phaser-input';
  await page.waitForFunction(()=>
   window.__sacLive?.kind==='terrania'&&
   window.__sacLive.state().gameCreated&&
   window.__sacLive.state().updates>5,null,{timeout:15000});
  const before=await page.evaluate(()=>window.__sacLive.state());
  const canvas=page.locator('canvas#game');
  const picture=await canvas.screenshot({timeout:10000});
  const sha=createHash('sha256').update(picture).digest('hex');
  if(picture.length<2500||!sha.match(/^[a-f0-9]{64}$/))
   codes.add('phaser-canvas-empty');
  await page.keyboard.down('d');
  await page.waitForTimeout(320);
  await page.keyboard.up('d');
  await page.waitForTimeout(300);
  const after=await page.evaluate(()=>window.__sacLive.state());
  if(!Number.isInteger(before.hero?.tileX)||
     !Number.isInteger(after.hero?.tileX)||
     after.hero.tileX<=before.hero.tileX)
   codes.add('phaser-keyboard-no-tile-movement');
  if(after.updates<=before.updates||after.width<200||after.height<150)
   codes.add('phaser-game-loop-not-updating');
  await page.evaluate(()=>{
   const mount=document.getElementById('mount');
   mount.style.width='380px';
   mount.style.height='480px';
   window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(500);
  const resized=await page.evaluate(()=>window.__sacLive.state());
  if(resized.width<300||resized.width>800)
   codes.add('phaser-resize-invalid');
  const disposed=await page.evaluate(()=>window.__sacLive.destroy());
  await page.waitForTimeout(250);
  const gone=await page.locator('canvas#game').count()===0;
  if(!gone)codes.add('phaser-destroy-left-canvas');
  observations.phaser_scene_created=before.gameCreated;
  observations.hud_updates_before=before.updates;
  observations.hud_updates_after=after.updates;
  observations.moved_from_tile_x=before.hero?.tileX??null;
  observations.moved_to_tile_x=after.hero?.tileX??null;
  observations.resize_width=resized.width;
  observations.renderer_screenshot_sha256=sha;
  observations.cleaned_up=gone;
 }
 status=codes.size?'fail':'pass';
}catch{
 if(!executed){status='infra-error';codes.clear();}
 else {status='fail';codes.add('runtime-probe-exception');}
}finally{
 try{await context?.close();}catch{}
 try{await browser?.close();}catch{}
 try{await server?.close();}catch{}
}
process.stdout.write('SAC_REAL_GAME_LOOP_REPORT '+JSON.stringify({
 schema_version:1,game:input?.game??null,
 artifact_digest:input?.digest??null,status,executed,runtime_step:runtimeStep,
 observations,codes:[...codes].sort(),network:'none',
 gameplay_scope:input?.game==='terrania'?'offline-phaser-input-only':'offline-simulator-minute-steps',
 multiplayer_verified:false,complete_gameplay_verified:false,
 deployment_authorized:false
})+'\n');

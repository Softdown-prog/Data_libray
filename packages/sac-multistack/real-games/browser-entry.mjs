// Real first-party game renderer evidence inside network-none Chromium Docker.
// Only hard-coded pinned bundles; does not start multiplayer or payment APIs.
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serveArtifact} from './artifact-server.mjs';

let input=null,server=null,browser=null,context=null;
const codes=new Set(),samples=[];
let executed=false,checks=0,status='infra-error';
try{
 input=JSON.parse(await readFile('/opt/sac-input.json','utf8'));
 if(!['lhs','terrania'].includes(input?.game)||
    !/^[a-f0-9]{64}$/.test(input?.digest??''))throw Error('invalid-game-evidence');
 server=await serveArtifact({
  dist:'/opt/sac-dist',digest:input.digest,mount:'/',routes:['/']
 });
 browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:15000,
  args:['--disable-background-networking',
   '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 executed=true;
 for(const dpr of [1,2]){
  context=await browser.newContext({
   viewport:{width:dpr===1?1280:390,height:dpr===1?720:844},
   isMobile:dpr===2,hasTouch:dpr===2,deviceScaleFactor:dpr,
   serviceWorkers:'block',permissions:[],acceptDownloads:false
  });
  await context.route('**/*',async route=>{
   const req=route.request();
   let allowed=false;
   try{
    const url=new URL(req.url());
    allowed=url.origin===server.origin&&['GET','HEAD'].includes(req.method())&&
     (!req.isNavigationRequest()||url.pathname==='/');
   }catch{}
   if(!allowed){codes.add('request-outside-sandbox');await route.abort();}
   else await route.continue();
  });
  await context.routeWebSocket('**/*',ws=>{codes.add('websocket-blocked');ws.close();});
  context.on('page',page=>{
   if(context.pages().length>1){codes.add('popup-blocked');void page.close().catch(()=>{});}
  });
  const page=await context.newPage();
  page.on('pageerror',()=>codes.add('javascript-exception'));
  page.on('response',resp=>{
   if(resp.status()>=400&&['document','script'].includes(resp.request().resourceType()))
    codes.add('artifact-http-failure');
  });
  const response=await page.goto(server.origin+'/',{waitUntil:'load',timeout:12000});
  if(response?.status()!==200)throw Error('fixture-page-unavailable');
  await page.waitForFunction(()=>Boolean(window.__sacRealGame),null,{timeout:7000});
  const sample=await page.evaluate(async (game)=>{
   const mod=window.__sacRealGame;
   if(mod.game!==game)throw Error('adapter-identity-mismatch');
   const seeds=game==='lhs'?[72421,72422]:[842136,842137];
   const first=mod.sample(seeds[0]);
   const again=mod.sample(seeds[0]);
   const another=mod.sample(seeds[1]);
   const fingerprint=async value=>{
    const buf=new TextEncoder().encode(JSON.stringify(value));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buf)))
     .map(n=>n.toString(16).padStart(2,'0')).join('');
   };
   async function frame(seed,variation=0,clear=false){
    const canvas=document.getElementById('scene');
    let meta={};
    if(clear){
     const ctx=canvas.getContext('2d');
     ctx.setTransform(1,0,0,1,0,0);
     ctx.clearRect(0,0,canvas.width,canvas.height);
    }else meta=mod.render(seed,variation);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let painted=0;
    for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)painted++;
    const buffer=await crypto.subtle.digest('SHA-256',pixels);
    return {sha:Array.from(new Uint8Array(buffer)).map(n=>n.toString(16).padStart(2,'0')).join(''),
     width:canvas.width,height:canvas.height,painted,meta};
   }
   const a=await frame(seeds[0]);
   const repeat=await frame(seeds[0]);
   const changed=await frame(seeds[0],1);
   const blank=await frame(seeds[0],0,true);
   return {source_a:await fingerprint(first),source_repeat:await fingerprint(again),
    source_b:await fingerprint(another),a,repeat,changed,blank};
  },input.game);
  const expected=input.game==='lhs'?[1000,610]:[512,512];
  if(sample.source_a!==sample.source_repeat)codes.add('seed-sample-nondeterministic');
  if(sample.source_a===sample.source_b)codes.add('different-seed-sample-identical');
  if(sample.a.sha!==sample.repeat.sha)codes.add('same-scene-pixels-differ');
  if(sample.a.sha===sample.changed.sha)codes.add('changed-scene-pixels-identical');
  if(sample.a.width!==expected[0]||sample.a.height!==expected[1])
   codes.add('render-size-unexpected');
  if(sample.a.painted<5000)codes.add('render-empty');
  if(sample.blank.painted!==0||sample.blank.sha===sample.a.sha)
   codes.add('blank-negative-not-detected');
  if(input.game==='terrania'&&(sample.a.meta.cached>24||
      sample.changed.meta.cached>24||sample.a.meta.cached<1))
   codes.add('terrania-chunk-cache-unbounded');
  samples.push({dpr,base_sha256:sample.a.sha,
   changed_sha256:sample.changed.sha,seed_sample_sha256:sample.source_a,
   painted_pixels:sample.a.painted});
  checks++;
  await context.close();context=null;
 }
 status=codes.size?'fail':'pass';
}catch{
 if(!executed){status='infra-error';codes.clear();}
 else{status='fail';codes.add('render-assertion-failed');}
}finally{
 try{await context?.close();}catch{}
 try{await browser?.close();}catch{}
 try{await server?.close();}catch{}
}
process.stdout.write('SAC_REAL_GAME_RENDER_REPORT '+JSON.stringify({
 schema_version:1,game:input?.game??null,artifact_digest:input?.digest??null,
 status,executed,dpr_variants_checked:checks,samples,
 codes:[...codes].sort(),runtime_scope:'isolated-renderer-only',
 gameplay_verified:false,multiplayer_verified:false,
 deployment_authorized:false
})+'\n');

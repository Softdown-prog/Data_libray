// SAC Canvas2D synthetic browser entry, executed ONLY inside isolated Docker.
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serveArtifact} from './artifact-server.mjs';

const input=JSON.parse(await readFile('/opt/sac-input.json','utf8'));
let server,browser,context;
let status='infra-error',executed=false;
const codes=new Set();
let deviceScaleFactorsChecked=0;
try{
 if(input?.scenario!=='canvas-seeded-2d'||
    !/^[a-f0-9]{64}$/.test(input?.digest??''))
   throw Error('bad-input');
 server=await serveArtifact({
  dist:'/opt/sac-dist',digest:input.digest,mount:'/',routes:['/']
 });
 browser=await chromium.launch({
  headless:true,chromiumSandbox:true,timeout:15000,
  args:['--disable-background-networking',
   '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
 });
 executed=true;
 for(const dpr of [1,2]){
  context=await browser.newContext({
   viewport:{width:dpr===1?1280:390,height:dpr===1?720:844},
   deviceScaleFactor:dpr,isMobile:dpr===2,hasTouch:dpr===2,
   permissions:[],serviceWorkers:'block',acceptDownloads:false
  });
  await context.route('**/*',async route=>{
   const req=route.request();
   let safe=false;
   try{
    const url=new URL(req.url());
    safe=url.origin===server.origin&&
     ['GET','HEAD'].includes(req.method())&&
     (!req.isNavigationRequest()||url.pathname==='/');
   }catch{}
   if(!safe){codes.add('external-request-blocked');await route.abort();}
   else await route.continue();
  });
  context.on('page',page=>{
   if(context.pages().length>1){
    codes.add('popup-blocked');void page.close().catch(()=>{});
   }
  });
  const page=await context.newPage();
  page.on('pageerror',()=>codes.add('page-error'));
  const response=await page.goto(server.origin+'/',{
   waitUntil:'load',timeout:12000
  });
  if(response?.status()!==200)throw Error('unavailable-canvas-page');
  await page.waitForFunction(()=>Boolean(window.__sacCanvasFixture),null,{
   timeout:5000
  });
  async function frame(seed,broken=false){
   return await page.evaluate(async ({seed,broken})=>{
    const canvas=document.getElementById('scene');
    const fixture=window.__sacCanvasFixture;
    if(broken)fixture.broken();
    else fixture.render(seed);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let opaque=0;
    for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==0)opaque++;
    const hash=await crypto.subtle.digest('SHA-256',pixels);
    return {sha:Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join(''),
     width:canvas.width,height:canvas.height,
     nontransparent_pixels:opaque};
   },{seed,broken});
  }
  const first=await frame(123456);
  const repeat=await frame(123456);
  const different=await frame(654321);
  const blank=await frame(123456,true);
  if(first.width!==256*dpr||first.height!==128*dpr)
   codes.add('dpr-backing-size-mismatch');
  else deviceScaleFactorsChecked++;
  if(first.nontransparent_pixels<10000)
   codes.add('drawn-frame-empty');
  if(first.sha!==repeat.sha)
   codes.add('same-seed-pixels-differ');
  if(first.sha===different.sha)
   codes.add('different-seed-pixels-identical');
  if(blank.nontransparent_pixels!==0||blank.sha===first.sha)
   codes.add('blank-frame-negative-missed');
  await context.close();context=null;
 }
 status=codes.size?'fail':'pass';
}catch{
 if(!executed){status='infra-error';codes.clear();}
 else{status='fail';codes.add('canvas-browser-assertion-failed');}
}finally{
 try{await context?.close();}catch{}
 try{await browser?.close();}catch{}
 try{await server?.close();}catch{}
}
process.stdout.write('SAC_CANVAS_BROWSER_REPORT '+JSON.stringify({
 schema_version:1,scenario:'canvas-seeded-2d',
 artifact_digest:input?.digest??null,status,executed,
 dpr_variants_verified:deviceScaleFactorsChecked,
 same_seed_repeated:true,different_seed_checked:true,
 blank_frame_negative_checked:true,
 codes:[...codes].sort(),deployment_authorized:false
})+'\n');

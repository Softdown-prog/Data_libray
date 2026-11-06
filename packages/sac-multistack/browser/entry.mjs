// Strictly first-party Vue/React interaction probe inside the SAC Chromium sandbox.
// No network, no host credentials; receives only a dist digest and a fixed scenario.
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serveArtifact} from './artifact-server.mjs';

const input=JSON.parse(await readFile('/opt/sac-input.json','utf8'));
let server,browser,context;
const codes=new Set();
let status='infra-error',executed=false;
try {
 if(!['vue-click','react-click'].includes(input?.scenario)||
    !/^[a-f0-9]{64}$/.test(input?.digest??''))throw Error('bad-fixture');
 server=await serveArtifact({dist:'/opt/sac-dist',digest:input.digest,
    mount:'/',routes:['/']});
 browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:15000,
    args:['--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 executed=true;
 context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,
    permissions:[]});
 await context.route('**/*',async route=>{
   const req=route.request();
   let allowed=false;
   try{
     const url=new URL(req.url());
     allowed=url.origin===server.origin&&['GET','HEAD'].includes(req.method())&&
       (!req.isNavigationRequest()||
         (req.method()==='GET'&&url.pathname==='/'));
   }catch{}
   if(!allowed){codes.add('network-policy-blocked');await route.abort();}
   else await route.continue();
 });
 await context.routeWebSocket('**/*',ws=>{
   codes.add('websocket-blocked');ws.close();
 });
 context.on('page',page=>{
   if(context.pages().length>1){
     codes.add('popup-blocked');void page.close().catch(()=>{});
   }
 });
 const page=await context.newPage();
 page.on('pageerror',()=>codes.add('application-pageerror'));
 page.on('console',message=>{
   if(message.type()==='error')codes.add('application-console-error');
 });
 page.on('response',response=>{
   if(response.status()>=400&&
     ['document','script','stylesheet'].includes(response.request().resourceType()))
     codes.add('http-error');
 });
 page.on('requestfailed',req=>{
   if(req.resourceType()!=='image')codes.add('request-failed');
 });
 try{
   const response=await page.goto(server.origin+'/',{
     waitUntil:'networkidle',timeout:12000
   });
   if(!response||response.status()!==200||
      page.url()!==server.origin+'/')throw Error('bad-navigation');
   const button=page.locator('button').first();
   await button.waitFor({state:'visible',timeout:5000});
   if((await button.textContent())?.trim()!=='Count 0')
     throw Error('wrong-initial-count');
   await button.click({timeout:5000});
   try{
     await page.waitForFunction(
       ()=>document.querySelector('button')?.textContent?.trim()==='Count 1',
       null,{timeout:1800});
   }catch{codes.add('no-observable-transition');}
   if(page.url()!==server.origin+'/')codes.add('unexpected-navigation');
   await page.waitForTimeout(80);
 }catch{codes.add('required-assertion-failed');}
 status=codes.size?'fail':'pass';
}catch{
 status='infra-error';executed=false;codes.clear();
}finally{
 try{await context?.close();}catch{}
 try{await browser?.close();}catch{}
 try{await server?.close();}catch{}
}
process.stdout.write('SAC_MULTISTACK_BROWSER_REPORT '+
 JSON.stringify({schema_version:1,scenario:input?.scenario??null,
   artifact_digest:input?.digest??null,status,executed,
   codes:[...codes].sort(),deployment_authorized:false})+'\n');

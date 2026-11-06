/**
 * SAC-062 Next.js official first-party probe.
 * Positive TS/build/live SSR + API routes; type error TS2339; semantic API
 * regression which still typechecks/builds, observed via live HTTP on loopback.
 * Never builds/executes tenant code, project-provided npm scripts or secrets.
 */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile,writeFile,rm,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const fixture=fileURLToPath(new URL('../packages/sac-multistack/fixtures/nextjs/',import.meta.url));
const page=path.join(fixture,'app/page.tsx');
const route=path.join(fixture,'app/api/health/route.ts');
const tsc=path.join(fixture,'node_modules/.bin/tsc');
const next=path.join(fixture,'node_modules/next/dist/bin/next');
const generated=path.join(fixture,'.next');
const baseEnv={PATH:process.env.PATH||'/usr/bin:/bin',
 HOME:os.tmpdir(),CI:'true',NEXT_TELEMETRY_DISABLED:'1',
 NODE_ENV:'production'};
const short=proc=>proc.error||proc.signal||proc.status===null?'unverified':
 proc.status===0?'pass':'fail';
function invoke(binary,args,timeout=180000){
 const proc=spawnSync(binary,args,{cwd:fixture,env:baseEnv,
   encoding:'utf8',timeout,maxBuffer:32768,shell:false});
 const raw=(String(proc.stdout||'')+'\n'+String(proc.stderr||'')).slice(0,32768);
 const codes=[...new Set([...raw.matchAll(/\bTS[0-9]{4,5}\b/g)].map(x=>x[0]))].slice(0,8);
 return {status:short(proc),codes};
}
async function allocateLoopbackPort(){
 return new Promise((resolve,reject)=>{
  const server=createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   const port=server.address()?.port;
   server.close(error=>error?reject(error):resolve(port));
  });
 });
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function httpStatus(expected){
 const port=await allocateLoopbackPort();
 const url='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,[next,'start','--hostname','127.0.0.1',
   '--port',String(port)],{cwd:fixture,env:baseEnv,
   stdio:['ignore','ignore','ignore'],shell:false});
 const exited=new Promise(resolve=>{
  if(child.exitCode!==null||child.signalCode!==null)resolve();
  else child.once('exit',resolve);
 });
 try{
  let ready=false;
  for(let i=0;i<56;i++){
   if(child.exitCode!==null||child.signalCode!==null)break;
   try{
    const res=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1500)});
    if(res.status===200){ready=true;break;}
   }catch{}
   await pause(250);
  }
  if(!ready)return {status:'unverified',observed:null};
  const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(5000)});
  const body=await response.json();
  const pageResponse=await fetch(url+'/',{signal:AbortSignal.timeout(5000)});
  const html=await pageResponse.text();
  const missing=await fetch(url+'/missing-synthetic-route',{signal:AbortSignal.timeout(5000)});
  const safeBody=body&&typeof body==='object'&&!Array.isArray(body)&&
    Object.keys(body).length===1&&['ok','regressed'].includes(body.status);
  if(!safeBody||response.status!==200||pageResponse.status!==200||
     !html.includes('SAC Next healthy')||missing.status!==404)
    return {status:'fail',observed:null};
  return {status:body.status===expected?'pass':'fail',observed:body.status};
 }catch{
  return {status:'unverified',observed:null};
 }finally{
  child.kill('SIGTERM');
  await Promise.race([exited,pause(3000)]);
  if(child.exitCode===null&&child.signalCode===null){
   child.kill('SIGKILL');await Promise.race([exited,pause(1000)]);
  }
 }
}
const pageSource=await readFile(page,'utf8');
const routeSource=await readFile(route,'utf8');
const goodType='label.toUpperCase()';
const badType='label.nonExistentMethod()';
const goodApi="return Response.json({status:'ok'});";
const badApi="return Response.json({status:'regressed'});";
assert.ok(pageSource.includes(goodType)&&routeSource.includes(goodApi),
 'synthetic-fixture-mismatch');
const report={schema_version:1,kind:'synthetic-official-nextjs-typescript-build-ssr-http',
 deployment_authorized:false,backend:'nextjs',loopback_only:true,browser:'not-run',
 checks:[]};
let typePositive={status:'not-run',codes:[]},typeNegative={status:'not-run',codes:[]};
let positiveBuild={status:'not-run'},negativeBuild={status:'not-run'};
let livePositive={status:'not-run'},liveNegative={status:'not-run',observed:null};
try{
 typePositive=invoke(tsc,['--noEmit','-p','tsconfig.json'],90000);
 await writeFile(page,pageSource.replace(goodType,badType));
 typeNegative=invoke(tsc,['--noEmit','-p','tsconfig.json'],90000);
 await writeFile(page,pageSource);
 if(typePositive.status==='pass'&&typeNegative.status==='fail'&&
    typeNegative.codes.includes('TS2339')){
   await rm(generated,{recursive:true,force:true});
   positiveBuild=invoke(process.execPath,[next,'build'],240000);
   if(positiveBuild.status==='pass'){
    try{
     if((await stat(path.join(generated,'BUILD_ID'))).size>0)
       livePositive=await httpStatus('ok');
    }catch{livePositive={status:'unverified'};}
   }
   // Type-correct API regression: the Next.js compiler must still succeed.
   await writeFile(route,routeSource.replace(goodApi,badApi));
   const semanticType=invoke(tsc,['--noEmit','-p','tsconfig.json'],90000);
   if(semanticType.status==='pass'){
    await rm(generated,{recursive:true,force:true});
    negativeBuild=invoke(process.execPath,[next,'build'],240000);
    if(negativeBuild.status==='pass'){
     try{
      if((await stat(path.join(generated,'BUILD_ID'))).size>0)
        liveNegative=await httpStatus('ok');
     }catch{liveNegative={status:'unverified',observed:null};}
    }
   }
  }
}finally{
 await writeFile(page,pageSource);
 await writeFile(route,routeSource);
 await rm(generated,{recursive:true,force:true});
}
const regressionObserved=liveNegative.status==='fail'&&
 liveNegative.observed==='regressed';
const approved=typePositive.status==='pass'&&typeNegative.status==='fail'&&
 typeNegative.codes.includes('TS2339')&&
 positiveBuild.status==='pass'&&livePositive.status==='pass'&&
 negativeBuild.status==='pass'&&regressionObserved;
report.checks.push({
 module_id:'nextjs',tools:['tsc','next','http'],
 valid_typecheck:typePositive.status,invalid_typecheck:typeNegative.status,
 observed_type_error:typeNegative.codes.includes('TS2339')?'TS2339':null,
 official_build_positive:positiveBuild.status,ssr_and_api_positive:livePositive.status,
 official_build_semantic_regression:negativeBuild.status,
 http_semantic_regression:liveNegative.status,
 observed_regression:regressionObserved?'api-response-mismatch':null,
 status:approved?'pass':'fail'
});
process.stdout.write(JSON.stringify(report)+'\n');
if(!approved)process.exitCode=1;

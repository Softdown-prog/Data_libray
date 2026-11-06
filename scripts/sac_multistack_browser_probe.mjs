/**
 * SAC-062: compile synthetic Vue/React fixtures and verify real interactions
 * inside the pinned SAC Chromium Docker sandbox. Not for external projects.
 */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {constants} from 'node:fs';
import {cp,chmod,mkdir,mkdtemp,readdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixedBrowserDockerArgs} from '../packages/sac-multistack/src/browser-docker.mjs';
import {decodeSyntheticBrowserOutput} from '../packages/sac-multistack/src/browser-evidence.mjs';
import {dockerChildEnvironment} from '../packages/angular-guardian/src/docker-environment.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const ui=path.join(root,'packages/sac-multistack/fixtures/ui');
const guardian=path.join(root,'packages/angular-guardian');
const seccomp=path.join(guardian,'sandbox/seccomp_profile.json');
const image=process.env.SAC_SANDBOX_IMAGE;
assert.match(image??'',/^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/);
const hash=data=>createHash('sha256').update(data).digest('hex');
const fixtures=[
 {id:'vue',file:'vue/src/App.vue',config:'vite.vue.config.mjs',
  valid:'count.value+=1;',broken:'count.value+=0;'},
 {id:'react',file:'react/src/App.tsx',config:'vite.react.config.mjs',
  valid:'setCount(v=>v+1)',broken:'setCount(v=>v)'}
];
async function artifactDigest(folder){
 const records=[];
 let bytes=0,files=0;
 async function walk(dir,depth=0){
   if(depth>24)throw Error('synthetic-output-depth');
   for(const item of (await readdir(dir,{withFileTypes:true}))
     .sort((a,b)=>a.name.localeCompare(b.name,'en'))){
     const file=path.join(dir,item.name);
     if(item.isSymbolicLink())throw Error('synthetic-output-symlink');
     if(item.isDirectory()){await walk(file,depth+1);continue;}
     const s=await stat(file);
     files++;bytes+=s.size;
     if(!s.isFile()||s.nlink!==1||files>4096||
        s.size>16*1024*1024||bytes>64*1024*1024)
       throw Error('synthetic-output-budget');
     const data=await readFile(file);
     const rel=path.relative(folder,file).split(path.sep).join('/');
     records.push([rel,hash(data)]);
   }
 }
 await walk(folder);
 if(!records.length)throw Error('synthetic-output-empty');
 return hash(JSON.stringify(records));
}
function runBuild(config){
 const cli=path.join(ui,'node_modules/.bin/vite');
 const res=spawnSync(cli,['build','--config',config],{cwd:ui,
   encoding:'utf8',timeout:90000,maxBuffer:16384,shell:false,
   env:{PATH:process.env.PATH||'/usr/bin:/bin',
     HOME:os.tmpdir(),CI:'true',NODE_ENV:'production'}});
 return !res.error&&!res.signal&&res.status===0;
}
async function runBrowser(moduleId){
 const stage=await mkdtemp(path.join(os.tmpdir(),'sac-ms-browser-'));
 const runtime=path.join(stage,'runtime'),snapshot=path.join(stage,'dist');
 const input=path.join(stage,'input.json');
 const name='sac-multistack-'+randomUUID().replaceAll('-','').slice(0,20);
 const scenario=moduleId+'-click';
 try{
   await mkdir(path.join(runtime,'src'),{recursive:true,mode:0o755});
   await mkdir(path.join(runtime,'node_modules'),{recursive:true,mode:0o755});
   await cp(path.join(root,'packages/sac-multistack/browser/entry.mjs'),
     path.join(runtime,'src/entry.mjs'));
   await cp(path.join(guardian,'src/artifact-server.mjs'),
     path.join(runtime,'src/artifact-server.mjs'));
   for(const moduleName of ['playwright','playwright-core']){
     await cp(path.join(guardian,'node_modules',moduleName),
       path.join(runtime,'node_modules',moduleName),
       {recursive:true,dereference:false});
   }
   await cp(path.join(ui,'dist',moduleId),snapshot,
     {recursive:true,dereference:false,errorOnExist:true,force:false});
   const digest=await artifactDigest(snapshot);
   await writeFile(input,JSON.stringify({digest,scenario}),{mode:0o644});
   for(const folder of [stage,runtime,path.join(runtime,'src'),
       path.join(runtime,'node_modules'),snapshot])await chmod(folder,0o755);
   const args=fixedBrowserDockerArgs({image,seccomp,runtime,dist:snapshot,
     input,name});
   const result=spawnSync('docker',args,{shell:false,
     encoding:'utf8',timeout:90000,maxBuffer:32768,
     env:dockerChildEnvironment()});
   if(result.error||result.signal||result.status!==0)
     return {status:'unverified',codes:[]};
   try{
     const verified=decodeSyntheticBrowserOutput(result.stdout,scenario,digest);
     return {status:verified.status,codes:[...verified.codes]};
   }catch{
     return {status:'unverified',codes:[]};
   }
 }catch{
   return {status:'unverified',codes:[]};
 }finally{
   spawnSync('docker',['rm','--force',name],{stdio:'ignore',timeout:10000,
     env:dockerChildEnvironment()});
   await rm(stage,{force:true,recursive:true});
 }
}
const result={schema_version:1,kind:'vue-react-synthetic-chromium-docker',
  deployment_authorized:false,sandbox:'docker-network-none',checks:[]};
let pass=true;
for(const f of fixtures){
 const file=path.join(ui,f.file);
 const source=await readFile(file,'utf8');
 assert.ok(source.includes(f.valid),'fixture-not-matched');
 let positive={status:'not-run',codes:[]};
 let negative={status:'not-run',codes:[]};
 let positiveBuild=false,negativeBuild=false;
 try{
   await rm(path.join(ui,'dist',f.id),{recursive:true,force:true});
   positiveBuild=runBuild(f.config);
   if(positiveBuild)positive=await runBrowser(f.id);
   await writeFile(file,source.replace(f.valid,f.broken));
   await rm(path.join(ui,'dist',f.id),{recursive:true,force:true});
   negativeBuild=runBuild(f.config);
   if(negativeBuild)negative=await runBrowser(f.id);
 }finally{
   await writeFile(file,source);
   await rm(path.join(ui,'dist',f.id),{recursive:true,force:true});
 }
 const approved=positiveBuild&&negativeBuild&&
   positive.status==='pass'&&negative.status==='fail'&&
   negative.codes.includes('no-observable-transition');
 result.checks.push({module_id:f.id,official_build_positive:positiveBuild?'pass':'fail',
   official_build_negative:negativeBuild?'pass':'fail',
   browser_positive:positive.status,browser_negative:negative.status,
   observed_negative:negative.codes.includes('no-observable-transition')?
     'no-observable-transition':null,
   status:approved?'pass':'fail'});
 if(!approved)pass=false;
}
process.stdout.write(JSON.stringify(result)+'\n');
if(!pass)process.exitCode=1;

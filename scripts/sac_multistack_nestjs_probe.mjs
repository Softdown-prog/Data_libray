/**
 * SAC-062 NestJS official synthetic probe.
 * One valid and one invalid TypeScript fixture, then two official Nest builds:
 * healthy HTTP on loopback and a type-correct semantic HTTP regression.
 * Only repository-owned first-party code; never executes tenant source/scripts.
 */
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,rm,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root=fileURLToPath(new URL('../packages/sac-multistack/fixtures/nestjs/',import.meta.url));
const entry=path.join(root,'src/health.controller.ts');
const output=path.join(root,'dist/main.js');
const fixtureRequire=createRequire(path.join(root,'package.json'));
const tsc=path.join(root,'node_modules/.bin/tsc');
const nest=path.join(root,'node_modules/.bin/nest');
const original=await readFile(entry,'utf8');
const valid="return {status:'ok'};";
assert.ok(original.includes(valid),'synthetic-source-marker-missing');
const run=(bin,args)=>{
 const proc=spawnSync(bin,args,{
  cwd:root,encoding:'utf8',timeout:90000,maxBuffer:16384,shell:false,
  env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:os.tmpdir(),CI:'true',NODE_ENV:'test'}
 });
 if(proc.error||proc.signal||proc.status===null)return {status:'unverified',codes:[]};
 const lines=(String(proc.stdout||'')+'\n'+String(proc.stderr||'')).slice(0,16384);
 const codes=[...new Set([...lines.matchAll(/\bTS[0-9]{4,5}\b/g)].map(x=>x[0]))].slice(0,8);
 return {status:proc.status===0?'pass':'fail',codes};
};
async function checkHttp(expected) {
 try{
  // Nest CLI writes another dist at the same path for the negative fixture.
  // CommonJS caches its previous main/controller/module even after rebuilding.
  // Evict only synthetic dist modules; never evict package dependencies.
  const distPrefix=path.join(root,'dist')+path.sep;
  for(const key of Object.keys(fixtureRequire.cache??{})){
   if(key.startsWith(distPrefix))delete fixtureRequire.cache[key];
  }
  const built=fixtureRequire(output);
  if(typeof built.createApplication!=='function')return {status:'unverified'};
  const app=await built.createApplication();
  try{
   await app.listen(0,'127.0.0.1');
   const request=fixtureRequire('supertest');
   const res=await request(app.getHttpServer()).get('/health')
     .timeout({response:5000,deadline:10000});
   const onlyStatus=res.body&&typeof res.body==='object'&&
     !Array.isArray(res.body)&&Object.keys(res.body).length===1;
   const matches=onlyStatus&&res.body.status===expected&&res.status===200;
   return {status:matches?'pass':'fail'};
  }finally{await app.close();}
 }catch{
  return {status:'unverified'};
 }
}
const summary={schema_version:1,kind:'synthetic-official-nestjs-typecheck-build-http',
 deployment_authorized:false,backend:'nestjs',loopback_only:true,checks:[]};
let positiveType={status:'not-run',codes:[]},negativeType={status:'not-run',codes:[]};
let goodBuild={status:'not-run'},badBuild={status:'not-run'};
let healthy={status:'not-run'},regressed={status:'not-run'};
try{
 positiveType=run(tsc,['--noEmit','-p','tsconfig.json']);
 await writeFile(entry,original.replace(valid,"return {status:42};"));
 negativeType=run(tsc,['--noEmit','-p','tsconfig.json']);
 await writeFile(entry,original);
 if(positiveType.status==='pass'&&negativeType.status==='fail'&&
    negativeType.codes.includes('TS2322')){
   await rm(path.join(root,'dist'),{recursive:true,force:true});
   goodBuild=run(nest,['build']);
   if(goodBuild.status==='pass'){
     try{
      if((await stat(output)).size>0)healthy=await checkHttp('ok');
      else healthy={status:'unverified'};
     }catch{healthy={status:'unverified'};}
   }
   // This regression still typechecks and builds. Only the HTTP assertion can detect it.
   await writeFile(entry,original.replace(valid,"return {status:'regressed'};"));
   const semanticType=run(tsc,['--noEmit','-p','tsconfig.json']);
   if(semanticType.status==='pass'){
     await rm(path.join(root,'dist'),{recursive:true,force:true});
     badBuild=run(nest,['build']);
     if(badBuild.status==='pass'){
       try{
        if((await stat(output)).size>0)regressed=await checkHttp('regressed');
        else regressed={status:'unverified'};
       }catch{regressed={status:'unverified'};}
     }
   }
 }
}finally{
 await writeFile(entry,original);
 await rm(path.join(root,'dist'),{recursive:true,force:true});
}
const approved=positiveType.status==='pass'&&negativeType.status==='fail'&&
 negativeType.codes.includes('TS2322')&&goodBuild.status==='pass'&&
 healthy.status==='pass'&&badBuild.status==='pass'&&regressed.status==='pass';
summary.checks.push({
 module_id:'nestjs',tools:['tsc','nest','supertest'],
 valid_typecheck:positiveType.status,invalid_typecheck:negativeType.status,
 observed_type_error:negativeType.codes.includes('TS2322')?'TS2322':null,
 official_build_positive:goodBuild.status,healthy_http:healthy.status,
 official_build_semantic_regression:badBuild.status,
 http_semantic_regression:regressed.status,
 observed_regression:regressed.status==='pass'?'http-response-mismatch':null,
 status:approved?'pass':'fail'
});
process.stdout.write(JSON.stringify(summary)+'\n');
if(!approved)process.exitCode=1;

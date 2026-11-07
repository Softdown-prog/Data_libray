// Three actual fixed Angular builds in isolated Docker, with HMAC receipts.
// No source from third-party repos; no project scripts; no deployment.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isolatedAngularBuild} from './sac_sandbox_builder.mjs';
import {prepareBuild,sealBuild,auditPipeline,compareAuthenticatedIncrementalReceipts} from '../packages/angular-pipeline/src/index.mjs';

const image=process.env.SAC_SANDBOX_IMAGE;
assert.match(image??'',/^mcr\.microsoft\.com\/playwright@sha256:[0-9a-f]{64}$/);
const workspace=fileURLToPath(new URL('../packages/angular-guardian/smoke/',import.meta.url));
const mainFile=path.join(workspace,'src/main.ts');
const modeFile=path.join(workspace,'src/mode.ts');
const original=await readFile(mainFile,'utf8');
const oldMode=await readFile(modeFile,'utf8').catch(e=>{
 if(e.code==='ENOENT')return null;throw e;
});
assert.equal(original.split('Angular runtime fixture').length,2);
const resources={workspace,dist:'dist/browser',sourceFiles:[
 'package.json','package-lock.json','angular.json','tsconfig.json',
 'src/main.ts','src/mode.ts','src/index.html','src/styles.css'
]};
const key=randomBytes(32);
const profile={schema_version:1,profile_id:'docker-incremental-rehearsal',
 angular_version:'22.0.0',capabilities:['angular','workspace','static-dist'],
 mode:'angular-only',mount:'/',
 bundle_hints:{index:'index.html',angular_host:'sac-smoke',
 angular_entrypoints:['main.js'],assets:['styles.css'],
 legacy_react_entrypoints:[]},
 rules:['SAC-PRE001','SAC-P001'].map(rule_id=>({
 rule_id,version:'1.0.0',required:true,enforcement:'blocking'
 }))};
const sha=version=>createHash('sha1')
 .update('synthetic-not-git:'+version).digest('hex');
let executed=0;
async function build(version,modify){
 if(modify){
  await writeFile(mainFile,original.replace('Angular runtime fixture',
   'Angular runtime fixture SAC_'+version+'_8F'));
  await writeFile(modeFile,"export const mode: string = 'positive';\n");
 }
 await rm(path.join(workspace,'dist'),{recursive:true,force:true});
 const args={profile,resources,key,sourceSha:sha(version)};
 const {session,report}=await prepareBuild(args);
 assert.ok(session,'preflight-must-pass:'+report?.status);
 const result=await isolatedAngularBuild({
  resources,projectName:'smoke',image,timeoutMs:120000
 });
 assert.equal(result.status,'pass',result.code);
 assert.equal(result.network,'none');
 assert.equal(result.deployment_authorized,false);
 executed++;
 const receipt=await sealBuild({...args,session,buildStatus:'pass'});
 return {args,receipt};
}
try{
 const a=await build('A',true);
 const b=await build('B',true);
 const clean=await build('B',false);
 assert.equal(executed,3);
 const old=a.receipt.data,newB=b.receipt.data,cold=clean.receipt.data;
 assert.notEqual(old.source_digest,newB.source_digest);
 assert.notEqual(old.artifact_digest,newB.artifact_digest);
 assert.equal(newB.source_digest,cold.source_digest);
 assert.equal(newB.artifact_digest,cold.artifact_digest);
 const comparison=compareAuthenticatedIncrementalReceipts({
  baseline:a.receipt,warm:b.receipt,clean:clean.receipt,key
 });
 assert.equal(comparison.status,'pass',comparison.code);
 const audited=await auditPipeline({...b.args,receipt:b.receipt,
  incremental:{baseline:a.receipt,clean:clean.receipt}});
 assert.equal(audited.status,'pass',audited.incremental?.code);
 assert.equal(audited.phases.post.status,'pass');
 assert.equal(audited.deployment_authorized,false);
 const forged=structuredClone(clean.receipt);
 forged.data.artifact_digest='f'.repeat(64);
 const rejected=await auditPipeline({...b.args,receipt:b.receipt,
  incremental:{baseline:a.receipt,clean:forged}});
 assert.equal(rejected.incremental.code,'incremental-receipt-authentication-failed');
 assert.equal(rejected.phases.post.executed,false);
 assert.equal(rejected.deployment_authorized,false);
 const report={schema_version:1,
  kind:'sac-host-generated-three-signed-isolated-angular-builds',
  fixture:'first-party-angular22',executed_docker_builds:executed,
  stages:['baseline-A','edited-B','isolated-reference-B'],
  network:'none',
  source_A_differs_B:true,artifact_A_differs_B:true,
  B_matches_reference:true,
  artifact_sha256:{A:old.artifact_digest,B:newB.artifact_digest,
   reference:cold.artifact_digest},
  receipt_code:comparison.code,postflight:audited.phases.post.status,
  forged_receipt_code:rejected.incremental.code,
  source_sha_claims_are_synthetic:true,git_commit_provenance_verified:false,
  compiler_invocation_observed_by_host:true,
  warm_cache_reuse_verified:false,cache_hit_verified:false,
  independent_physical_machine_verified:false,browser_verified:false,
  external_project_verified:false,deployment_authorized:false};
 assert.ok(JSON.stringify(report).length<4096);
 process.stdout.write(JSON.stringify(report)+'\n');
}finally{
 await writeFile(mainFile,original);
 if(oldMode===null)await rm(modeFile,{force:true});
 else await writeFile(modeFile,oldMode);
 await rm(path.join(workspace,'dist'),{recursive:true,force:true});
}

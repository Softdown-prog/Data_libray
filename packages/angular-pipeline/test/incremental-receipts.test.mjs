import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../../angular-precompiler/test/fixtures.mjs';
import {prepareBuild,sealBuild,auditPipeline,compareAuthenticatedIncrementalReceipts as check} from '../src/index.mjs';

const key=Buffer.alloc(32,17),A='a'.repeat(40),B='b'.repeat(40);
const profile={
 schema_version:1,profile_id:'incremental',angular_version:'19.3.1',
 capabilities:['angular','workspace','static-dist'],mode:'angular-only',mount:'/',
 bundle_hints:{index:'index.html',angular_host:'sample-shell',
 angular_entrypoints:['main.js'],assets:[],legacy_react_entrypoints:[]},
 rules:['SAC-PRE001','SAC-P001'].map(rule_id=>({
  rule_id,version:'1.0.0',required:true,enforcement:'blocking'
 }))
};
async function setup(t,{version='A',sha=A,profileId='incremental'}={}){
 const {workspace}=await fixture(t);
 const resources={workspace,dist:'output',sourceFiles:['package.json','package-lock.json','app.ts']};
 const args={profile:{...profile,profile_id:profileId},resources,sourceSha:sha,key};
 await writeFile(path.join(workspace,'app.ts'),"export const version='"+version+"';\n");
 await mkdir(path.join(workspace,'output'));
 await writeFile(path.join(workspace,'output','index.html'),
  '<base href="/"><sample-shell></sample-shell><script type="module" src="main.js"></script>');
 await writeFile(path.join(workspace,'output','main.js'),"window.version='"+version+"';");
 const prep=await prepareBuild(args);
 assert.ok(prep.session,'preflight');
 const receipt=await sealBuild({...args,session:prep.session,buildStatus:'pass'});
 return {...args,receipt};
}
async function revise(initial,{version='B',sha=B,updateDist=true}={}){
 const {workspace}=initial.resources;
 await writeFile(path.join(workspace,'app.ts'),"export const version='"+version+"';\n");
 if(updateDist)await writeFile(path.join(workspace,'output','main.js'),
  "window.version='"+version+"';");
 const args={profile:initial.profile,resources:initial.resources,sourceSha:sha,key};
 const prep=await prepareBuild(args);
 assert.ok(prep.session,'updated preflight');
 return {...args,receipt:await sealBuild({...args,session:prep.session,buildStatus:'pass'})};
}
async function sequence(t){
 const baseline=await setup(t),warm=await revise(baseline);
 const clean=await setup(t,{version:'B',sha:B});
 return {baseline,warm,clean};
}
const compare=s=>check({
 baseline:s.baseline.receipt,warm:s.warm.receipt,clean:s.clean.receipt,key
});

test('authenticated A vs B warm/clean receipts compare complete dist digest',async t=>{
 const s=await sequence(t);
 const proof=compare(s);
 assert.equal(proof.status,'pass');
 assert.equal(proof.receipts_authenticated,true);
 assert.equal(proof.code,'authenticated-incremental-artifacts-concordant');
 assert.equal(proof.compiler_invocation_verified,false);
 assert.equal(proof.clean_workspace_independent_verified,false);
 assert.equal(proof.cache_hit_verified,false);
 assert.equal(proof.deployment_authorized,false);
 assert.notEqual(s.baseline.receipt.data.source_digest,s.warm.receipt.data.source_digest);
 assert.equal(s.warm.receipt.data.source_digest,s.clean.receipt.data.source_digest);
 assert.equal(s.warm.receipt.data.artifact_digest,s.clean.receipt.data.artifact_digest);
 const audited=await auditPipeline({...s.warm,incremental:{
  baseline:s.baseline.receipt,clean:s.clean.receipt
 }});
 assert.equal(audited.status,'pass');
 assert.equal(audited.incremental.status,'pass');
 assert.equal(audited.phases.post.status,'pass');
 assert.equal(audited.static_pipeline_pass,true);
 assert.equal(audited.deployment_authorized,false);
 const legacy=await auditPipeline(s.warm);
 assert.equal(legacy.static_pipeline_pass,true);
 assert.equal(Object.hasOwn(legacy,'incremental'),false);
});
test('signed stale warm bundle with changed source is blocked before post',async t=>{
 const baseline=await setup(t);
 const warm=await revise(baseline,{updateDist:false});
 const clean=await setup(t,{version:'B',sha:B});
 const proof=compare({baseline,warm,clean});
 assert.equal(proof.status,'unverified');
 assert.equal(proof.code,'unchanged-artifact-after-source-change');
 const report=await auditPipeline({...warm,incremental:{
  baseline:baseline.receipt,clean:clean.receipt
 }});
 assert.equal(report.status,'unverified');
 assert.equal(report.incremental.code,'unchanged-artifact-after-source-change');
 assert.equal(report.phases.build.status,'pass');
 assert.equal(report.phases.post.executed,false);
 assert.equal(report.static_pipeline_pass,false);
});
test('signed warm/cold artifact divergence is rejected',async t=>{
 const s=await sequence(t);
 await writeFile(path.join(s.clean.resources.workspace,'output','main.js'),
  "window.version='WRONG';");
 const clean={...s.clean,receipt:await sealBuild({...s.clean,buildStatus:'pass',
  session:(await prepareBuild(s.clean)).session})};
 const proof=compare({...s,clean});
 assert.equal(proof.status,'fail');
 assert.equal(proof.code,'incremental-clean-artifact-divergence');
});
test('different signed source despite matching output is rejected',async t=>{
 const s=await sequence(t);
 const clean=await setup(t,{version:'C',sha:B});
 await writeFile(path.join(clean.resources.workspace,'output','main.js'),
  "window.version='B';");
 const p=await prepareBuild(clean);
 const receipt=await sealBuild({...clean,session:p.session,buildStatus:'pass'});
 const proof=check({baseline:s.baseline.receipt,warm:s.warm.receipt,clean:receipt,key});
 assert.equal(proof.status,'fail');
 assert.equal(proof.code,'incremental-clean-source-mismatch');
});
test('signed foreign project and reused source SHA cannot pass',async t=>{
 const s=await sequence(t);
 const foreign=await setup(t,{version:'B',sha:B,profileId:'foreign'});
 assert.equal(check({baseline:s.baseline.receipt,warm:s.warm.receipt,
  clean:foreign.receipt,key}).code,'profile-or-project-mismatch');
 const same=await revise(s.baseline,{version:'B',sha:A});
 assert.equal(check({baseline:s.baseline.receipt,warm:same.receipt,
  clean:s.clean.receipt,key}).status,'unverified');
});
test('tampered signed receipts and wrong HMAC key are rejected',async t=>{
 const s=await sequence(t);
 const forged=structuredClone(s.clean.receipt);
 forged.data.artifact_digest='e'.repeat(64);
 assert.equal(check({baseline:s.baseline.receipt,warm:s.warm.receipt,
  clean:forged,key}).code,'incremental-receipt-authentication-failed');
 assert.equal(check({baseline:s.baseline.receipt,warm:s.warm.receipt,
  clean:s.clean.receipt,key:Buffer.alloc(32,99)}).status,'fail');
 const audited=await auditPipeline({...s.warm,incremental:{
  baseline:s.baseline.receipt,clean:forged
 }});
 assert.equal(audited.static_pipeline_pass,false);
 assert.equal(audited.phases.post.executed,false);
 assert.equal(audited.incremental.status,'fail');
});
test('missing, malformed or failed signed reference never promotes',async t=>{
 const s=await sequence(t);
 for(const clean of [null,{},[],{data:{private:'SECRET'},authentication:'a'.repeat(64)}]){
  const r=check({baseline:s.baseline.receipt,warm:s.warm.receipt,clean,key});
  assert.equal(r.status,'unverified');
  assert.equal(r.receipts_authenticated,false);
  assert.equal(r.deployment_authorized,false);
  assert.doesNotMatch(JSON.stringify(r),/SECRET/);
 }
 const prep=await prepareBuild(s.clean);
 const failed=await sealBuild({...s.clean,session:prep.session,buildStatus:'fail'});
 assert.equal(check({baseline:s.baseline.receipt,warm:s.warm.receipt,
  clean:failed,key}).status,'unverified');
 const audited=await auditPipeline({...s.warm,incremental:{}});
 assert.equal(audited.static_pipeline_pass,false);
 assert.equal(audited.status,'unverified');
 assert.equal(audited.phases.post.executed,false);
});

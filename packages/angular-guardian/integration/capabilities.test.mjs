import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {fixture} from '../../angular-precompiler/test/fixtures.mjs';
import {prepareBuild,sealBuild} from '../../angular-pipeline/src/index.mjs';
import {observeSACCapabilityEvidence} from '../src/capabilities.mjs';

const makeContract=()=>({
  schema_version:1,timeout_ms:1000,
  cases:[{id:'click',path:'/',expect_visible:['h1'],
    actions:[{click:'button',expect_visible:'.ready'}]}]
});
async function setup(t){
  const {workspace}=await fixture(t);
  const resources={workspace,dist:'output',
    sourceFiles:['package.json','package-lock.json','app.ts']};
  await writeFile(path.join(workspace,'app.ts'),'// tracked synthetic source');
  const profile={
    schema_version:1,profile_id:'capability-synthetic',
    angular_version:'19.3.1',
    capabilities:['angular','workspace','static-dist'],mode:'angular-only',
    mount:'/',bundle_hints:{
      index:'index.html',angular_host:'sample-shell',
      angular_entrypoints:['main.js'],assets:[],legacy_react_entrypoints:['react.js']
    },
    rules:['SAC-PRE001','SAC-P001'].map(rule_id=>({
      rule_id,version:'1.0.0',required:true,enforcement:'blocking'
    }))
  };
  const key=Buffer.alloc(32,7),sourceSha='a'.repeat(40);
  const pipeline={profile,resources,key,sourceSha};
  const {session}=await prepareBuild(pipeline);
  assert.ok(session);
  await mkdir(path.join(workspace,resources.dist),{recursive:true});
  await writeFile(path.join(workspace,resources.dist,'index.html'),
    '<base href="/"><sample-shell></sample-shell>'+
    '<script type="module" src="main.js"></script>');
  await writeFile(path.join(workspace,resources.dist,'main.js'),'// intentionally synthetic bundle');
  pipeline.receipt=await sealBuild({...pipeline,session,buildStatus:'pass'});
  return pipeline;
}
test('real re-audited preflight, authenticated CI claim and postflight are distinct from CLI execution',async t=>{
  const pipeline=await setup(t);
  const {capabilities,result}=await observeSACCapabilityEvidence({pipeline});
  assert.equal(result.static_pipeline_pass,true);
  assert.deepEqual(capabilities.observations,{
    preflight:'observed-pass',authenticated_build_claim:'authenticated-host-claim',
    postflight:'observed-pass',guardian_contract:'unverified'
  });
  assert.deepEqual(capabilities.declared_capabilities,['angular','static-dist','workspace']);
  assert.equal(capabilities.tool_installation_verified,true);
  assert.equal(capabilities.angular_cli_execution_verified,false);
  assert.equal(capabilities.official_aot_verified,false);
  assert.equal(capabilities.deployment_authorized,false);
  assert.equal(capabilities.browser_runner,'built-in-guardian-worker');
  assert.deepEqual(capabilities,(await observeSACCapabilityEvidence({pipeline})).capabilities);
  assert.equal(JSON.stringify(capabilities).includes(pipeline.resources.workspace),false);
});
test('simulated caller runner is never promoted to verified Chromium execution',async t=>{
  const pipeline=await setup(t);
  const {capabilities,result}=await observeSACCapabilityEvidence({
    pipeline,guardian:makeContract(),
    runBrowser:async ({contract})=>({
      status:'pass',executed:true,
      cases:contract.cases.map(c=>({id:c.id,status:'pass',codes:[]}))
    })
  });
  assert.equal(result.browser_pass,true);
  assert.equal(capabilities.observations.guardian_contract,'caller-runner-claimed-pass');
  assert.equal(capabilities.browser_runner,'caller-supplied-runner');
  assert.equal(capabilities.full_runtime_verified,false);
  assert.equal(capabilities.deployment_authorized,false);
});
test('browser fail preserves independent pre/build/post evidence without allowing approval',async t=>{
  const pipeline=await setup(t);
  const {capabilities,result}=await observeSACCapabilityEvidence({
    pipeline,guardian:makeContract(),
    runBrowser:async({contract})=>({
      status:'fail',executed:true,
      cases:contract.cases.map(c=>({id:c.id,status:'fail',codes:['missing-visible']}))
    })
  });
  assert.equal(result.browser_pass,false);
  assert.equal(capabilities.observations.preflight,'observed-pass');
  assert.equal(capabilities.observations.guardian_contract,'observed-nonpass');
  assert.equal(capabilities.deployment_authorized,false);
});
test('missing or invalid receipt cannot claim build, postflight or Guardian',async t=>{
  const pipeline=await setup(t);
  const receipt=pipeline.receipt;
  pipeline.receipt=null;
  const missing=await observeSACCapabilityEvidence({pipeline,guardian:makeContract()});
  assert.equal(missing.capabilities.observations.preflight,'observed-pass');
  assert.equal(missing.capabilities.observations.authenticated_build_claim,'unverified');
  assert.equal(missing.capabilities.observations.postflight,'unverified');
  assert.equal(missing.capabilities.observations.guardian_contract,'unverified');
  pipeline.receipt=structuredClone(receipt);
  pipeline.receipt.data.build_status='fail';
  const forged=await observeSACCapabilityEvidence({pipeline,guardian:makeContract()});
  assert.equal(forged.capabilities.observations.authenticated_build_claim,'observed-nonpass');
  assert.equal(forged.capabilities.observations.guardian_contract,'unverified');
});
test('artifact mutation invalidates old attestation and cannot enable Guardian',async t=>{
  const pipeline=await setup(t);
  await rm(path.join(pipeline.resources.workspace,pipeline.resources.dist,'main.js'));
  const {capabilities,result}=await observeSACCapabilityEvidence({
    pipeline,guardian:makeContract()
  });
  assert.equal(result.static_pipeline_pass,false);
  assert.equal(capabilities.observations.authenticated_build_claim,'observed-nonpass');
  assert.equal(capabilities.observations.guardian_contract,'unverified');
  assert.equal(capabilities.deployment_authorized,false);
});
test('invalid profile produces only sanitized, non-executed unverified status',async()=>{
  const r=await observeSACCapabilityEvidence({pipeline:{profile:{token:'NEVER-LEAK'}}});
  assert.equal(r.capabilities.status,'unverified');
  assert.equal(r.capabilities.deployment_authorized,false);
  assert.equal(r.result,null);
  assert.equal(JSON.stringify(r).includes('NEVER-LEAK'),false);
});

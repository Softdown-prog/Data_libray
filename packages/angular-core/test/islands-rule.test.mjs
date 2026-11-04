import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,unlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RuleRegistry,execute,validateProfile} from '../src/index.mjs';
import {registerSACAngularIslands} from '../src/sac-p001-islands.mjs';

const contract=()=>({
  schema_version:1,index:'index.html',mount:'/dashboard/',
  host_ids:['billing-host','reports-host'],
  required_elements:[{tag:'main',id:'workspace'}],
  forbidden_tags:['legacy-app'],
  entrypoint_scripts:['ui.js'],
  allowed_resources:['ui.js','styles.css'],
  required_resources:['ui.js','styles.css'],
  required_files:[],query_policy:'none'
});
const profile=()=>({
  schema_version:1,profile_id:'islands-dash',
  angular_version:'22.2.4',
  capabilities:['angular','angular-islands'],mode:'angular-only',
  mount:'/dashboard/',bundle_hints:null,
  rules:[{rule_id:'SAC-P001-ISLAND-EXT',version:'1.0.0',
    required:true,enforcement:'blocking'}]
});
async function fixture(t){
  const dist=await mkdtemp(path.join(os.tmpdir(),'sac-core-island-'));
  t.after(()=>rm(dist,{recursive:true,force:true}));
  await writeFile(path.join(dist,'index.html'),
    '<main id="workspace"><div id="billing-host"></div><section id="reports-host"></section></main>'+
    '<script type="module" src="./ui.js"></script>'+
    '<link rel="stylesheet" href="./styles.css">');
  await writeFile(path.join(dist,'ui.js'),'export const boot=true;');
  await writeFile(path.join(dist,'styles.css'),'body{margin:0}');
  return {dist};
}
const run=(resources,p=profile())=>execute({
  registry:registerSACAngularIslands(new RuleRegistry()),profile:p,resources
});
test('profile opt-in registers a versioned post rule with pass-only static evidence',async t=>{
  const f=await fixture(t);
  const result=await run({dist:f.dist,islandContract:contract()});
  assert.equal(result.status,'unverified');
  assert.equal(result.promotion_allowed,false);
  assert.deepEqual(result.coverage,{required:1,passed:0});
  const entry=result.results[0];
  assert.equal(entry.rule_id,'SAC-P001-ISLAND-EXT');
  assert.equal(entry.version,'1.0.0');
  assert.equal(entry.phase,'post');
  assert.equal(entry.status,'unverified');
  assert.equal(entry.required,true);
  assert.equal(entry.enforcement,'blocking');
  assert.deepEqual(entry.evidence,[
    {assertion:'islands-static',status:'pass',code:'static-hosts-verified'},
    {assertion:'runtime-mount',status:'unverified',code:'runtime-not-verified'}
  ]);
  assert.deepEqual(result,await run({dist:f.dist,islandContract:contract()}));
});
test('profile prevents optional islands bypassing required runtime coverage',async t=>{
  const f=await fixture(t),base=profile();
  for(const selected of [
    {...base.rules[0],required:false},
    {...base.rules[0],enforcement:'observe'},
    {...base.rules[0],required:false,enforcement:'observe'}
  ]){
    const p={...base,rules:[selected]};
    assert.throws(()=>validateProfile(p),/blocking selection/);
    const got=await run({dist:f.dist,islandContract:contract()},p);
    assert.equal(got.promotion_allowed,false);
    assert.equal(got.status,'fail');
  }
});
test('a wrongly versioned profile or unregistered extension never runs',async t=>{
  const {dist}=await fixture(t);
  const p={...profile(),rules:[{...profile().rules[0],version:'2.0.0'}]};
  assert.equal((await run({dist,islandContract:contract()},p)).status,'fail');
  const absent=await execute({registry:new RuleRegistry(),profile:profile(),
    resources:{dist,islandContract:contract()}});
  assert.equal(absent.status,'fail');
  assert.equal(absent.promotion_allowed,false);
});
test('profile mount and contract mount mismatch fails before filesystem approval',async t=>{
  const {dist}=await fixture(t);
  const mismatch={...contract(),mount:'/other/'};
  const result=await run({dist,islandContract:mismatch});
  assert.equal(result.status,'fail');
  assert.equal(result.promotion_allowed,false);
  assert.deepEqual(result.results[0].evidence,[
    {assertion:'islands-static',status:'fail',code:'mount-mismatch'}
  ]);
});
test('missing contract/dist remain unverified, never passing coverage',async t=>{
  const {dist}=await fixture(t);
  for(const resources of [{dist},{islandContract:contract()},{}]){
    const result=await run(resources);
    assert.equal(result.status,'unverified');
    assert.equal(result.promotion_allowed,false);
    assert.equal(result.coverage.passed,0);
  }
});
test('tampered file, repeated host and untrusted script fail closed with bounded codes',async t=>{
  const {dist}=await fixture(t),f=path.join(dist,'index.html');
  await unlink(path.join(dist,'ui.js'));
  let result=await run({dist,islandContract:contract()});
  assert.equal(result.status,'fail');
  assert.equal(result.results[0].evidence[0].code,'resource-missing');
  await writeFile(path.join(dist,'ui.js'),'export const safe=true');
  await writeFile(f,
    '<main id="workspace"><div id="billing-host"></div><div id="billing-host"></div></main>'+
    '<script type="module" src="ui.js"></script>'+
    '<link rel="stylesheet" href="styles.css">');
  result=await run({dist,islandContract:contract()});
  assert.equal(result.status,'fail');
  assert.equal(result.results[0].evidence[0].code,'duplicate-dom-id');
  await writeFile(f,
    '<main id="workspace"><div id="billing-host"></div><div id="reports-host"></div></main>'+
    '<script type="module" src="https://bad.invalid/token"></script>'+
    '<link rel="stylesheet" href="styles.css">');
  result=await run({dist,islandContract:contract()});
  assert.equal(result.status,'fail');
  assert.equal(result.promotion_allowed,false);
  assert.ok(!JSON.stringify(result).includes('bad.invalid'));
});
test('missing profile capability does not run the island rule',async t=>{
  const {dist}=await fixture(t);
  const p={...profile(),capabilities:['angular']};
  const got=await run({dist,islandContract:contract()},p);
  assert.equal(got.results[0].status,'not-applicable');
  assert.equal(got.promotion_allowed,false);
});
test('non-angular applications cannot choose a passing island profile',async t=>{
  const {dist}=await fixture(t);
  const p={...profile(),mode:'non-angular',angular_version:null,
    capabilities:[],bundle_hints:null};
  const got=await run({dist,islandContract:contract()},p);
  assert.equal(got.promotion_allowed,false);
  assert.equal(got.status,'unverified');
});
test('host adapter does not use shell, network, repositories or mutation',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../src/sac-p001-islands.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/node:(child_process|https?|net|tls)|\b(fetch|eval|exec|spawn|writeFile)\s*\(/);
  assert.doesNotMatch(source,/git\s+(push|merge|checkout)|npm\s+publish/);
});

const COMMIT='db639a117024b2e14c4af844bfb69b90bef5da20';
const expectation=()=>({
  source_commit:COMMIT,entrypoint:'ui.js',
  viewports:[360,414],phases:['initial','reload'],
  reactive_host_id:'billing-host',event_name:'lhs:time-weather-updated'
});
async function browserProof(dist){
  const bytes=await (await import('node:fs/promises')).readFile(path.join(dist,'ui.js'));
  const digest=createHash('sha256').update(bytes).digest('hex');
  return {schema_version:1,source_commit:COMMIT,browser:'chromium',
    scope:'isolated-loopback-dom-events',mount:'/dashboard/',
    entrypoint:'ui.js',entrypoint_sha256:digest,
    host_ids:['billing-host','reports-host'],
    reactive_host_id:'billing-host',event_name:'lhs:time-weather-updated',
    cycles:[360,414].flatMap(viewport_width=>
      ['initial','reload'].map(phase=>({
        viewport_width,phase,host_count:2,rendered:true,
        reactive_dom_updated:true,no_page_errors:true
      })))
  };
}
test('bounded browser DOM and reactive event evidence is attached without promoting',async t=>{
  const {dist}=await fixture(t);
  const got=await run({dist,islandContract:contract(),
    islandRuntimeEvidence:await browserProof(dist),
    islandRuntimeExpectation:expectation()});
  assert.equal(got.status,'unverified');
  assert.deepEqual(got.coverage,{required:1,passed:0});
  assert.equal(got.promotion_allowed,false);
  assert.deepEqual(got.results[0].evidence,[
    {assertion:'islands-static',status:'pass',code:'static-hosts-verified'},
    {assertion:'browser-dom',status:'pass',code:'chromium-dom-event-observed'},
    {assertion:'runtime-mount',status:'unverified',code:'full-runtime-not-verified'}
  ]);
});
test('missing cycles, duplicate phases and simulated reactivity failure cannot pass',async t=>{
  const {dist}=await fixture(t);
  for(const broken of [
    proof=>proof.cycles.pop(),
    proof=>{proof.cycles[2].phase='reload';},
    proof=>{proof.cycles[0].reactive_dom_updated=false;},
    proof=>{proof.cycles[1].rendered=false;},
    proof=>{proof.cycles[3].host_count=1;},
    proof=>{proof.cycles[0].no_page_errors=false;}
  ]){
    const proof=await browserProof(dist);broken(proof);
    const got=await run({dist,islandContract:contract(),
      islandRuntimeEvidence:proof,islandRuntimeExpectation:expectation()});
    assert.equal(got.status,'fail');
    assert.equal(got.promotion_allowed,false);
    assert.equal(got.results[0].evidence[1].code,
      proof.cycles.length!==4?'runtime-proof-invalid':'runtime-cycle-invalid');
  }
});
test('forged source, module digest, host membership and browser type are rejected',async t=>{
  const {dist}=await fixture(t);
  for(const broken of [
    proof=>{proof.source_commit='f'.repeat(40);},
    proof=>{proof.entrypoint_sha256='b'.repeat(64);},
    proof=>{proof.host_ids[0]='other-host';},
    proof=>{proof.browser='not-chromium';},
    proof=>{proof.untrusted='PRIVATE-TOKEN';}
  ]){
    const proof=await browserProof(dist);broken(proof);
    const got=await run({dist,islandContract:contract(),
      islandRuntimeEvidence:proof,islandRuntimeExpectation:expectation()});
    assert.equal(got.status,'fail');
    assert.equal(got.promotion_allowed,false);
    assert.doesNotMatch(JSON.stringify(got),/PRIVATE-TOKEN/);
  }
});
test('bad independent expected source and missing expectations cannot authenticate browser claims',async t=>{
  const {dist}=await fixture(t),proof=await browserProof(dist);
  for(const value of [
    {...expectation(),source_commit:'0'.repeat(40)},
    {...expectation(),entrypoint:'unlisted.js'},
    {...expectation(),viewports:[360,360]},
    null
  ]){
    const got=await run({dist,islandContract:contract(),
      islandRuntimeEvidence:proof,islandRuntimeExpectation:value});
    assert.equal(got.status,'fail');
    assert.equal(got.promotion_allowed,false);
  }
});
test('the browser proof digest is bound to the real local module',async t=>{
  const {dist}=await fixture(t),proof=await browserProof(dist);
  await writeFile(path.join(dist,'ui.js'),'export const replaced=true;');
  const got=await run({dist,islandContract:contract(),
    islandRuntimeEvidence:proof,islandRuntimeExpectation:expectation()});
  assert.equal(got.status,'fail');
  assert.equal(got.results[0].evidence[1].code,'runtime-entry-digest-mismatch');
  assert.equal(got.promotion_allowed,false);
});


const interactionExpectation=()=>({
  source_commit:COMMIT,entrypoint:'ui.js',
  viewports:[360,414],phases:['initial','reload'],
  probes:[
    {id:'inbox-view',host_id:'billing-host',event_name:'lhs:notice-inbox-updated'},
    {id:'summary-view',host_id:'reports-host',event_name:'lhs:admin-finance-updated'}
  ]
});
async function interactionProof(dist){
  const base=await browserProof(dist);
  return {
    schema_version:1,source_commit:COMMIT,browser:'chromium',
    scope:'isolated-loopback-component-events',mount:'/dashboard/',
    entrypoint:'ui.js',entrypoint_sha256:base.entrypoint_sha256,
    probes:interactionExpectation().probes,
    cycles:[360,414].flatMap(viewport_width=>
      ['initial','reload'].map(phase=>({
        viewport_width,phase,
        probes:[{id:'inbox-view',dom_updated:true},{id:'summary-view',dom_updated:true}]
      })))
  };
}
test('two component events observed in four browser cycles never authorize promotion',async t=>{
  const {dist}=await fixture(t);
  const result=await run({
    dist,islandContract:contract(),
    islandRuntimeEvidence:await browserProof(dist),
    islandRuntimeExpectation:expectation(),
    islandInteractionEvidence:await interactionProof(dist),
    islandInteractionExpectation:interactionExpectation()
  });
  assert.equal(result.status,'unverified');
  assert.equal(result.promotion_allowed,false);
  assert.deepEqual(result.coverage,{required:1,passed:0});
  assert.deepEqual(result.results[0].evidence,[
    {assertion:'islands-static',status:'pass',code:'static-hosts-verified'},
    {assertion:'browser-dom',status:'pass',code:'chromium-dom-event-observed'},
    {assertion:'component-events',status:'pass',code:'chromium-component-events-observed'},
    {assertion:'runtime-mount',status:'unverified',code:'full-runtime-not-verified'}
  ]);
});
test('missing baseline cannot silently skip component interaction claim',async t=>{
  const {dist}=await fixture(t);
  const got=await run({dist,islandContract:contract(),
    islandInteractionEvidence:await interactionProof(dist),
    islandInteractionExpectation:interactionExpectation()});
  assert.equal(got.status,'fail');
  assert.equal(got.promotion_allowed,false);
  assert.equal(got.results[0].evidence[1].code,'interaction-baseline-missing');
});
test('missing, duplicated, tampered or false component cycles are rejected',async t=>{
  const {dist}=await fixture(t);
  for(const modify of [
    p=>p.cycles.pop(),
    p=>{p.cycles[1].phase='initial';},
    p=>{p.cycles[0].probes[0].dom_updated=false;},
    p=>{p.cycles[2].probes[1].id='not-in-contract';},
    p=>{p.probes[1].host_id='unknown-host';},
    p=>{p.entrypoint_sha256='f'.repeat(64);},
    p=>{p.source_commit='0'.repeat(40);},
    p=>{p.extraneous='secret-input-marker';}
  ]){
    const proof=await interactionProof(dist);modify(proof);
    const got=await run({dist,islandContract:contract(),
      islandRuntimeEvidence:await browserProof(dist),
      islandRuntimeExpectation:expectation(),
      islandInteractionEvidence:proof,
      islandInteractionExpectation:interactionExpectation()});
    assert.equal(got.status,'fail');
    assert.equal(got.promotion_allowed,false);
    assert.ok(!JSON.stringify(got).includes('secret-input-marker'));
  }
});
test('independent host interaction expectations cannot be forged by browser data',async t=>{
  const {dist}=await fixture(t);
  for(const exp of [
    {...interactionExpectation(),source_commit:'f'.repeat(40)},
    {...interactionExpectation(),probes:[{id:'missing',host_id:'billing-host',event_name:'lhs:any'}]},
    {...interactionExpectation(),probes:[
      interactionExpectation().probes[0],interactionExpectation().probes[0]
    ]},
    {...interactionExpectation(),entrypoint:'not-allowed.js'},
    null
  ]){
    const got=await run({dist,islandContract:contract(),
      islandRuntimeEvidence:await browserProof(dist),
      islandRuntimeExpectation:expectation(),
      islandInteractionEvidence:await interactionProof(dist),
      islandInteractionExpectation:exp});
    assert.equal(got.status,'fail');
    assert.equal(got.promotion_allowed,false);
  }
});


test('four UI probes including finance and stock navigation keep promotion blocked',async t=>{
  const {dist}=await fixture(t);
  const expected=interactionExpectation();
  const additional=[
    {id:'finance-navigation',host_id:'reports-host',
      event_name:'lhs:management-page-selected'},
    {id:'stock-navigation',host_id:'billing-host',
      event_name:'lhs:management-page-selected'}
  ];
  expected.probes.push(...additional);
  const complete=await interactionProof(dist);
  complete.probes.push(...additional);
  complete.cycles.forEach(c=>c.probes.push(
    {id:'finance-navigation',dom_updated:true},
    {id:'stock-navigation',dom_updated:true}
  ));
  const inputs={dist,islandContract:contract(),
    islandRuntimeEvidence:await browserProof(dist),
    islandRuntimeExpectation:expectation(),
    islandInteractionEvidence:complete,
    islandInteractionExpectation:expected};
  const good=await run(inputs);
  assert.equal(good.status,'unverified');
  assert.equal(good.promotion_allowed,false);
  assert.equal(good.coverage.passed,0);
  assert.deepEqual(good.results[0].evidence.map(e=>e.code),[
    'static-hosts-verified','chromium-dom-event-observed',
    'chromium-component-events-observed','full-runtime-not-verified'
  ]);
  for(const mutate of [
    p=>p.cycles[0].probes.pop(),
    p=>{p.cycles[2].probes[3].dom_updated=false;},
    p=>{p.cycles[1].probes[2].id='stock-navigation';},
    p=>{p.probes[3].event_name='lhs:admin-finance-updated';},
    p=>{p.probes[2].host_id='other-host';},
    p=>{p.cycles[3].probes.reverse();}
  ]){
    const proof=structuredClone(complete);
    mutate(proof);
    const bad=await run({...inputs,islandInteractionEvidence:proof});
    assert.equal(bad.status,'fail');
    assert.equal(bad.promotion_allowed,false);
    assert.equal(bad.results[0].evidence.find(e=>e.assertion==='component-events')?.status,'fail');
  }
});

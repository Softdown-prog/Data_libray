import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,unlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

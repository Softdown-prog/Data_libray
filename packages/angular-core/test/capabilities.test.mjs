import test from 'node:test';
import assert from 'node:assert/strict';
import {RuleRegistry,execute} from '../src/index.mjs';
import {dummy,profile,selection} from './helpers.mjs';

const angular=(capabilities=['angular','workspace'],mode='angular-only')=>({
  ...profile(),mode,angular_version:'22.0.0',capabilities,
  rules:[selection('ANGULAR-RULE')]
});
const angularRule=(when={capabilities:['angular','workspace'],modes:['angular-only'],angular_majors:[22]})=>
  dummy({rule_id:'ANGULAR-RULE',applies_when:when});
const registry=(rule=angularRule())=>new RuleRegistry().register(rule);

test('capabilities module reports only eligibility by declared profile, not Angular CLI installation',()=>{
  const report=registry().capabilities(angular());
  assert.equal(report.schema_version,1);
  assert.equal(report.kind,'sac-capabilities');
  assert.equal(report.status,'unverified');
  assert.deepEqual(report.declared_capabilities,['angular','workspace']);
  assert.deepEqual(report.selected_rules,[{
    rule_id:'ANGULAR-RULE',eligibility:'eligible-by-profile',
    reason:'profile-conditions-match',
    required_capabilities:['angular','workspace'],missing_capabilities:[]
  }]);
  assert.deepEqual(report.rule_counts,{selected:1,eligible_by_profile:1,not_applicable:0,unverified:0});
  assert.equal(report.angular_cli_execution_verified,false);
  assert.equal(report.tool_installation_verified,false);
  assert.equal(report.official_aot_verified,false);
  assert.equal(report.runtime_verified,false);
  assert.equal(report.deployment_authorized,false);
});
test('missing capability is explainable and executor agrees on not-applicable',async()=>{
  const p=angular(['angular']);
  const r=registry();
  const described=r.capabilities(p);
  assert.equal(described.selected_rules[0].eligibility,'not-applicable');
  assert.deepEqual(described.selected_rules[0].missing_capabilities,['workspace']);
  assert.equal(described.selected_rules[0].reason,'missing-declared-capability');
  const executed=await execute({registry:r,profile:p});
  assert.equal(executed.results[0].status,'not-applicable');
});
test('mode and major matching match existing Core execution semantics',async()=>{
  for(const [p,reason] of [
    [{...angular(),mode:'hybrid'},'mode-not-applicable'],
    [{...angular(),angular_version:'23.0.0'},'angular-major-not-applicable']
  ]){
    const r=registry();
    const d=r.capabilities(p);
    assert.equal(d.selected_rules[0].eligibility,'not-applicable');
    assert.equal(d.selected_rules[0].reason,reason);
    assert.equal((await execute({registry:r,profile:p})).results[0].status,'not-applicable');
  }
});
test('unknown and version-mismatched rules are unverified, never marked ready',()=>{
  const r=registry();
  const unknown={...angular(),rules:[selection('OTHER-RULE')]};
  const version={...angular(),rules:[{...selection('ANGULAR-RULE'),version:'2.0.0'}]};
  for(const [p,expected] of [
    [unknown,'rule-not-registered'],[version,'rule-version-mismatch']
  ]){
    const d=r.capabilities(p);
    assert.equal(d.selected_rules[0].eligibility,'unverified');
    assert.equal(d.selected_rules[0].reason,expected);
    assert.equal(d.rule_counts.unverified,1);
    assert.equal(d.deployment_authorized,false);
  }
});
test('profile declaration of angular-cli is not proof it exists',()=>{
  const r=registry();
  const d=r.capabilities(angular(['angular-cli','workspace','angular']));
  assert.equal(d.selected_rules[0].eligibility,'eligible-by-profile');
  assert.equal(d.angular_cli_execution_verified,false);
  assert.equal(d.tool_installation_verified,false);
  assert.equal(d.status,'unverified');
});
test('capability report is deterministic across registration and selection order',()=>{
  const A=dummy({rule_id:'A',applies_when:{capabilities:['workspace'],modes:[],angular_majors:[]}});
  const B=dummy({rule_id:'B',applies_when:{capabilities:[],modes:[],angular_majors:[]}});
  const p={...angular(['workspace','angular']),rules:[selection('B'),selection('A')]};
  const p2={...p,capabilities:p.capabilities.toReversed(),rules:p.rules.toReversed()};
  const first=new RuleRegistry().register(B).register(A).capabilities(p);
  const second=new RuleRegistry().register(A).register(B).capabilities(p2);
  assert.deepEqual(first,second);
  assert.deepEqual(first.selected_rules.map(x=>x.rule_id),['A','B']);
});
test('report excludes rule implementation, resource paths, diagnostics and arbitrary rule description',()=>{
  const secret='SECRET_DATA_NO_REPORT';
  const r=new RuleRegistry().register(dummy({
    rule_id:'ANGULAR-RULE',description:secret,
    applies_when:{capabilities:['angular'],modes:['angular-only'],angular_majors:[]},
    run:()=>{throw Error(secret);}
  }));
  const d=r.capabilities(angular(['angular']));
  assert.equal(JSON.stringify(d).includes(secret),false);
  assert.equal(d.deployment_authorized,false);
});
test('invalid profiles cannot be used to claim capabilities',()=>{
  const r=registry();
  assert.throws(()=>r.capabilities({...angular(),capabilities:['angular','angular']}),/Invalid/);
  assert.throws(()=>r.capabilities({...angular(),capabilities:['workspace']}),/Incomplete/);
});

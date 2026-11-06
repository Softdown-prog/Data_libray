import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listModules,getModule} from '../packages/sac-multistack/src/registry.mjs';
import {getCompilerStudy,listCompilerStudies} from '../packages/sac-multistack/src/compiler-study.mjs';

test('13 reviewed compiler models cover the exact current module registry',()=>{
 const registered=listModules().map(p=>p.id).sort();
 const studies=listCompilerStudies().map(s=>s.module_id).sort();
 assert.deepEqual(studies,registered);
 for(const id of registered){
  const study=getCompilerStudy(id),p=getModule(id);
  assert.equal(study.profile_family,p.family);
  assert.equal(study.source_sha_verified,false);
  assert.equal(study.evidence_verified,false);
  assert.equal(study.deployment_authorized,false);
  assert.ok(study.upstream_source.startsWith('https://github.com/'));
  assert.ok(study.official_guide.startsWith('https://'));
  assert.deepEqual(study.registered_gates.map(x=>[x.id,x.phase,x.tool]),
    p.gates.map(x=>[x.id,x.phase,x.tool]));
  assert.ok(study.registered_gates.every(x=>x.status==='not-run'));
  assert.ok(Object.isFrozen(study));
  assert.ok(Object.isFrozen(study.registered_gates));
 }
});
test('HTML, CSS and Alpine are not mislabeled compiler pipelines',()=>{
 for(const id of ['html5','css','alpinejs']){
  assert.equal(getCompilerStudy(id).compiler,null);
 }
 assert.equal(getCompilerStudy('vue').compiler,'vue-template-compiler');
 assert.match(getCompilerStudy('vue').caveat,/Vite/);
 assert.match(getCompilerStudy('nextjs').caveat,/HTTP/);
});
test('unknown tools and host-looking keys cannot modify registry',()=>{
 for(const id of ['',null,'../private','angular','rust; cat /etc/passwd']){
  assert.throws(()=>getCompilerStudy(id));
 }
 const rust=getCompilerStudy('rust');
 assert.ok(Object.isFrozen(rust.registered_gates[0]));
 assert.equal(getCompilerStudy('rust').evidence_verified,false);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,symlink,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {listModules,getModule} from '../packages/sac-multistack/src/registry.mjs';
import {inspectModule} from '../packages/sac-multistack/src/inspect.mjs';

const EXPECTED=['alpinejs','astro','cpp20','css','go','html5','javascript',
  'nestjs','nextjs','python','react','rust','vue'];
async function make(t,profile){
  const root=await mkdtemp(path.join(os.tmpdir(),'sac-multistack-test-'));
  t.after(async()=>{const {rm}=await import('node:fs/promises');
    await rm(root,{force:true,recursive:true});});
  const name='src/example'+profile.extensions[0];
  await mkdir(path.join(root,'src'));
  await writeFile(path.join(root,name),'synthetic example\n');
  for(const file of profile.required_files){
    if(file!=='package.json')await writeFile(path.join(root,file),
      file==='Cargo.toml'?'[package]\nname="synthetic"\nversion="0.1.0"\n':'module example\n');
  }
  if(profile.required_packages.length){
    const pkg=Object.fromEntries(profile.required_packages.map(id=>[id,'1.0.0']));
    await writeFile(path.join(root,'package.json'),JSON.stringify({
      name:'synthetic',private:true,dependencies:pkg,
      scripts:{build:'echo DO_NOT_EXECUTE'}
    }));
  }
  return {workspace:root,moduleId:profile.id,sourceFiles:[name]};
}
test('all thirteen modules exist once with frozen, independent gates',()=>{
  const profiles=listModules();
  assert.deepEqual(profiles.map(x=>x.id).sort(),EXPECTED);
  assert.equal(new Set(profiles.map(x=>x.id)).size,13);
  for(const p of profiles){
    assert.equal(getModule(p.id),p);
    assert.ok(Object.isFrozen(p));
    assert.ok(Object.isFrozen(p.gates));
    assert.ok(p.gates.length>=2);
    assert.ok(p.gates.every(g=>Object.isFrozen(g)));
  }
  assert.throws(()=>getModule('angular-internal'));
  assert.throws(()=>getModule('../../private'));
});
for(const p of listModules())test('preflight '+p.id+' never claims a completed build',async t=>{
  const r=await inspectModule(await make(t,p));
  assert.equal(r.module_id,p.id);
  assert.equal(r.preflight.status,'pass',JSON.stringify(r));
  assert.equal(r.status,'unverified');
  assert.equal(r.runtime_verified,false);
  assert.equal(r.source_sha_verified,false);
  assert.equal(r.deployment_authorized,false);
  assert.equal(r.gates.length,p.gates.length);
  assert.ok(r.gates.every(g=>g.status==='not-run'));
});
test('Vue, NestJS, React, Next, Astro and Alpine detect missing required packages',async t=>{
  for(const id of ['alpinejs','vue','nestjs','react','nextjs','astro']){
    await t.test(id,async t=>{
      const input=await make(t,getModule(id));
      await writeFile(path.join(input.workspace,'package.json'),
        JSON.stringify({name:'synthetic',scripts:{build:'echo unsafe'}}));
      const r=await inspectModule(input);
      assert.equal(r.status,'fail');
      assert.ok(r.preflight.findings.some(f=>f.code==='required-package-undeclared'));
      assert.equal(r.runtime_verified,false);
    });
  }
});
test('missing Rust and Go manifests fail preflight, never trigger compiler',async t=>{
  for(const id of ['rust','go']){
    await t.test(id,async t=>{
      const input=await make(t,getModule(id));
      const {rm}=await import('node:fs/promises');
      await rm(path.join(input.workspace,getModule(id).required_files[0]));
      const r=await inspectModule(input);
      assert.equal(r.preflight.status,'fail');
      assert.ok(r.preflight.findings.some(f=>f.code==='required-manifest-unavailable'));
    });
  }
});
test('unsafe paths, duplicates and excess files are rejected without probing the host',async t=>{
  const input=await make(t,getModule('python'));
  for(const names of [['../secret.py'],['src/../../secret.py'],
    ['src/.env.py'],['src/example.py','src/example.py'],
    Array(65).fill('src/check.py')]){
    await assert.rejects(()=>inspectModule({...input,sourceFiles:names}),/unsafe-sac-module-input/);
  }
});
test('source symlinks and missing files are failures with safe fixed codes',async t=>{
  const input=await make(t,getModule('python'));
  await symlink('/etc/passwd',path.join(input.workspace,'src','link.py'));
  for(const [name,expected] of [
    ['src/link.py','source-symlink-blocked'],['src/missing.py','source-file-missing']
  ]){
    const r=await inspectModule({...input,sourceFiles:[name]});
    assert.equal(r.status,'fail');
    assert.equal(r.preflight.findings[0].code,expected);
    assert.ok(!JSON.stringify(r).includes('/etc/passwd'));
  }
});
test('wrong extension is not accepted as a successful Python parse',async t=>{
  const input=await make(t,getModule('python'));
  const r=await inspectModule({...input,sourceFiles:['src/other.js']});
  assert.equal(r.status,'fail');
  assert.equal(r.preflight.findings[0].code,'source-extension-incompatible');
});
test('empty or missing workspace stays unverified, not a passing build',async t=>{
  const input=await make(t,getModule('python'));
  for(const r of [
    await inspectModule({...input,sourceFiles:[]}),
    await inspectModule({...input,workspace:'/unavailable-synthetic-workspace-s4c'})
  ]){
    assert.equal(r.status,'unverified');
    assert.equal(r.preflight.status,'unverified');
    assert.ok(r.gates.every(g=>g.status==='not-run'));
  }
});
test('malformed metadata never leaks JSON values or runs scripts',async t=>{
  const input=await make(t,getModule('react'));
  const marker=path.join(input.workspace,'DO_NOT_EXECUTE');
  await writeFile(path.join(input.workspace,'package.json'),
    '{"scripts":{"build":"touch DO_NOT_EXECUTE"},"secret":"PRIVATE_TOKEN"');
  const r=await inspectModule(input);
  assert.equal(r.status,'fail');
  assert.ok(r.preflight.findings.some(x=>x.code==='package-manifest-invalid'));
  assert.equal(JSON.stringify(r).includes('PRIVATE_TOKEN'),false);
  await assert.rejects(()=>readFile(marker),'ENOENT');
});

test('preflight-only CLI exits unverified, not success, on a valid source manifest',async t=>{
  const input=await make(t,getModule('javascript'));
  const req=path.join(input.workspace,'request.json');
  await writeFile(req,JSON.stringify({module_id:input.moduleId,
    workspace:input.workspace,source_files:input.sourceFiles}));
  const {spawnSync}=await import('node:child_process');
  const cli=new URL('../packages/sac-multistack/bin/inspect.mjs',import.meta.url);
  const child=spawnSync(process.execPath,[cli.pathname,'--request',req],{
    cwd:input.workspace,encoding:'utf8',timeout:10000});
  assert.equal(child.status,3,child.stderr);
  const result=JSON.parse(child.stdout);
  assert.equal(result.preflight.status,'pass');
  assert.equal(result.status,'unverified');
  assert.equal(result.runtime_verified,false);
});

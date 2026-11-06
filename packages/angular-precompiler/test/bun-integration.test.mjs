import test from 'node:test';
import assert from 'node:assert/strict';
import {rm,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {verifyWorkspace} from '../src/index.mjs';
import {fixture,NAMES,mutateJSON,json,metadata} from './fixtures.mjs';

const bunLock=(pkg,packages)=>({
 lockfileVersion:1,configVersion:1,
 workspaces:{'':{name:pkg.name,
  ...(pkg.dependencies?{dependencies:pkg.dependencies}:{}),
  ...(pkg.devDependencies?{devDependencies:pkg.devDependencies}:{}),
  ...(pkg.optionalDependencies?{optionalDependencies:pkg.optionalDependencies}:{})}},
 packages:Object.fromEntries(NAMES.map(name=>
  [name,[name+'@'+packages[name].version,'',{},'sha512-synthetic']]))
});
const makeBun=async(t,opts={})=>{
 const f=await fixture(t,opts);
 const pkg={name:'synthetic',dependencies:Object.fromEntries(
  NAMES.map(name=>[name,f.packages[name].version]))};
 await rm(path.join(f.workspace,'package-lock.json'));
 await json(path.join(f.workspace,'bun.lock'),bunLock(pkg,f.packages));
 return f;
};
const verify=workspace=>verifyWorkspace({workspace,angularVersion:'19.3.1'});
test('compatible Bun text lock and installed Angular toolchain are jointly verified',async t=>{
 const f=await makeBun(t);
 const report=await verify(f.workspace);
 assert.equal(report.status,'pass');
 assert.equal(report.resolution.lockfile_format,'bun-text-v1');
 assert.ok(report.evidence.some(x=>x.assertion==='lockfile-resolution'&&
  x.status==='pass'&&x.code==='bun-lock-matches-installation'));
 for(const name of NAMES)assert.equal(
  report.resolution.packages[name].locked_version,f.packages[name].version);
 assert.doesNotMatch(JSON.stringify(report),/sha512-synthetic/);
});
test('Bun lock without node_modules cannot prove installation or pass',async t=>{
 const f=await makeBun(t);
 await rm(path.join(f.workspace,'node_modules'),{recursive:true});
 const report=await verify(f.workspace);
 assert.equal(report.status,'unverified');
 assert.equal(report.resolution.lockfile_format,'bun-text-v1');
 assert.ok(report.evidence.some(x=>x.code==='installed-package-missing'));
 assert.equal(report.evidence.some(x=>x.assertion==='lockfile-resolution'&&x.status==='pass'),false);
});
test('Bun installed-version drift stays unverified',async t=>{
 const f=await makeBun(t);
 await mutateJSON(f.packagePath('typescript'),data=>{data.version='5.6.3';});
 const report=await verify(f.workspace);
 assert.equal(report.status,'unverified');
 assert.ok(report.evidence.some(x=>x.code==='bun-lock-installed-drift'));
});
test('Bun manifest dependency drift cannot be marked pass',async t=>{
 const f=await makeBun(t);
 await mutateJSON(path.join(f.workspace,'package.json'),data=>{
  data.dependencies.typescript='^5.9.0';
 });
 const report=await verify(f.workspace);
 assert.equal(report.status,'unverified');
 assert.ok(report.evidence.some(x=>x.code==='bun-lock-declaration-drift'));
});
test('nested Bun installed copy is not inferred from flattened lock entry',async t=>{
 const f=await makeBun(t);
 const nested=path.join(f.workspace,'node_modules','@angular','compiler-cli','node_modules','typescript','package.json');
 await json(nested,metadata().typescript);
 const report=await verify(f.workspace);
 assert.equal(report.status,'unverified');
 assert.ok(report.evidence.some(x=>x.code==='bun-nested-installation-unproven'));
});
test('binary Bun lock and multiple lockfiles are not silently promoted',async t=>{
 const f=await makeBun(t);
 await rm(path.join(f.workspace,'bun.lock'));
 await writeFile(path.join(f.workspace,'bun.lockb'),Buffer.from([0,255,1]));
 let report=await verify(f.workspace);
 assert.equal(report.status,'unverified');
 assert.ok(report.evidence.some(x=>x.code==='bun-binary-lock-unsupported'));
 await rm(path.join(f.workspace,'bun.lockb'));
 await json(path.join(f.workspace,'bun.lock'),bunLock(
  {name:'synthetic',dependencies:Object.fromEntries(NAMES.map(n=>[n,f.packages[n].version]))},f.packages));
 await json(path.join(f.workspace,'package-lock.json'),{lockfileVersion:3,packages:{}});
 report=await verify(f.workspace);
 assert.equal(report.status,'unverified');
 assert.ok(report.evidence.some(x=>x.code==='multiple-lockfiles-unproven'));
});
test('invalid Bun data never leaks contents or fabricates installation evidence',async t=>{
 const f=await makeBun(t);
 await writeFile(path.join(f.workspace,'bun.lock'),'{ PRIVATE_VALUE=secret');
 const r=await verify(f.workspace);
 assert.equal(r.status,'unverified');
 assert.ok(r.evidence.some(x=>x.code==='bun-lock-jsonc-invalid'));
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_VALUE|secret/);
});
test('Bun lock without a verifiable workspace does not prove monorepo members',async t=>{
 const f=await makeBun(t);
 const child=path.join(f.workspace,'apps','nested');
 await mkdir(child,{recursive:true});
 await json(path.join(child,'package.json'),{name:'nested',dependencies:{'@angular/core':'19.3.1'}});
 const r=await verifyWorkspace({workspace:f.workspace,project:'apps/nested',angularVersion:'19.3.1'});
 assert.equal(r.status,'unverified');
 assert.ok(r.evidence.some(x=>x.code==='bun-workspace-scope-unverified'));
});

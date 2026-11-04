import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {analyzeAngularComponentWiring} from '../packages/angular-precompiler/src/component-wiring.mjs';
const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const file=(path,source)=>({path,source});
const check=(...sources)=>analyzeAngularComponentWiring({
  typescript:ts,files:sources.map((s,i)=>file('src/p'+i+'.ts',s))
});
const prefix="import {Component} from '@angular/core'; ";
test('static named Angular import is observed but not treated as AOT success',()=>{
 const x=check(prefix+"import {Child} from './child'; @Component({standalone:true, imports:[Child]}) export class Page {}");
 assert.equal(x.status,'unverified');assert.equal(x.components_checked,1);assert.equal(x.component_metadata_observed,1);
 assert.deepEqual(x.findings,[]);assert.equal(x.aot_verified,false);
});
test('import type is a provable broken runtime binding',()=>{
 for(const s of ["import type {Child} from './child'", "import {type Child} from './child'"]){
  const x=check(prefix+s+"; @Component({imports:[Child]}) export class Page {}");
  assert.equal(x.status,'fail');assert.deepEqual(x.findings.map(f=>f.code),['component-import-is-type-only']);
 }
});
test('namespace decorator and local interface as import are detected',()=>{
 const x=check("import * as ng from '@angular/core'; interface Child {} @ng.Component({imports:[Child]}) export class Page {}");
 assert.equal(x.status,'fail');assert.deepEqual(x.findings.map(f=>f.code),['component-import-is-type-only']);
});
test('standalone false with imports is rejected independently of binding name',()=>{
 const x=check(prefix+'@Component({standalone:false, imports:[]}) export class Page {}');
 assert.equal(x.status,'fail');assert.deepEqual(x.findings.map(f=>f.code),['nonstandalone-component-declares-imports']);
});
test('dynamic metadata, arrays, spread and missing symbols remain unverified',()=>{
 for(const body of [
 "@Component(meta) class Page {}",
 "@Component({imports: SHARED_IMPORTS}) class Page {}",
 "@Component({imports: [forwardRef(()=>Child)]}) class Page {}",
 "@Component({imports: [Missing]}) class Page {}",
 "@Component({...custom,standalone:false,imports:[]}) class Page {}",
 "@Component({standalone: isStandalone, imports: [Missing]}) class Page {}"
 ]){
  const x=check(prefix+body);assert.equal(x.status,'unverified');assert.equal(x.components_checked,1);
  assert.equal(x.findings.length>0,true);
 }
});
test('custom non Angular Component decorator cannot produce false fail',()=>{
 const x=check('const Component=(arg)=>x=>x; @Component({standalone:false,imports:[]}) class Page {}');
 assert.equal(x.status,'unverified');assert.equal(x.components_checked,0);
});
test('report is deterministic and contains no source or secret text',()=>{
 const token='SUPER-SECRET-TOKEN-IN-CODE';
 const f=file('src/one.ts',prefix+'import type {Child} from "./child"; const token="'+token+'"; @Component({imports:[Child]}) class Page {}');
 const g=file('src/two.ts',prefix+'@Component({imports:[]}) class Else {}');
 const a=analyzeAngularComponentWiring({files:[f,g],typescript:ts});
 const b=analyzeAngularComponentWiring({files:[g,f],typescript:ts});
 assert.deepEqual(a,b);assert.ok(!JSON.stringify(a).includes(token));assert.equal(a.deployment_authorized,false);
});
test('bounded inputs reject traversal, duplications and excessive contents',()=>{
 for(const p of ['../secret.ts','src/node_modules/a.ts','/tmp/a.ts','src/x.js']){
  assert.throws(()=>analyzeAngularComponentWiring({files:[file(p,'')],typescript:ts}),/invalid-input/);
 }
 assert.throws(()=>analyzeAngularComponentWiring({files:[file('src/x.ts','x'.repeat(512*1024+1))],typescript:ts}),/invalid-input/);
 assert.throws(()=>analyzeAngularComponentWiring({files:[file('src/x.ts',''),file('src/x.ts','')],typescript:ts}),/invalid-input/);
});
test('parse problems never become an approval',()=>{
 const x=check(prefix+'@Component({imports:[Child] class Page {}');
 assert.equal(x.status,'unverified');assert.ok(x.findings.some(f=>f.code==='typescript-parse-unverified'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inspectAngularTemplateLinks} from '../packages/angular-precompiler/src/template-links.mjs';

const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const file=(path,source)=>({path,source});
const prefix="import {Component} from '@angular/core'; ";
const inspect=(files,templates=[])=>inspectAngularTemplateLinks({files,templates,typescript:ts});

test('direct templateUrl links to explicitly enumerated HTML but never passes AOT',()=>{
  const result=inspect([
    file('src/components.ts',prefix+
      "@Component({templateUrl:'./templates/menu-actions.html'}) export class MenuActions{}")
  ],[file('src/templates/menu-actions.html','<button>OK</button>')]);
  assert.equal(result.status,'unverified');
  assert.equal(result.components_checked,1);
  assert.equal(result.external_templates_linked,1);
  assert.equal(result.enumerated_html_files,1);
  assert.deepEqual(result.links,[{
    component_file:'src/components.ts',
    template_file:'src/templates/menu-actions.html',
    component_index:1
  }]);
  assert.deepEqual(result.findings,[]);
  assert.equal(result.aot_verified,false);
  assert.equal(result.deployment_authorized,false);
});

test('nested Angular component template and inline template both work',()=>{
  const result=inspect([
    file('src/site-rewrite/site-app.ts',"import { Component as NgComponent } from '@angular/core';"+
      "@NgComponent({templateUrl:'./site-app.html'}) export class SiteApp{}"),
    file('src/inline.ts',"import * as ng from '@angular/core';"+
      "@ng.Component({template:\`<p>{{1+1}}</p>\`}) class Inline{}")
  ],[file('src/site-rewrite/site-app.html','<main>ok</main>')]);
  assert.equal(result.external_templates_linked,1);
  assert.equal(result.inline_templates_observed,1);
  assert.equal(result.findings.length,0);
});

test('missing enumerated HTML never claims a verified missing physical file',()=>{
  const result=inspect([
    file('src/page.ts',prefix+"@Component({templateUrl:'./missing.html'}) class Page{}")
  ]);
  assert.equal(result.status,'unverified');
  assert.equal(result.external_templates_not_enumerated,1);
  assert.deepEqual(result.findings.map(x=>x.code),['component-template-not-enumerated']);
  assert.equal(result.angular_template_parsed,false);
});

test('dynamic, ambiguous, absent and unsupported metadata are conservative',()=>{
  const sources=[
    "@Component(meta) class Page{}",
    "@Component({templateUrl:TEMPLATE}) class Page{}",
    "@Component({templateUrl:\`./\${name}.html\`}) class Page{}",
    "@Component({templateUrl:'https://example.com/x.html'}) class Page{}",
    "@Component({templateUrl:'../../../../escape.html'}) class Page{}",
    "@Component({templateUrl:'./a.html', template:'inline'}) class Page{}",
    "@Component({ ...shared, templateUrl:'./x.html'}) class Page{}",
    "@Component({template:makeTemplate()}) class Page{}",
    "@Component({selector:'x-page'}) class Page{}"
  ];
  const seen=new Set();
  for(const source of sources) {
    const result=inspect([file('src/page.ts',prefix+source)]);
    assert.equal(result.status,'unverified');
    assert.equal(result.components_checked,1);
    assert.equal(result.findings.length,1);
    assert.equal(result.external_templates_linked,0);
    seen.add(result.findings[0].code);
  }
  assert.ok(seen.has('component-template-url-dynamic'));
  assert.ok(seen.has('component-template-ambiguous'));
  assert.ok(seen.has('component-template-path-unverified'));
});

test('custom Component decorator from other package is not assumed Angular',()=>{
  const result=inspect([
    file('src/page.ts',"import {Component} from 'another-library';"+
      "@Component({templateUrl:'./missing.html'}) class Page{}")
  ]);
  assert.equal(result.components_checked,0);
  assert.equal(result.external_templates_not_enumerated,0);
  assert.deepEqual(result.findings,[]);
});

test('invalid TS parsing stays unverified and does not attempt link',()=>{
  const result=inspect([
    file('src/page.ts',prefix+"@Component({templateUrl:'./x.html'} class Page {}")
  ],[file('src/x.html','')]);
  assert.equal(result.status,'unverified');
  assert.equal(result.components_checked,0);
  assert.deepEqual(result.findings.map(f=>f.code),['typescript-parse-unverified']);
});

test('reordering inputs gives identical summary, never leaks HTML or source strings',()=>{
  const secret='SECRET_NEVER_IN_REPORT';
  const files=[
    file('src/z.ts',prefix+"@Component({templateUrl:'./templates/z.html'}) class Z{}"),
    file('src/a.ts',prefix+"@Component({template:'"+secret+"'}) class A{}")
  ],html=[
    file('src/templates/z.html','<p>'+secret+'</p>'),
    file('src/templates/a.html','<p>'+secret+'</p>')
  ];
  const a=inspect(files,html),b=inspect([...files].reverse(),[...html].reverse());
  assert.deepEqual(a,b);
  assert.equal(JSON.stringify(a).includes(secret),false);
  assert.equal(a.deployment_authorized,false);
});

test('bounds reject path traversal, symlinks by contract and oversized sources',()=>{
  for(const p of ['../secret.ts','/tmp/a.ts','src/node_modules/a.ts','src/../../a.ts','src/x.js']){
    assert.throws(()=>inspect([file(p,'')]),/sac-template-links-invalid-input/);
  }
  for(const p of ['../secret.html','/tmp/a.html','src/node_modules/a.html','src/../../a.html','src/x.txt']){
    assert.throws(()=>inspect([file('src/x.ts','')],[file(p,'')]),/sac-template-links-invalid-input/);
  }
  assert.throws(()=>inspect([file('src/x.ts','x'.repeat(512*1024+1))]),/invalid-input/);
  assert.throws(()=>inspect([file('src/x.ts',''),file('src/x.ts','')]),/invalid-input/);
  assert.throws(()=>inspect([file('src/x.ts','')],[file('src/x.html',''),file('src/x.html','')]),/invalid-input/);
  assert.throws(()=>inspect(Array.from({length:129},(_,i)=>file('src/x'+i+'.ts',''))),/invalid-input/);
});

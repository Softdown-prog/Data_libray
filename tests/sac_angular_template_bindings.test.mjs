import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {inspectAngularTemplateBindings} from '../packages/angular-precompiler/src/template-binding-evidence.mjs';

const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const angularCompiler=await import(pathToFileURL(require.resolve('@angular/compiler')).href);
const file=(path,source)=>({path,source});
const prefix="import {Component} from '@angular/core';\n";
const inspect=(code,html)=>inspectAngularTemplateBindings({
  files:[file('src/page.ts',prefix+code)],
  templates:html===null?[]:[file('src/page.html',html)],
  typescript:ts,angularCompiler
});
const metadata="@Component({selector:'sac-page',standalone:true,templateUrl:'./page.html'}) ";

test('direct event method and property binding declarations are observed conservatively',()=>{
  const r=inspect(metadata+
    "export class Page{label='ok'; save():void{}}",
    '<button [title]="label" (click)="save()">Save</button>');
  assert.equal(r.status,'unverified');
  assert.equal(r.external_templates_parsed,1);
  assert.equal(r.bound_events_observed,1);
  assert.equal(r.bound_properties_observed,1);
  assert.equal(r.potential_event_handlers_not_declared_locally,0);
  assert.equal(r.potential_property_bindings_not_declared_locally,0);
  assert.deepEqual(r.findings,[]);
  assert.equal(r.complete_template_ast_coverage,false);
  assert.equal(r.aot_verified,false);
});
test('undeclared direct event call is a hint, never a confirmed error',()=>{
  const r=inspect(metadata+"export class Page{}",
    '<button (click)="missingMethod()">Save</button>');
  assert.equal(r.status,'unverified');
  assert.equal(r.bound_events_observed,1);
  assert.equal(r.potential_event_handlers_not_declared_locally,1);
  assert.deepEqual(r.findings.map(f=>f.code),['event-handler-member-unverified']);
});
test('undeclared root property is a hint, never a confirmed error',()=>{
  const r=inspect(metadata+"export class Page{}",
    '<input [title]="missingTitle">');
  assert.equal(r.status,'unverified');
  assert.equal(r.bound_properties_observed,1);
  assert.equal(r.potential_property_bindings_not_declared_locally,1);
  assert.deepEqual(r.findings.map(f=>f.code),['property-binding-member-unverified']);
});
test('same-file inherited event is classified separately and never granted AOT pass',()=>{
  const r=inspect('class Base{save():void{}}\n'+metadata+
    'export class Page extends Base{}',
    '<button (click)="save()">Save</button>');
  assert.equal(r.status,'unverified');
  assert.equal(r.potential_event_handlers_not_declared_locally,0);
  assert.equal(r.same_file_inherited_event_calls_observed,1);
  assert.equal(r.status,'unverified');
  assert.equal(r.deployment_authorized,false);
});
test('Angular parser syntax errors yield fixed code with no snippet',()=>{
  const secret='SECRET_INVALID_TEMPLATE';
  const r=inspect(metadata+"export class Page{label='ok'}",
    '<button [title]="label +"> '+secret+'</button>');
  assert.ok(r.template_parser_error_count>0);
  assert.deepEqual(r.findings.map(f=>f.code),['angular-template-parser-errors-observed']);
  assert.equal(r.status,'unverified');
  assert.equal(JSON.stringify(r).includes(secret),false);
});
test('event with $event and property interpolation do not require executing code',()=>{
  const r=inspect(metadata+
    'export class Page{ label="Hi"; save(event:unknown):void{} }',
    '<button (click)="save($event)" [title]="label">{{ label }}</button>');
  assert.equal(r.bound_events_observed,1);
  assert.equal(r.bound_properties_observed,1);
  assert.equal(r.interpolations_observed,1);
  assert.deepEqual(r.findings,[]);
});
test('missing HTML inventory and inline templates are not falsely parsed',()=>{
  const missing=inspect(metadata+"export class Page{}",null);
  assert.equal(missing.external_templates_parsed,0);
  assert.equal(missing.status,'unverified');
  const inline=inspect("@Component({selector:'x',standalone:true,template:'<p>Inline</p>'}) class Page{}",null);
  assert.equal(inline.inline_templates_parsed,1);
  assert.equal(inline.inline_templates_not_inspected,0);
  assert.equal(inline.external_templates_parsed,0);
  assert.equal(inline.aot_verified,false);
});
test('deterministic, redacted and input-limited by previous contract',()=>{
  const secret='TOP-SECRET-DATA-NOT-IN-REPORT';
  const files=[file('src/z.ts',prefix+metadata+'export class Page{}'),
    file('src/a.ts',prefix+"@Component({template:'"+secret+"'}) class Other{}")];
  const templates=[file('src/page.html','<button (click)="unknown()">'+secret+'</button>')];
  const a=inspectAngularTemplateBindings({files,templates,typescript:ts,angularCompiler});
  const b=inspectAngularTemplateBindings({files:[...files].reverse(),templates:[...templates].reverse(),typescript:ts,angularCompiler});
  assert.deepEqual(a,b);
  assert.equal(JSON.stringify(a).includes(secret),false);
  assert.equal(a.deployment_authorized,false);
  assert.throws(()=>inspectAngularTemplateBindings({
    files:[file('../secrets.ts','')],templates:[],typescript:ts,angularCompiler
  }),/invalid-input/);
});

test('transitive same-file inheritance records a positive syntactic ancestry observation',()=>{
  const r=inspect(
    'class Base{ save():void{}; get title():string{return "ok"} }\n'+
    'class Intermediate extends Base{}\n'+metadata+
    'export class Page extends Intermediate{}',
    '<button (click)="save()" [title]="title">Ok</button>');
  assert.equal(r.same_file_inherited_event_calls_observed,1);
  assert.equal(r.same_file_inherited_property_reads_observed,1);
  assert.equal(r.potential_event_handlers_not_declared_locally,0);
  assert.equal(r.potential_property_bindings_not_declared_locally,0);
  assert.equal(r.aot_verified,false);
});
test('imported bases and inaccessible members are not claimed as inherited',()=>{
  const external=inspect(
    "import {Base} from './base';\n"+metadata+'export class Page extends Base{}',
    '<button (click)="save()">Ok</button>');
  assert.equal(external.same_file_inherited_event_calls_observed,0);
  assert.equal(external.potential_event_handlers_not_declared_locally,1);
  const hidden=inspect(
    'class Base{private save():void{}; static action():void{}}\n'+metadata+
    'export class Page extends Base{}',
    '<button (click)="save()" [title]="action">Ok</button>');
  assert.equal(hidden.same_file_inherited_event_calls_observed,0);
  assert.equal(hidden.same_file_inherited_property_reads_observed,0);
  assert.equal(hidden.potential_event_handlers_not_declared_locally,1);
  assert.equal(hidden.potential_property_bindings_not_declared_locally,1);
});
test('Angular @for item variable is local to its loop, not a component member',()=>{
  const r=inspect(metadata+'export class Page{items=["one"]}',
    '@for (item of items; track item) { <button [title]="item">ok</button> }');
  assert.equal(r.template_local_property_reads_observed,1);
  assert.equal(r.potential_property_bindings_not_declared_locally,0);
  assert.equal(r.bound_properties_observed,1);
});
test('Angular @if alias and ng-template let variable are lexical references',()=>{
  const r=inspect(metadata+'export class Page{label="Hi"}',
    '@if (label; as alias) {<span [title]="alias">Hi</span>}'+
    '<ng-template let-current><b [title]="current">text</b></ng-template>');
  assert.equal(r.template_local_property_reads_observed,2);
  assert.equal(r.potential_property_bindings_not_declared_locally,0);
});
test('Angular @let callable is visible after declaration but not before',()=>{
  const r=inspect(metadata+'export class Page{save():void{}}',
    '<button (click)="action()">Before</button>'+
    '@let action = save;'+
    '<button (click)="action()">After</button>');
  assert.equal(r.bound_events_observed,2);
  assert.equal(r.template_local_event_calls_observed,1);
  assert.equal(r.potential_event_handlers_not_declared_locally,1);
  assert.equal(r.status,'unverified');
});
test('Angular @for lexical variable never leaks into following siblings',()=>{
  const r=inspect(metadata+'export class Page{items=["one"]}',
    '@for (item of items; track item) {<span [title]="item"></span>}'+
    '<div [title]="item"></div>');
  assert.equal(r.template_local_property_reads_observed,1);
  assert.equal(r.potential_property_bindings_not_declared_locally,1);
  assert.equal(r.status,'unverified');
});

test('inline literal component template exposes event and property evidence without execution',()=>{
  const template='<button [title]="label" (click)="save()">Save</button>';
  const r=inspect("@Component({selector:'sac-inline',standalone:true,template:"+
    JSON.stringify(template)+"}) export class Page{label='ok';save():void{}}",null);
  assert.equal(r.status,'unverified');
  assert.equal(r.inline_templates_parsed,1);
  assert.equal(r.templates_total_parsed,1);
  assert.equal(r.inline_templates_not_inspected,0);
  assert.equal(r.external_templates_parsed,0);
  assert.equal(r.bound_events_observed,1);
  assert.equal(r.bound_properties_observed,1);
  assert.deepEqual(r.findings,[]);
  assert.equal(r.aot_verified,false);
});
test('inline literal missing handler remains a hint and cannot leak source',()=>{
  const secret='INLINE_SECRET_NEVER_EXPOSED';
  const template='<button (click)="missingHandler()">'+secret+'</button>';
  const r=inspect("@Component({selector:'sac-inline',standalone:true,template:"+
    JSON.stringify(template)+"}) export class Page{}",null);
  assert.equal(r.inline_templates_parsed,1);
  assert.equal(r.potential_event_handlers_not_declared_locally,1);
  assert.deepEqual(r.findings.map(f=>f.code),['event-handler-member-unverified']);
  assert.equal(JSON.stringify(r).includes(secret),false);
  assert.equal(r.deployment_authorized,false);
});
test('malformed inline expression records parser error with no source exposure',()=>{
  const template='<span [title]="label +"></span>';
  const r=inspect("@Component({selector:'sac-inline',standalone:true,template:"+
    JSON.stringify(template)+"}) export class Page{label='ok'}",null);
  assert.equal(r.inline_templates_parsed,1);
  assert.ok(r.template_parser_error_count>0);
  assert.deepEqual(r.findings.map(f=>f.code),['angular-template-parser-errors-observed']);
  assert.equal(r.status,'unverified');
});
test('template expressions and metadata ambiguity are not mistaken for literals',()=>{
  const cases=[
    "const INLINE='<h1>Hello</h1>';@Component({selector:'sac-inline',template:INLINE}) class Page{}",
    "@Component({selector:'sac-inline',template:'Hello',templateUrl:'./page.html'}) class Page{}",
    "@Component({selector:'sac-inline',...meta,template:'Hello'}) class Page{}",
    "@Component({selector:'sac-inline',template:makeHtml()}) class Page{}"
  ];
  for(const candidate of cases){
    const r=inspect(candidate,null);
    assert.equal(r.inline_templates_parsed,0);
    assert.equal(r.templates_total_parsed,0);
    assert.equal(r.status,'unverified');
  }
});
test('multiple decorated classes link each inline text only to its own class',()=>{
  const files=[file('src/page.ts',prefix+
    "@Component({selector:'a-view',template:'<button (click)=\"save()\"></button>'}) class A{save():void{}}"+
    "@Component({selector:'b-view',template:'<button (click)=\"missing()\"></button>'}) class B{}")];
  const r=inspectAngularTemplateBindings({files,templates:[],typescript:ts,angularCompiler});
  assert.equal(r.inline_templates_parsed,2);
  assert.equal(r.bound_events_observed,2);
  assert.equal(r.potential_event_handlers_not_declared_locally,1);
  assert.deepEqual(r.findings.map(f=>({code:f.code,component_index:f.component_index})),
    [{code:'event-handler-member-unverified',component_index:2}]);
});
test('static inline detection works with Angular Component namespace and aliases',()=>{
  const files=[file('src/page.ts',
    "import * as ng from '@angular/core';"+
    "import {Component as NgComponent} from '@angular/core';"+
    "@ng.Component({selector:'x-a',template:'<p>x</p>'}) class A{}"+
    "@NgComponent({selector:'x-b',template:'<p>y</p>'}) class B{}")];
  const r=inspectAngularTemplateBindings({files,templates:[],typescript:ts,angularCompiler});
  assert.equal(r.inline_templates_parsed,2);
  assert.equal(r.templates_total_parsed,2);
});


test('simple interpolation of declared component field is observed, never certified',()=>{
  const r=inspect(metadata+"export class Page{label='safe'}",'<p>{{label}}</p>');
  assert.equal(r.interpolations_observed,1);
  assert.equal(r.simple_interpolation_reads_observed,1);
  assert.equal(r.potential_interpolation_members_not_declared_locally,0);
  assert.deepEqual(r.findings,[]);
  assert.equal(r.status,'unverified');
  assert.equal(r.aot_verified,false);
});
test('unknown direct interpolation field generates an unverified hint with no identifier leakage',()=>{
  const secret='UNIQUE_INTERPOLATION_SECRET_FIELD';
  const r=inspect(metadata+'export class Page{}','<p>{{'+secret+'}}</p>');
  assert.equal(r.simple_interpolation_reads_observed,1);
  assert.equal(r.potential_interpolation_members_not_declared_locally,1);
  assert.deepEqual(r.findings.map(f=>f.code),['interpolation-member-unverified']);
  assert.equal(JSON.stringify(r).includes(secret),false);
  assert.equal(r.deployment_authorized,false);
});
test('two simple expressions on a single BoundText node are individually observed',()=>{
  const r=inspect(metadata+'export class Page{label="ok"}',
    '<p>{{label}} {{missing}}</p>');
  assert.equal(r.interpolations_observed,1);
  assert.equal(r.simple_interpolation_reads_observed,2);
  assert.equal(r.potential_interpolation_members_not_declared_locally,1);
  assert.deepEqual(r.findings.map(f=>f.code),['interpolation-member-unverified']);
});
test('same-file inherited interpolation is observed separately from a missing field',()=>{
  const r=inspect(
    'class Base{title="safe"}\n'+metadata+'export class Page extends Base{}',
    '<p>{{title}}</p>');
  assert.equal(r.simple_interpolation_reads_observed,1);
  assert.equal(r.same_file_inherited_interpolation_reads_observed,1);
  assert.equal(r.potential_interpolation_members_not_declared_locally,0);
  assert.equal(r.aot_verified,false);
});
test('loop interpolation locals do not escape lexical view',()=>{
  const r=inspect(metadata+'export class Page{items=["safe"]}',
    '@for (item of items; track item){<p>{{item}}</p>}'+
    '<p>{{item}}</p>');
  assert.equal(r.interpolations_observed,2);
  assert.equal(r.simple_interpolation_reads_observed,2);
  assert.equal(r.template_local_interpolation_reads_observed,1);
  assert.equal(r.potential_interpolation_members_not_declared_locally,1);
  assert.equal(r.status,'unverified');
});
test('inline interpolation uses same conservative component scope and never leaks HTML',()=>{
  const secret='INLINE_INTERPOLATION_SECRET';
  const template='<p>{{'+secret+'}}</p>';
  const r=inspect("@Component({selector:'x-a',standalone:true,template:"+
    JSON.stringify(template)+"}) export class Page{}",null);
  assert.equal(r.inline_templates_parsed,1);
  assert.equal(r.simple_interpolation_reads_observed,1);
  assert.equal(r.potential_interpolation_members_not_declared_locally,1);
  assert.equal(JSON.stringify(r).includes(secret),false);
});
test('nested and piped Angular interpolation expressions are intentionally not guessed',()=>{
  const r=inspect(metadata+'export class Page{obj={name:"ok"};label="hi"}',
    '<p>{{obj.name}} {{label.toUpperCase()}} {{label | uppercase}}</p>');
  assert.equal(r.interpolations_observed,1);
  assert.equal(r.simple_interpolation_reads_observed,0);
  assert.equal(r.potential_interpolation_members_not_declared_locally,0);
  assert.deepEqual(r.findings,[]);
  assert.equal(r.complete_template_ast_coverage,false);
});

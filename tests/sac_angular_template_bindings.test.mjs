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
  assert.equal(inline.inline_templates_not_inspected,1);
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

/**
 * SAC-PRE005: fixed synthetic Angular parser versus official ngc comparison.
 * Run only inside the trusted isolated CI fixture, never on project source.
 * Raw ngc output is not emitted; only allowlisted diagnostic codes.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {inspectAngularTemplateBindings} from '../packages/angular-precompiler/src/template-binding-evidence.mjs';

const smoke=fileURLToPath(new URL('../packages/angular-postcompiler/smoke/',import.meta.url));
const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const angularCompiler=await import(pathToFileURL(require.resolve('@angular/compiler')).href);
const ngc=path.join(smoke,'node_modules','.bin','ngc');
const prefix="import {Component} from '@angular/core';\n";
const decorator="@Component({selector:'sac-page',standalone:true,templateUrl:'./page.html'}) ";
const cases=[
  {
    id:'declared-event-and-property',
    source:prefix+decorator+"export class Page{label='ready';save():void{}}",
    html:'<button [title]="label" (click)="save()">Save</button>',
    events:1,properties:1,uncertainEvent:0,uncertainProperty:0,
    parseError:false,aot:'pass',diagnostic:null
  },
  {
    id:'undeclared-event-handler',
    source:prefix+decorator+'export class Page{}',
    html:'<button (click)="missingMethod()">Save</button>',
    events:1,properties:0,uncertainEvent:1,uncertainProperty:0,
    parseError:false,aot:'fail',diagnostic:/\bTS2339\b/
  },
  {
    id:'undeclared-property-binding',
    source:prefix+decorator+'export class Page{}',
    html:'<input [title]="missingTitle">',
    events:0,properties:1,uncertainEvent:0,uncertainProperty:1,
    parseError:false,aot:'fail',diagnostic:/\bTS2339\b/
  },
  {
    id:'valid-inherited-event-handler',
    source:prefix+'class Base{save():void{}}\n'+decorator+'export class Page extends Base{}',
    html:'<button (click)="save()">Save</button>',
    events:1,properties:0,uncertainEvent:0,uncertainProperty:0,
    inheritedEvent:1,
    parseError:false,aot:'pass',diagnostic:null
  },
  {
    id:'valid-for-loop-local-property',
    source:prefix+decorator+'export class Page{items=["one"]}',
    html:'@for (item of items; track item) {<span [title]="item">x</span>}',
    events:0,properties:1,uncertainEvent:0,uncertainProperty:0,
    localProperty:1,
    parseError:false,aot:'pass',diagnostic:null
  },
  {
    id:'valid-let-local-event',
    source:prefix+decorator+'export class Page{save():void{}}',
    html:'@let action = save; <button (click)="action()">Save</button>',
    events:1,properties:0,uncertainEvent:0,uncertainProperty:0,
    localEvent:1,
    parseError:false,aot:'pass',diagnostic:null
  },
  {
    id:'for-loop-local-not-in-sibling-scope',
    source:prefix+decorator+'export class Page{items=["one"]}',
    html:'@for (item of items; track item) {<span [title]="item">x</span>}' +
      '<span [title]="item">out</span>',
    events:0,properties:2,uncertainEvent:0,uncertainProperty:1,
    localProperty:1,
    // TS2551 is an official TypeScript suggestion variant of unknown symbol
    // (e.g., "Did you mean items?"); TS2339 is also valid for this case.
    parseError:false,aot:'fail',diagnostic:/\bTS(?:2339|2551)\b/
  },
  {
    id:'malformed-property-expression',
    source:prefix+decorator+"export class Page{label='ready'}",
    html:'<span [title]="label +">Broken</span>',
    events:0,properties:0,uncertainEvent:0,uncertainProperty:0,
    parseError:true,aot:'fail',diagnostic:/\b(?:NG5002|TS-995002)\b/
  }
];
const root=await mkdtemp(path.join(smoke,'.sac-pre005-aot-'));
const results=[];
try{
  for(const [index,spec] of cases.entries()){
    const folder=path.join(root,'case-'+index);
    await mkdir(path.join(folder,'src'),{recursive:true});
    await writeFile(path.join(folder,'src/page.ts'),spec.source,{flag:'wx',mode:0o600});
    await writeFile(path.join(folder,'src/page.html'),spec.html,{flag:'wx',mode:0o600});
    const config={
      compilerOptions:{
        target:'ES2022',module:'ESNext',moduleResolution:'bundler',
        experimentalDecorators:true,strict:true,skipLibCheck:true,
        rootDir:'./src',outDir:'./out',noEmitOnError:true
      },
      angularCompilerOptions:{strictTemplates:true,compilationMode:'full'},
      files:['src/page.ts']
    };
    await writeFile(path.join(folder,'tsconfig.json'),JSON.stringify(config),{flag:'wx',mode:0o600});
    const report=inspectAngularTemplateBindings({
      files:[{path:'src/page.ts',source:spec.source}],
      templates:[{path:'src/page.html',source:spec.html}],
      typescript:ts,angularCompiler
    });
    assert.equal(report.status,'unverified','pre005-status-'+spec.id);
    assert.equal(report.bound_events_observed,spec.events,'pre005-events-'+spec.id);
    assert.equal(report.bound_properties_observed,spec.properties,'pre005-properties-'+spec.id);
    assert.equal(report.potential_event_handlers_not_declared_locally,spec.uncertainEvent,
      'pre005-uncertain-event-'+spec.id);
    assert.equal(report.potential_property_bindings_not_declared_locally,spec.uncertainProperty,
      'pre005-uncertain-property-'+spec.id);
    assert.equal(report.same_file_inherited_event_calls_observed,spec.inheritedEvent??0,
      'pre005-inherited-event-'+spec.id);
    assert.equal(report.template_local_property_reads_observed,spec.localProperty??0,
      'pre005-template-local-property-'+spec.id);
    assert.equal(report.template_local_event_calls_observed,spec.localEvent??0,
      'pre005-template-local-event-'+spec.id);
    assert.equal(report.template_parser_error_count>0,spec.parseError,'pre005-syntax-'+spec.id);
    assert.equal(report.aot_verified,false);
    assert.equal(report.deployment_authorized,false);
    const run=spawnSync(ngc,['-p',path.join(folder,'tsconfig.json')],{
      cwd:smoke,encoding:'utf8',stdio:['ignore','pipe','pipe'],
      timeout:45000,maxBuffer:512*1024,
      env:{...process.env,NG_CLI_ANALYTICS:'false',FORCE_COLOR:'0'}
    });
    const passed=run.status===0&&!run.error&&!run.signal;
    const output=(run.stdout??'')+'\n'+(run.stderr??'');
    const diagnosticMatched=spec.diagnostic===null?passed:
      !passed&&spec.diagnostic.test(output);
    if(passed!==(spec.aot==='pass')||!diagnosticMatched){
      const codes=[...new Set((output.match(/\b(?:NG\d{4,6}|TS-?\d{4,6})\b/g)??[]))].slice(0,12);
      process.stderr.write(JSON.stringify({
        case:spec.id,exit_status:run.status,spawn_error:run.error?.code??null,
        diagnostic_codes:codes
      })+'\n');
    }
    assert.equal(passed,spec.aot==='pass','pre005-aot-'+spec.id);
    assert.equal(diagnosticMatched,true,'pre005-aot-diagnostic-'+spec.id);
    results.push({
      case:spec.id,
      sac_status:report.status,
      parser_errors_observed:report.template_parser_error_count>0,
      uncertain_event_hint:report.potential_event_handlers_not_declared_locally>0,
      uncertain_property_hint:report.potential_property_bindings_not_declared_locally>0,
      aot_status:passed?'pass':'fail',
      expected_aot_diagnostic_observed:diagnosticMatched,
      deployment_authorized:false
    });
  }
}finally{
  await rm(root,{recursive:true,force:true});
}
const summary={
  schema_version:1,rule_id:'SAC-PRE005-AOT-REHEARSAL',
  scope:'fixed-official-angular-compiler-fixtures',
  cases:results,fixtures_checked:results.length,
  production_aot_verified:false,template_runtime_verified:false,
  deployment_authorized:false
};
assert.equal(results.length,cases.length);
assert.ok(JSON.stringify(summary).length<4096);
process.stdout.write(JSON.stringify(summary,null,2)+'\n');

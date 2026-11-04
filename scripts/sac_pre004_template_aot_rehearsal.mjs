/**
 * Trusted CI SAC-PRE004 template-linkage/AOT comparison.
 * Only fixed synthetic inputs, no app builds, source code execution or deploy.
 * ngc runs with the pinned official Angular/TS fixture in a disposable folder.
 * Compiler stdout/stderr never enter the report, only fixed diagnostic codes.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {inspectAngularTemplateLinks} from '../packages/angular-precompiler/src/template-links.mjs';

const smoke=fileURLToPath(new URL('../packages/angular-postcompiler/smoke/',import.meta.url));
const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const ngc=path.join(smoke,'node_modules','.bin','ngc');
const componentHeader="import {Component} from '@angular/core';\n";
const cases=[
  {
    id:'valid-external-template',source:componentHeader+
      "@Component({selector:'sac-page',standalone:true,templateUrl:'./page.html'}) export class Page{}",
    html:[{path:'src/page.html',source:'<h1>Valid Angular AOT template</h1>'}],
    expected_linked:1,expected_inline:0,expected_findings:[],
    aot:'pass',diagnostic:null
  },
  {
    id:'external-html-not-enumerated',source:componentHeader+
      "@Component({selector:'sac-page',standalone:true,templateUrl:'./missing.html'}) export class Page{}",
    html:[],expected_linked:0,expected_inline:0,
    expected_findings:['component-template-not-enumerated'],
    aot:'fail',diagnostic:/\b(?:NG2008|TS-992008)\b/
  },
  {
    id:'html-template-unknown-element',source:componentHeader+
      "@Component({selector:'sac-page',standalone:true,templateUrl:'./page.html'}) export class Page{}",
    html:[{path:'src/page.html',source:'<unknown-widget></unknown-widget>'}],
    expected_linked:1,expected_inline:0,expected_findings:[],
    aot:'fail',diagnostic:/\b(?:NG8001|TS-998001)\b/
  },
  {
    id:'html-template-missing-method',source:componentHeader+
      "@Component({selector:'sac-page',standalone:true,templateUrl:'./page.html'}) export class Page{}",
    html:[{path:'src/page.html',source:'<button (click)="missingMethod()">Go</button>'}],
    expected_linked:1,expected_inline:0,expected_findings:[],
    aot:'fail',diagnostic:/\bTS2339\b/
  },
  {
    id:'valid-inline-template',source:componentHeader+
      "@Component({selector:'sac-page',standalone:true,template:'<h1>Valid</h1>'}) export class Page{}",
    html:[],expected_linked:0,expected_inline:1,expected_findings:[],
    aot:'pass',diagnostic:null
  }
];
const root=await mkdtemp(path.join(smoke,'.sac-pre004-aot-'));
const results=[];
try{
  for(const [index,spec] of cases.entries()){
    const folder=path.join(root,'case-'+index);
    await mkdir(path.join(folder,'src'),{recursive:true});
    await writeFile(path.join(folder,'src','page.ts'),spec.source,{flag:'wx',mode:0o600});
    for(const asset of spec.html)
      await writeFile(path.join(folder,asset.path),asset.source,{flag:'wx',mode:0o600});
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
    const sac=inspectAngularTemplateLinks({
      files:[{path:'src/page.ts',source:spec.source}],
      templates:spec.html,typescript:ts
    });
    const build=spawnSync(ngc,['-p',path.join(folder,'tsconfig.json')],{
      cwd:smoke,encoding:'utf8',stdio:['ignore','pipe','pipe'],
      timeout:45000,maxBuffer:512*1024,
      env:{...process.env,NG_CLI_ANALYTICS:'false',FORCE_COLOR:'0'}
    });
    const success=build.status===0&&!build.error&&!build.signal;
    const output=(build.stdout??'')+'\n'+(build.stderr??'');
    const diagnosticMatch=spec.diagnostic===null?success:
      !success&&spec.diagnostic.test(output);
    // Only a fixed code allowlist is emitted when diagnosing fixture drift.
    if(success!==(spec.aot==='pass')||!diagnosticMatch){
      const known=[...new Set((output.match(/\b(?:NG\d{4,6}|TS-?\d{4,6})\b/g)??[]))].slice(0,12);
      process.stderr.write(JSON.stringify({case:spec.id,exit_status:build.status,
        spawn_error:build.error?.code??null,diagnostic_codes:known})+'\n');
    }
    assert.equal(sac.status,'unverified','sac-pre004-no-false-pass-'+spec.id);
    assert.equal(sac.external_templates_linked,spec.expected_linked,'sac-pre004-link-'+spec.id);
    assert.equal(sac.inline_templates_observed,spec.expected_inline,'sac-pre004-inline-'+spec.id);
    assert.deepEqual(sac.findings.map(f=>f.code),spec.expected_findings,'sac-pre004-finding-'+spec.id);
    assert.equal(success,spec.aot==='pass','sac-pre004-aot-status-'+spec.id);
    assert.equal(diagnosticMatch,true,'sac-pre004-expected-diagnostic-'+spec.id);
    assert.equal(sac.aot_verified,false);
    assert.equal(sac.deployment_authorized,false);
    results.push({
      case:spec.id,sac_status:sac.status,
      sac_external_template_link_observed:sac.external_templates_linked===1,
      sac_inline_template_observed:sac.inline_templates_observed===1,
      sac_finding_codes:sac.findings.map(f=>f.code),
      aot_status:success?'pass':'fail',
      expected_aot_diagnostic_observed:diagnosticMatch,
      template_runtime_verified:false,deployment_authorized:false
    });
  }
}finally{
  await rm(root,{recursive:true,force:true});
}
const report={
  schema_version:1,rule_id:'SAC-PRE004-AOT-REHEARSAL',
  scope:'fixed-disposable-external-html-fixtures',
  cases:results,fixtures_checked:results.length,
  static_template_compilation_verified:false,
  production_aot_verified:false,template_runtime_verified:false,
  deployment_authorized:false
};
assert.equal(results.length,cases.length);
assert.ok(JSON.stringify(report).length<4096);
process.stdout.write(JSON.stringify(report,null,2)+'\n');

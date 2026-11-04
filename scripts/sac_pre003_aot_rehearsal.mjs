/**
 * Trusted-CI-only SAC-PRE003 rehearsal against the official Angular AOT compiler.
 * Never compiles repository/project input: all 5 fixtures are fixed in this
 * versioned file and built in disposable directories under the pinned smoke
 * installation. Never prints Angular compiler logs or user-controlled source.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {analyzeAngularComponentWiring} from '../packages/angular-precompiler/src/component-wiring.mjs';

const smoke=fileURLToPath(new URL('../packages/angular-postcompiler/smoke/',import.meta.url));
const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const ngc=path.join(smoke,'node_modules','.bin','ngc');

const child = `import {Component} from '@angular/core';
@Component({selector:'sac-child',standalone:true,template:'child'})
export class Child {}`;
const cases=[
  {
    id:'valid-static-import',expectedSac:'unverified',expectedAot:'pass',
    finding:null,diagnostic:null,
    page:`import {Component} from '@angular/core';
import {Child} from './child';
@Component({selector:'sac-parent',standalone:true,imports:[Child],template:'<sac-child></sac-child>'})
export class Parent {}`
  },
  {
    id:'type-only-import',expectedSac:'fail',expectedAot:'fail',
    finding:'component-import-is-type-only',diagnostic:/\bTS1361\b/,
    page:`import {Component} from '@angular/core';
import type {Child} from './child';
@Component({selector:'sac-parent',standalone:true,imports:[Child],template:'parent'})
export class Parent {}`
  },
  {
    id:'nonstandalone-imports',expectedSac:'fail',expectedAot:'fail',
    finding:'nonstandalone-component-declares-imports',
    diagnostic:/\b(?:NG2010|TS-992010)\b/,
    page:`import {Component} from '@angular/core';
@Component({selector:'sac-parent',standalone:false,imports:[],template:'parent'})
export class Parent {}`
  },
  {
    id:'missing-binding',expectedSac:'unverified',expectedAot:'fail',
    finding:'component-import-binding-unverified',diagnostic:/\bTS2304\b/,
    page:`import {Component} from '@angular/core';
@Component({selector:'sac-parent',standalone:true,imports:[Missing],template:'parent'})
export class Parent {}`
  },
  {
    id:'const-array-metadata',expectedSac:'unverified',expectedAot:'pass',
    finding:'component-imports-dynamic',diagnostic:null,
    page:`import {Component} from '@angular/core';
import {Child} from './child';
const SHARED_IMPORTS=[Child];
@Component({selector:'sac-parent',standalone:true,imports:SHARED_IMPORTS,template:'<sac-child></sac-child>'})
export class Parent {}`
  }
];

function inspect(source) {
  return analyzeAngularComponentWiring({
    typescript:ts, files:[
      {path:'src/child.ts',source:child},
      {path:'src/page.ts',source}
    ]
  });
}
function sanitized(caseId,sac,aotPassed,diagnosticMatched){
  return {
    id:caseId,sac_status:sac.status,
    sac_findings:sac.findings.map(f=>f.code).sort(),
    aot_status:aotPassed?'pass':'fail',
    expected_diagnostic_observed:diagnosticMatched,
    aot_verified:true,
    component_runtime_verified:false,
    deployment_authorized:false
  };
}
const tempRoot=await mkdtemp(path.join(smoke,'.sac-pre003-aot-'));
const results=[];
try {
  for(const [index,spec] of cases.entries()){
    const folder=path.join(tempRoot,'case-'+index);
    await mkdir(path.join(folder,'src'),{recursive:true});
    await writeFile(path.join(folder,'src','child.ts'),child,{flag:'wx',mode:0o600});
    await writeFile(path.join(folder,'src','page.ts'),spec.page,{flag:'wx',mode:0o600});
    const config={
      compilerOptions:{
        target:'ES2022',module:'ESNext',moduleResolution:'bundler',
        experimentalDecorators:true,strict:true,skipLibCheck:true,
        outDir:'./out',noEmitOnError:true
      },
      angularCompilerOptions:{strictTemplates:true,compilationMode:'full'},
      files:['src/child.ts','src/page.ts']
    };
    await writeFile(path.join(folder,'tsconfig.json'),JSON.stringify(config),{flag:'wx',mode:0o600});
    const sac=inspect(spec.page);
    const output=spawnSync(ngc,['-p',path.join(folder,'tsconfig.json')],{
      cwd:smoke, encoding:'utf8',stdio:['ignore','pipe','pipe'],
      timeout:45000,maxBuffer:512*1024,
      env:{...process.env,NG_CLI_ANALYTICS:'false',FORCE_COLOR:'0'}
    });
    const aotPassed=output.status===0&&!output.error&&!output.signal;
    // Fixed allowlisted error fingerprints only. Never return compiler output.
    const combined=(output.stdout??'')+'\n'+(output.stderr??'');
    const diagnosticMatched=spec.diagnostic===null?aotPassed:
      !aotPassed&&spec.diagnostic.test(combined);
    results.push(sanitized(spec.id,sac,aotPassed,diagnosticMatched));
    // Keep diagnostic mismatches visible as fixed labels even if AOT fails for
    // an unrelated reason such as missing dependencies or broken toolchain.
    assert.equal(sac.status,spec.expectedSac,'sac-pre003-static-status-'+spec.id);
    assert.equal(sac.findings.some(f=>f.code===spec.finding),spec.finding!==null,
      'sac-pre003-static-finding-'+spec.id);
    assert.equal(aotPassed,spec.expectedAot==='pass','sac-pre003-aot-result-'+spec.id);
    assert.equal(diagnosticMatched,true,'sac-pre003-aot-code-'+spec.id);
    assert.equal(sac.aot_verified,false,'sac-pre003-no-static-aot-promotion');
    assert.equal(sac.deployment_authorized,false,'sac-pre003-no-deploy-promotion');
  }
} finally {
  await rm(tempRoot,{recursive:true,force:true});
}
const report={
  schema_version:1,rule_id:'SAC-PRE003-AOT-REHEARSAL',
  scope:'fixed-disposable-official-angular-compiler-fixtures',
  cases:results,
  cases_matched:results.length===cases.length,
  root_cause_verified:false,
  production_aot_verified:false,
  component_runtime_verified:false,
  deployment_authorized:false
};
assert.ok(JSON.stringify(report).length<4096);
process.stdout.write(JSON.stringify(report,null,2)+'\n');

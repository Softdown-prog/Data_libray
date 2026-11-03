import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {analyzeImportGraph} from '../packages/angular-precompiler/src/dependency-graph.mjs';

// CI installs official, pinned TypeScript in the existing Angular fixture.
const require = createRequire(new URL('../packages/angular-postcompiler/smoke/package.json', import.meta.url));
const ts = require('typescript');
const policy = {
  layers: [{name: 'ui', prefix: 'src/ui/'}, {name: 'domain', prefix: 'src/domain/'}],
  allowImports: {ui: ['ui', 'domain'], domain: ['domain']},
  external: ['@angular/', 'rxjs']
};
const file = (path, source) => ({path, source});
const check = (files, config = policy) => analyzeImportGraph({files, policy: config, typescript: ts});

test('valid layered graph, Angular package imports and .js-to-.ts resolution', () => {
  const input = [
    file('src/ui/view.ts', "import {state} from '../domain/model.js'; import {Component} from '@angular/core'; export const ui=state;"),
    file('src/domain/model.ts', 'export const state = 1;')
  ];
  const result = check(input);
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.edges, [{from:'src/ui/view.ts', to:'src/domain/model.ts', kind:'runtime'}]);
  assert.equal(result.scope, 'enumerated-typescript-sources-only');
  assert.equal(result.deployment_authorized, false);
  assert.deepEqual(check(input), result);
});

test('inverted domain import is rejected without code execution', () => {
  const result = check([
    file('src/domain/model.ts', "import '../ui/view';"),
    file('src/ui/view.ts', 'export const view = 1;')
  ]);
  assert.equal(result.status, 'fail');
  assert.ok(result.findings.some(f => f.code === 'forbidden-layer-import'));
});

test('runtime import cycle through reexports is rejected deterministically', () => {
  const result = check([
    file('src/domain/c.ts', "export {a} from './a.js';"),
    file('src/domain/b.ts', "import {c} from './c'; export const b=c;"),
    file('src/domain/a.ts', "import {b} from './b'; export const a=b;")
  ]);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.findings.find(f => f.code === 'circular-runtime-import').members,
    ['src/domain/a.ts','src/domain/b.ts','src/domain/c.ts']);
});

test('type-only cycles do not claim runtime cycles but remain visible as edges', () => {
  const result = check([
    file('src/domain/a.ts', "import type {B} from './b'; export type A={b:B};"),
    file('src/domain/b.ts', "import {type A} from './a'; export type B={a?:A};")
  ]);
  assert.equal(result.status, 'pass');
  assert.ok(result.edges.every(edge => edge.kind === 'type'));
});

test('unresolved relative and bare aliases produce unverified, not false pass', () => {
  const result = check([file('src/ui/view.ts', "import '@app/private'; import './missing';")]);
  assert.equal(result.status, 'unverified');
  assert.deepEqual(result.findings.map(f => f.code).sort(),
    ['unclassified-bare-import','unresolved-relative-import']);
});

test('dynamic expression and TypeScript parse problems are unverified', () => {
  const dynamic = check([file('src/domain/a.ts', "const x=import(getModule());")]);
  assert.equal(dynamic.status, 'unverified');
  assert.ok(dynamic.findings.some(f => f.code === 'dynamic-or-invalid-import'));
  const bad = check([file('src/domain/a.ts', 'import { from ;')]);
  assert.equal(bad.status, 'unverified');
  assert.ok(bad.findings.some(f => f.code === 'source-parse-unverified'));
});

test('folder index resolution and runtime self-cycle', () => {
  const result = check([
    file('src/domain/service.ts', "import './index';"),
    file('src/domain/index.ts', "export * from './service';")
  ]);
  assert.equal(result.status, 'fail');
  assert.equal(result.findings.find(f => f.code === 'circular-runtime-import').members.length, 2);
  const self = check([file('src/domain/one.ts', "import './one';")]);
  assert.equal(self.status, 'fail');
});

test('source scope, path validation and bounded input fail closed', () => {
  for (const name of ['../secret.ts','/tmp/x.ts','src/../../x.ts','src/node_modules/x.ts','src/file.js']) {
    assert.throws(() => check([file(name, 'export {};')]), /sac-import-graph-invalid-input/);
  }
  assert.throws(() => check([file('src/ui/a.ts','x'.repeat(512*1024+1))]), /invalid-input/);
  assert.throws(() => check(Array.from({length:129},(_,i)=>file('src/ui/'+i+'.ts',''))), /invalid-input/);
  assert.throws(() => check([file('src/ui/a.ts','')], {...policy, allowImports:{ui:['ui','missing'],domain:['domain']}}), /invalid-input/);
});

test('no logs, source code or free-form error text appear in reports', () => {
  const token = 'SUPER_PRIVATE_TOKEN_DONT_PUBLISH';
  const result = check([file('src/domain/a.ts', 'const '+token+' = 1; import \'./missing\';')]);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(result.root_cause_verified, false);
});


const trustedConfig = (compilerOptions, extra = {}) => ({
  path: 'tsconfig.json', text: JSON.stringify({compilerOptions, ...extra})
});
const checkConfig = (files, config, selectedPolicy = policy) =>
  analyzeImportGraph({files, policy: selectedPolicy, typescript: ts, tsconfig: config});

test('official TS resolver maps paths aliases to enumerated sources and detects inverted layer', () => {
  const config = trustedConfig({baseUrl: '.', paths: {'@domain/*': ['src/domain/*'], '@ui/*': ['src/ui/*']}, moduleResolution: 'bundler', module:'preserve'});
  const good = checkConfig([
    file('src/ui/view.ts', "import {state} from '@domain/model'; export const result=state;"),
    file('src/domain/model.ts', 'export const state = 1;')
  ],config);
  assert.equal(good.status, 'pass');
  assert.deepEqual(good.edges, [{from:'src/ui/view.ts',to:'src/domain/model.ts',kind:'runtime'}]);
  const bad = checkConfig([
    file('src/domain/model.ts', "import {view} from '@ui/view'; export const model=view;"),
    file('src/ui/view.ts', 'export const view=1;')
  ],config);
  assert.equal(bad.status,'fail');
  assert.ok(bad.findings.some(f => f.code==='forbidden-layer-import'));
});

test('official resolver handles alias-to-index and JSONC tsconfig with trailing commas', () => {
  const config={path:'tsconfig.json',text:[
    '{',
    ' // trusted operator enumerated this config',
    ' "compilerOptions": {',
    '  "baseUrl": ".",',
    '  "paths": {"@domain": ["src/domain/index.ts"],},',
    '  "moduleResolution": "bundler", "module": "preserve",',
    ' }',
    '}'
  ].join('\n')};
  const output=checkConfig([
    file('src/ui/view.ts',"import {value} from '@domain'; export const got=value;"),
    file('src/domain/index.ts','export const value=2;')
  ],config);
  assert.equal(output.status,'pass');
  assert.equal(output.edges[0].to,'src/domain/index.ts');
});

test('TypeScript baseUrl imports resolve via official resolver with only virtual files', () => {
  const config=trustedConfig({baseUrl:'src',moduleResolution:'bundler',module:'preserve'});
  const output=checkConfig([
    file('src/ui/view.ts',"import {value} from 'domain/model'; export const view=value;"),
    file('src/domain/model.ts','export const value=10;')
  ],config);
  assert.equal(output.status,'pass');
  assert.deepEqual(output.edges,[{from:'src/ui/view.ts',to:'src/domain/model.ts',kind:'runtime'}]);
});

test('alias cycles count runtime but not pure type-only dependencies', () => {
  const config=trustedConfig({baseUrl:'.',paths:{'@domain/*':['src/domain/*']},moduleResolution:'bundler',module:'preserve'});
  const files=[
    file('src/domain/a.ts',"import {b} from '@domain/b'; export const a=b;"),
    file('src/domain/b.ts',"export {a} from '@domain/a'; export const b=2;")
  ];
  assert.equal(checkConfig(files,config).status,'fail');
  const onlyTypes=[
    file('src/domain/a.ts',"import type {B} from '@domain/b'; export type A={b:B};"),
    file('src/domain/b.ts',"import type {A} from '@domain/a'; export type B={a:A};")
  ];
  const output=checkConfig(onlyTypes,config);
  assert.equal(output.status,'pass');
  assert.equal(output.edges.length,2);
  assert.ok(output.edges.every(edge => edge.kind==='type'));
});

test('missing alias target cannot be hidden by external allowlist', () => {
  const config=trustedConfig({baseUrl:'.',paths:{'@angular/*':['src/domain/*']},moduleResolution:'bundler',module:'preserve'});
  const output=checkConfig([file('src/ui/view.ts',"import {value} from '@angular/missing';")],config);
  assert.equal(output.status,'unverified');
  assert.ok(output.findings.some(f=>f.code==='unresolved-tsconfig-alias'));
});

test('unsupported inherited tsconfig never claims that graph is complete', () => {
  const config=trustedConfig({baseUrl:'.',paths:{'@domain/*':['src/domain/*']}},{extends:'./tsconfig.base.json'});
  const result=checkConfig([file('src/ui/view.ts','export const view=1;')],config);
  assert.equal(result.status,'unverified');
  assert.deepEqual(result.findings,[{code:'unsupported-tsconfig-inheritance'}]);
});

test('unsupported or hostile config is conservatively unverified without secrets', () => {
  for(const compilerOptions of [
    {baseUrl:'../secret'},
    {baseUrl:'.',paths:{'@secret/*':['../secret/*']}},
    {baseUrl:'.',paths:{'@app/*':['src/**']}},
    {moduleResolution:'invalid-TS-mode'},
    {rootDirs:['src','other']}
  ]){
    const result=checkConfig([file('src/ui/view.ts','export const view=1;')],trustedConfig(compilerOptions));
    assert.equal(result.status,'unverified');
    assert.equal(result.deployment_authorized,false);
  }
  const malformed={path:'tsconfig.json',text:'{"compilerOptions": {"paths": "PRIVATE_SECRET"}}'};
  assert.equal(JSON.stringify(checkConfig([file('src/ui/view.ts','')],malformed)).includes('PRIVATE_SECRET'),false);
  assert.throws(()=>checkConfig([file('src/ui/view.ts','')],{path:'../tsconfig.json',text:'{}'}),/invalid-input/);
  assert.throws(()=>checkConfig([file('src/ui/view.ts','')],{path:'tsconfig.json',text:'x'.repeat(16385)}),/invalid-input/);
});

test('relative .js TypeScript imports remain recognized with tsconfig enabled', () => {
  const config=trustedConfig({moduleResolution:'bundler',module:'preserve'});
  const output=checkConfig([
    file('src/ui/view.ts',"import {state} from '../domain/model.js'; export const view=state;"),
    file('src/domain/model.ts','export const state=1;')
  ],config);
  assert.equal(output.status,'pass');
  assert.equal(output.edges[0].to,'src/domain/model.ts');
});

test('paths work without baseUrl using tsconfig directory as the virtual root', () => {
  const config=trustedConfig({paths:{'@domain/*':['./src/domain/*']},moduleResolution:'bundler',module:'preserve'});
  const output=checkConfig([
    file('src/domain/a.ts','export const state=10;'),
    file('src/ui/main.ts',"import {state} from '@domain/a'; export const value=state;")
  ],config);
  assert.equal(output.status,'pass');
  assert.equal(output.edges[0].to,'src/domain/a.ts');
});

test('TypeScript resolves literal dynamic import via alias without running code', () => {
  const config=trustedConfig({baseUrl:'.',paths:{'@domain/*':['src/domain/*']},moduleResolution:'bundler',module:'preserve'});
  const output=checkConfig([
    file('src/ui/main.ts',"export const future=()=>import('@domain/a');"),
    file('src/domain/a.ts','export const item=1;')
  ],config);
  assert.equal(output.status,'pass');
  assert.deepEqual(output.edges,[{from:'src/ui/main.ts',to:'src/domain/a.ts',kind:'runtime'}]);
  const corrupt=checkConfig([file('src/ui/main.ts','export const value=1;')],
    {path:'tsconfig.json',text:'{malformed json PRIVATE_SECRET'});
  assert.equal(corrupt.status,'unverified');
  assert.equal(JSON.stringify(corrupt).includes('PRIVATE_SECRET'),false);
});


test('same-directory tsconfig extends inherits official TS aliases without filesystem reads', () => {
  const parent={path:'tsconfig.json',text:JSON.stringify({compilerOptions:{
    baseUrl:'.',paths:{'@domain/*':['src/domain/*']},moduleResolution:'bundler',module:'preserve'
  }})};
  const child={path:'tsconfig.app.json',text:JSON.stringify({extends:'./tsconfig.json',compilerOptions:{outDir:'./out-tsc'}}),parents:[parent]};
  const result=analyzeImportGraph({
    files:[
      file('src/ui/page.ts',"import {value} from '@domain/model'; export const page=value;"),
      file('src/domain/model.ts','export const value=3;')
    ], policy, typescript:ts, tsconfig:child
  });
  assert.equal(result.status,'pass');
  assert.deepEqual(result.edges,[{from:'src/ui/page.ts',to:'src/domain/model.ts',kind:'runtime'}]);
});

test('tsconfig extends chain honors child override and rejects stale parent aliases', () => {
  const config={path:'tsconfig.app.json',text:JSON.stringify({
    extends:'./tsconfig.mid.json',compilerOptions:{paths:{'@lib/*':['src/ui/*']}}
  }),parents:[
    {path:'tsconfig.mid.json',text:JSON.stringify({extends:'./tsconfig.json',compilerOptions:{moduleResolution:'bundler',module:'preserve'}})},
    {path:'tsconfig.json',text:JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@lib/*':['src/domain/*']}}})}
  ]};
  const output=analyzeImportGraph({
    files:[file('src/domain/main.ts',"import {x} from '@lib/view';"),file('src/ui/view.ts','export const x=1;')],
    policy,typescript:ts,tsconfig:config
  });
  assert.equal(output.status,'fail');
  assert.ok(output.findings.some(f=>f.code==='forbidden-layer-import'));
});

test('missing, cyclic, unreachable and nonlocal tsconfig inheritance fail closed', () => {
  const only=file('src/ui/app.ts','export const x=1;');
  for(const config of [
    {path:'tsconfig.app.json',text:'{"extends":"./tsconfig.json"}'},
    {path:'tsconfig.app.json',text:'{"extends":"../tsconfig.json"}'},
    {path:'tsconfig.app.json',text:'{"extends":"tsconfig.json"}',parents:[
      {path:'tsconfig.json',text:'{"extends":"./tsconfig.app.json"}'}]},
    {path:'tsconfig.app.json',text:'{}',parents:[{path:'tsconfig.json',text:'{}'}]}
  ]){
    const result=analyzeImportGraph({files:[only],typescript:ts,policy,tsconfig:config});
    assert.equal(result.status,'unverified');
    assert.ok(result.findings.some(f=>f.code==='unsupported-tsconfig-inheritance'));
  }
  assert.throws(()=>analyzeImportGraph({files:[only],typescript:ts,policy,tsconfig:{
    path:'tsconfig.app.json',text:'{}',parents:[{path:'../tsconfig.json',text:'{}'}]
  }}),/invalid-input/);
});

test('explicit JSON source and resolveJsonModule form a verified asset edge', () => {
  const cfg=trustedConfig({module:'preserve',moduleResolution:'bundler',resolveJsonModule:true});
  const result=analyzeImportGraph({
    files:[file('src/ui/page.ts',"import data from './page-data.json'; export const x=data.title;")],
    jsonAssets:[{path:'src/ui/page-data.json',source:'{"title":"ok"}'}],
    policy,typescript:ts,tsconfig:cfg
  });
  assert.equal(result.status,'pass');
  assert.deepEqual(result.edges,[]);
  assert.deepEqual(result.asset_edges,[{from:'src/ui/page.ts',to:'src/ui/page-data.json',kind:'json'}]);
  assert.equal(result.deployment_authorized,false);
});

test('JSON missing, unresolved config, invalid contents and asset pollution are not approved',()=>{
  const cfg=trustedConfig({module:'preserve',moduleResolution:'bundler',resolveJsonModule:true});
  const src=[file('src/ui/page.ts',"import info from './meta.json';")];
  const unknown=analyzeImportGraph({files:src,policy,typescript:ts,tsconfig:cfg});
  assert.equal(unknown.status,'unverified');
  assert.ok(unknown.findings.some(f=>f.code==='unresolved-relative-import'));
  const disabled=analyzeImportGraph({
    files:src,policy,typescript:ts,tsconfig:trustedConfig({module:'preserve',moduleResolution:'bundler'}),
    jsonAssets:[{path:'src/ui/meta.json',source:'{"ok":true}'}]
  });
  assert.equal(disabled.status,'unverified');
  assert.ok(disabled.findings.some(f=>f.code==='json-module-not-enabled'));
  for(const bad of [
    {path:'src/ui/meta.json',source:'{not json}'},
    {path:'src/ui/../../private.json',source:'{}'},
    {path:'src/node_modules/x.json',source:'{}'},
    {path:'src/ui/meta.json',source:'"secret"'.repeat(33000)}
  ]) assert.throws(()=>analyzeImportGraph({
    files:src,policy,typescript:ts,tsconfig:cfg,jsonAssets:[bad]
  }),/invalid-input/);
});

test('generated source manifest describes missing output without inventing code or marking pass',()=>{
  const cfg=trustedConfig({module:'preserve',moduleResolution:'bundler'});
  const files=[file('src/ui/page.ts',"import {runtime} from './runtime-config';")];
  const result=analyzeImportGraph({
    files,policy,typescript:ts,tsconfig:cfg,
    generatedFiles:[{path:'src/ui/runtime-config.ts',generator:'scripts/write-runtime-config.mjs'}]
  });
  assert.equal(result.status,'unverified');
  assert.ok(result.findings.some(f=>f.code==='generated-source-not-captured'));
  assert.equal(result.root_cause_verified,false);
  const actual=analyzeImportGraph({
    files:[...files,file('src/ui/runtime-config.ts','export const runtime = 1;')],
    policy,typescript:ts,tsconfig:cfg
  });
  assert.equal(actual.status,'pass');
  assert.throws(()=>analyzeImportGraph({files,policy,typescript:ts,tsconfig:cfg,
    generatedFiles:[{path:'src/ui/runtime-config.ts',generator:'../../bad.mjs'}]
  }),/invalid-input/);
});

test('deep external imports require explicit operator prefix, not a broad package claim',()=>{
  const files=[file('src/ui/page.ts',"import * as Phaser from 'phaser/dist/phaser.esm.js';")];
  const cfg=trustedConfig({module:'preserve',moduleResolution:'bundler'});
  const broad=analyzeImportGraph({files,policy:{...policy,external:['phaser']},typescript:ts,tsconfig:cfg});
  assert.equal(broad.status,'unverified');
  const explicit=analyzeImportGraph({files,policy:{...policy,external:['phaser/']},typescript:ts,tsconfig:cfg});
  assert.equal(explicit.status,'pass');
});

test('inherited resolveJsonModule is honored, malformed configs leak no source contents',()=>{
  const cfg={path:'tsconfig.site.json',text:JSON.stringify({extends:'./tsconfig.json',compilerOptions:{resolveJsonModule:true}}),
    parents:[{path:'tsconfig.json',text:JSON.stringify({compilerOptions:{module:'preserve',moduleResolution:'bundler'}})}]};
  const result=analyzeImportGraph({
    files:[file('src/ui/app.ts',"import data from './x.json';")],
    policy,typescript:ts,tsconfig:cfg,
    jsonAssets:[{path:'src/ui/x.json',source:'{"SECRET":"DO_NOT_PRINT_PRIVATE"}'}]
  });
  assert.equal(result.status,'pass');
  assert.equal(JSON.stringify(result).includes('DO_NOT_PRINT_PRIVATE'),false);
});

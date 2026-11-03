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

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBunTextLock} from '../src/bun-lock.mjs';
const manifest={name:'angular-realworld',dependencies:{'@angular/core':'21.2.12',
 '@angular/compiler':'21.2.12'},devDependencies:{'@angular/compiler-cli':'21.2.12',
 'typescript':'~5.9.3'}};
const lock=[
 '{',
 ' // comment,',
 ' "lockfileVersion":1,',
 ' "configVersion":1,',
 ' "workspaces":{"":{"name":"angular-realworld",',
 '  "dependencies":{"@angular/core":"21.2.12","@angular/compiler":"21.2.12",},',
 '  "devDependencies":{"@angular/compiler-cli":"21.2.12","typescript":"~5.9.3",},',
 ' },},',
 ' "packages":{',
 '  "@angular/core":["@angular/core@21.2.12","",{},"sha512-OK"],',
 '  "@angular/compiler":["@angular/compiler@21.2.12","",{},"sha512-OK"],',
 '  "@angular/compiler-cli":["@angular/compiler-cli@21.2.12","",{},"sha512-OK"],',
 '  "typescript":["typescript@5.9.3","",{},"sha512-OK"],',
 '  "demo":["demo@1.0.0","https://example.invalid/a//b",{},],',
 ' },',
 '}'
].join('\n');
test('Bun v1 JSONC root parses comments and trailing commas',()=>{
 const r=parseBunTextLock(lock,{manifest});
 assert.equal(r.status,'parsed');
 assert.equal(r.lookup('@angular/core'),'21.2.12');
 assert.equal(r.lookup('typescript'),'5.9.3');
 assert.equal(r.lookup('missing'),null);
 assert.equal(Object.isFrozen(r),true);
 assert.doesNotMatch(JSON.stringify(r),/example.invalid|sha512/);
});
test('Bun declaration drift is unverified',()=>{
 const bad=structuredClone(manifest);
 bad.dependencies['@angular/core']='21.2.11';
 assert.equal(parseBunTextLock(lock,{manifest:bad}).code,'bun-lock-declaration-drift');
});
test('unsupported formats and scope never pass',()=>{
 for(const [raw,options] of [
  ['{"lockfileVersion":2,"packages":{},"workspaces":{}}',{}],
  ['{"lockfileVersion":1,"packages":{},"workspaces":{"":{}}}',{}],
  ['{"lockfileVersion":1, /* unclosed',{}],
  [lock,{workspace:'apps/app'}],
  [lock,{manifest:{name:'different'}}]
 ]){
  assert.equal(parseBunTextLock(raw,{manifest,...options}).status,'unverified');
 }
});
test('local or alias resolution not asserted as a registry version',()=>{
 const r=parseBunTextLock(lock.replace('typescript@5.9.3','typescript@file:../local'),{manifest});
 assert.equal(r.status,'parsed');
 assert.equal(r.lookup('typescript'),null);
});
test('size bound and secret JSON never returned',()=>{
 assert.equal(parseBunTextLock('z'.repeat(4*1024*1024+1),{manifest}).status,'unverified');
 const r=parseBunTextLock(lock.replace('21.2.12','PRIVATE_TOKEN'),{manifest});
 assert.equal(r.status,'unverified');
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_TOKEN/);
});

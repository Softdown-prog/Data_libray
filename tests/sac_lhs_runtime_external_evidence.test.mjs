import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inspectLhsRuntimeImports} from '../packages/angular-precompiler/src/runtime-external-evidence.mjs';

const require = createRequire(new URL('../packages/angular-postcompiler/smoke/package.json', import.meta.url));
const ts = require('typescript');
const fixture = () => ({
  typescript: ts,
  sources: {
    canvas: "const gameUrl=new URL('./js/main.js',document.baseURI); await import(/* @vite-ignore */ gameUrl.href);",
    account: "const modulePath='/game/js/sim/saveTransfer.js'; await import(/* @vite-ignore */ modulePath);"
  },
  bundles: {
    game: [{path:'main.js',source:"const gameUrl=new URL('./js/main.js',document.baseURI); await import(gameUrl.href);"}],
    site: [{path:'main-X1Y2Z3.js',source:"const p='/game/js/sim/saveTransfer.js'; await import(p);"}]
  },
  assets: {
    gameIndex:'<script type="module" src="./__angular/main.js"></script>',
    nativeCanvas:'export const run = () => 1;',
    nativeSave:'export function parseImportedSave(data){return data;}'
  }
});

test('bounded evidence observes native targets and emitted Angular dynamic imports',()=>{
  const result=inspectLhsRuntimeImports(fixture());
  assert.equal(result.status,'unverified');
  assert.equal(result.emitted_artifacts_consistent,true);
  assert.equal(result.entries.length,2);
  assert.ok(result.entries.every(e=>e.artifact_link_evidence));
  assert.equal(result.runtime_execution_verified,false);
  assert.equal(result.deployment_authorized,false);
  assert.equal(result.entries[0].target_sha256.length,64);
});

test('missing emitted dynamic call cannot be treated as an architectural pass',()=>{
  const f=fixture();
  f.bundles.site[0].source="const p='/game/js/sim/saveTransfer.js';";
  const result=inspectLhsRuntimeImports(f);
  assert.equal(result.status,'unverified');
  assert.equal(result.emitted_artifacts_consistent,false);
  assert.equal(result.entries[1].bundle_dynamic_import_observed,false);
});

test('missing compiled target is explicit even when bundle still references it',()=>{
  const f=fixture();
  f.assets.nativeCanvas='';
  const result=inspectLhsRuntimeImports(f);
  assert.equal(result.status,'unverified');
  assert.equal(result.entries[0].target_file_present,false);
  assert.equal(result.entries[0].target_sha256,null);
});

test('unexpected source expression is not silently approved',()=>{
  const f=fixture();
  f.sources.account=f.sources.account.replace('import(/* @vite-ignore */ modulePath)','import(otherPath)');
  const result=inspectLhsRuntimeImports(f);
  assert.equal(result.status,'unverified');
  assert.equal(result.entries[1].source_dynamic_import_observed,false);
});

test('missing Angular bootstrap is not a verified artifact link',()=>{
  const f=fixture();
  f.assets.gameIndex='<script type="module" src="js/react-entry.js"></script>';
  const result=inspectLhsRuntimeImports(f);
  assert.equal(result.emitted_artifacts_consistent,false);
  assert.equal(result.angular_bootstrap_observed,false);
});

test('reject malicious path, excessive input and missing trust prerequisites',()=>{
  const f=fixture();
  f.bundles.site[0].path='../private.js';
  assert.throws(()=>inspectLhsRuntimeImports(f),/sac-external-runtime-invalid-input/);
  f.bundles.site[0].path='main.js';
  f.bundles.site[0].source='x'.repeat(3*1024*1024+1);
  assert.throws(()=>inspectLhsRuntimeImports(f),/sac-external-runtime-invalid-input/);
  const valid=fixture();
  valid.typescript=null;
  assert.throws(()=>inspectLhsRuntimeImports(valid),/sac-external-runtime-invalid-input/);
});

test('report exposes only hashes, fixed paths and boolean evidence',()=>{
  const f=fixture();
  const secret='do-not-leak-private-build-code';
  f.assets.nativeSave=secret;
  const output=JSON.stringify(inspectLhsRuntimeImports(f));
  assert.equal(output.includes(secret),false);
  assert.equal(output.includes('export function parseImportedSave'),false);
});

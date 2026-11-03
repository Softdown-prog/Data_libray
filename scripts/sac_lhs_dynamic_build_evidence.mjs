/**
 * Pinned LHS: inspect external runtime import references in built Angular bundles
 * and native game assets. No game code runs and no deployment occurs.
 * This CI probe reports artifact consistency but never certifies browser runtime.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {lstat,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectLhsRuntimeImports} from '../packages/angular-precompiler/src/runtime-external-evidence.mjs';

const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repo=path.join(root,'.sac-snapshots','lhs');
const project=path.join(repo,'games','lan_house_simulator');
const angular=path.join(project,'frontend-angular');
const output=path.join(project,'out','site-clean-angular');
const pinned='db639a117024b2e14c4af844bfb69b90bef5da20';
const MAX_FILE=3*1024*1024;
const allowedRelative = x => typeof x==='string' && x.length<=160 &&
  /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(x) &&
  !x.split('/').some(part=>part==='.'||part==='..');
async function readBounded(base,relative){
  assert.ok(allowedRelative(relative),'sac-invalid-asset-path');
  const abs=path.join(base,relative);
  assert.ok(abs.startsWith(base+path.sep),'sac-outside-root');
  const info=await lstat(abs);
  assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.size<=MAX_FILE,'sac-asset-not-regular-or-too-large');
  return readFile(abs,'utf8');
}
async function readJsBundles(base){
  const entries=await readdir(base,{withFileTypes:true});
  assert.ok(entries.length<=96,'sac-too-many-asset-entries');
  const js=entries.filter(x=>x.name.endsWith('.js'));
  assert.ok(js.length>0&&js.length<=64,'sac-invalid-bundle-count');
  return Promise.all(js.map(async x=>{
    assert.ok(x.isFile()&&!x.isSymbolicLink(),'sac-invalid-js-asset');
    return {path:x.name,source:await readBounded(base,x.name)};
  }));
}
const head=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8',timeout:5000}).trim();
assert.equal(head,pinned,'sac-unexpected-lhs-snapshot');
const gameBundles=await readJsBundles(path.join(output,'game','__angular'));
const siteBundles=await readJsBundles(path.join(output,'assets','site'));
const result=inspectLhsRuntimeImports({
  typescript:ts,
  sources:{
    canvas:await readBounded(angular,'src/main.ts'),
    account:await readBounded(angular,'src/site-rewrite/account.ts')
  },
  bundles:{game:gameBundles,site:siteBundles},
  assets:{
    gameIndex:await readBounded(output,'game/index.html'),
    nativeCanvas:await readBounded(output,'game/js/main.js'),
    nativeSave:await readBounded(output,'game/js/sim/saveTransfer.js')
  }
});
assert.equal(result.schema_version,1);
assert.equal(result.status,'unverified');
assert.equal(result.runtime_execution_verified,false);
assert.equal(result.deployment_authorized,false);
assert.equal(result.entries.length,2);
assert.ok(result.entries.every(e=>e.target_file_present),'sac-runtime-assets-not-shipped');
// A missing compiled URL / dynamic-import hint is a regression and must be
// investigated; it does NOT grant runtime approval if the hints are present.
assert.equal(result.emitted_artifacts_consistent,true,'sac-angular-bundle-external-import-evidence-missing');
console.log(JSON.stringify({
  probe:'sac-pre002-lhs-pinned-angular-artifact-evidence',
  source_commit:pinned,
  game_angular_js_chunks:gameBundles.length,
  site_angular_js_chunks:siteBundles.length,
  ...result,
  note:'external runtime target present in static output; browser resolution NOT verified'
},null,2));

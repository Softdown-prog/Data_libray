/**
 * Fixed, first-party official Angular AOT sequence:
 *   clean A -> TS2339 invalid template -> warm corrected B -> clean B
 * Only the installed trusted smoke Angular CLI executes; no user app,
 * third-party repository, unbounded commands, VPS or deployment.
 * A successful warm build does NOT prove that Angular reused a cache entry.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareAngularIncrementalEvidence} from './sac_angular_incremental_evidence.mjs';

const smoke=fileURLToPath(new URL('../packages/angular-postcompiler/smoke/',import.meta.url));
const cli=path.join(smoke,'node_modules','@angular','cli','bin','ng.js');
const deps=path.join(smoke,'node_modules');
const root=await mkdtemp(path.join(smoke,'.sac-incremental-aot-'));
const warm=path.join(root,'warm'),cold=path.join(root,'cold');
const alpha='SAC_AOT_ALPHA_93F8B7',bravo='SAC_AOT_BRAVO_93F8B7';
const html=value=>'<h1>'+value+'</h1>\n';
const main=[
 "import {Component} from '@angular/core';",
 "import {bootstrapApplication} from '@angular/platform-browser';",
 "@Component({selector:'sac-smoke',standalone:true,templateUrl:'./view.html'})",
 "export class Smoke {}",
 "bootstrapApplication(Smoke).catch(()=>{});"
].join('\n')+'\n';
const angularConfig={
 version:1,
 cli:{analytics:false,cache:{enabled:true,environment:'all',path:'.angular/cache'}},
 projects:{smoke:{projectType:'application',root:'',sourceRoot:'src',
  architect:{build:{builder:'@angular/build:application',options:{
   browser:'src/main.ts',index:'src/index.html',tsConfig:'tsconfig.json',
   outputPath:'dist',outputHashing:'none',sourceMap:false,
   styles:['src/styles.css'],optimization:false
  }}}}}
};
const tsconfig={compilerOptions:{
 target:'ES2022',module:'preserve',moduleResolution:'bundler',
 strict:true,experimentalDecorators:true,skipLibCheck:true,
 lib:['ES2022','DOM']
},angularCompilerOptions:{strictTemplates:true},files:['src/main.ts']};
async function init(dir,template){
 await mkdir(path.join(dir,'src'),{recursive:true});
 // Symlink points ONLY to the versioned trusted first-party smoke toolchain.
 await symlink(deps,path.join(dir,'node_modules'),'dir');
 for(const [file,data] of [
  ['package.json',JSON.stringify({name:'sac-incremental-official',private:true,type:'module'})],
  ['angular.json',JSON.stringify(angularConfig)],
  ['tsconfig.json',JSON.stringify(tsconfig)],
  ['src/main.ts',main],
  ['src/view.html',template],
  ['src/index.html','<!doctype html><html><head><base href="/"></head><body><sac-smoke></sac-smoke></body></html>'],
  ['src/styles.css','body { margin: 0; }\n']
 ])await writeFile(path.join(dir,file),data,{flag:'wx',mode:0o600});
}
function build(dir,id){
 const output=spawnSync(process.execPath,[cli,'build','smoke'],{
  cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe'],
  maxBuffer:512*1024,timeout:90000,
  env:{...process.env,CI:'true',NG_CLI_ANALYTICS:'false',
   NG_DISABLE_VERSION_CHECK:'true',FORCE_COLOR:'0',NO_COLOR:'1'}
 });
 const ok=output.status===0&&!output.error&&!output.signal;
 const text=(output.stdout??'')+'\n'+(output.stderr??'');
 return {id,ok,ts2339:!ok&&/\bTS2339\b/.test(text),
  infrastructure_error:Boolean(output.error||output.signal)};
}
async function artifact(dir,marker){
 const file=path.join(dir,'dist','browser','main.js');
 const st=await stat(file);
 assert.ok(st.isFile()&&st.size>0&&st.size<=8*1024*1024,'bounded-angular-artifact');
 const bytes=await readFile(file);
 assert.equal(bytes.includes(Buffer.from(marker)),true,'expected-template-marker-not-emitted');
 return createHash('sha256').update(bytes).digest('hex');
}
try{
 await init(warm,html(alpha));
 const first=build(warm,'clean-baseline-A');
 assert.equal(first.ok,true,'official-AOT-clean-A-failed');
 const baseline=await artifact(warm,alpha);

 // This is a genuine official Angular type-check failure, not a mock failure.
 await writeFile(path.join(warm,'src/view.html'),'<h1>{{ missingMethod() }}</h1>\n');
 const invalid=build(warm,'negative-template-TS2339');
 assert.equal(invalid.ok,false,'missing-method-template-must-fail');
 assert.equal(invalid.ts2339,true,'negative-control-must-show-TS2339');

 // Reuse the SAME warm workspace, now with a different valid HTML template.
 await writeFile(path.join(warm,'src/view.html'),html(bravo));
 const rebuilt=build(warm,'warm-rebuild-B');
 assert.equal(rebuilt.ok,true,'official-AOT-warm-B-failed');
 const warmHash=await artifact(warm,bravo);

 // Completely separate project tree, without the warm cache directory.
 await init(cold,html(bravo));
 const fresh=build(cold,'independent-clean-B');
 assert.equal(fresh.ok,true,'official-AOT-clean-B-failed');
 const coldHash=await artifact(cold,bravo);

 const input={
  baseline_sha256:baseline,warm_sha256:warmHash,cold_sha256:coldHash,
  baseline_build_pass:first.ok,negative_build_failed:!invalid.ok,
  negative_diagnostic:invalid.ts2339?'TS2339':null,
  warm_build_pass:rebuilt.ok,cold_build_pass:fresh.ok
 };
 const comparison=compareAngularIncrementalEvidence(input);
 assert.equal(comparison.status,'pass','warm-cold-AOT-digest-divergence');

 // A controlled stale receipt MUST be rejected, without modifying the build.
 const stale=compareAngularIncrementalEvidence({...input,warm_sha256:baseline});
 assert.equal(stale.status,'fail');
 assert.equal(stale.code,'stale-artifact-not-updated');

 const report={schema_version:1,kind:'sac-official-angular-aot-warm-clean',
  toolchain:'first-party-pinned-angular-smoke',
  fixture:'synthetic-no-third-party-code',
  phases:[
   {id:first.id,status:'pass'},
   {id:invalid.id,status:'expected-fail',diagnostic:'TS2339'},
   {id:rebuilt.id,status:'pass'},
   {id:fresh.id,status:'pass'}
  ],
  artifacts_sha256:{baseline,warm:warmHash,cold:coldHash},
  change_reflected_in_artifact:baseline!==warmHash,
  warm_equals_clean:warmHash===coldHash,
  stale_receipt_negative_control:'detected',
  concordance:comparison.status,
  official_cli_invoked:true,cache_config_enabled:true,
  cache_hit_verified:false,production_aot_verified:false,
  browser_verified:false,deployment_authorized:false
 };
 assert.ok(JSON.stringify(report).length<4096);
 process.stdout.write(JSON.stringify(report)+'\n');
}finally{
 await rm(root,{recursive:true,force:true});
}

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectAngularCompilerWarnings} from '../scripts/sac_angular_warning_evidence.mjs';
import {collectAngularCompilerFailure} from '../scripts/sac_compiler_evidence.mjs';
const files=['src/app/main.ts','src/app/view.html'];
const warning=(code='NG8109',file='src/app/view.html')=>
 '▲ [WARNING] '+code+': confidential description [plugin angular-compiler]\n'+
 '    '+file+':5:9:\n'+'SECRET_TOKEN=private\n';
const inspect=(text,override={})=>collectAngularCompilerWarnings({
 stdout:text,stderr:'',exitCode:0,sourceFiles:files,...override
});
test('observe NG8109 in successful build without diagnostic text or secrets',()=>{
 const r=inspect(warning());
 assert.equal(r.build_outcome,'process-success');
 assert.equal(r.observed_warning_count,1);
 assert.deepEqual(r.findings,[{tool:'angular',severity:'warning',code:'NG8109',
  file:'src/app/view.html',line:5,column:9,location_verified:true}]);
 assert.equal(JSON.stringify(r).includes('SECRET_TOKEN'),false);
 assert.equal(r.compiler_invocation_verified,false);
 assert.equal(r.deployment_authorized,false);
});
test('successful exit alone does not claim verified compiler invocation or runtime',()=>{
 const r=inspect('Build completed.');
 assert.deepEqual(r.findings,[]);
 assert.equal(r.build_outcome,'process-success');
 assert.equal(r.source_sha_verified,false);
 assert.equal(r.browser_status,'not-run');
 assert.equal(r.post_status,'not-run');
});
test('failed build can also contain warnings, never marked process-success',()=>{
 const r=inspect(warning('NG8113'),{exitCode:1});
 assert.equal(r.build_outcome,'process-failure');
 assert.equal(r.findings[0].code,'NG8113');
});
test('only manifest-approved source paths are verified',()=>{
 const r=inspect(warning('NG8109','src/other.html'));
 assert.equal(r.findings[0].file,null);
 assert.equal(r.findings[0].location_verified,false);
 const ts=inspect(warning('TS6133','src/app/view.html'));
 assert.equal(ts.findings[0].file,null);
 const escape=inspect(warning('NG8109','../../.env'));
 assert.equal(escape.findings[0].file,null);
});
test('ANSI sequences, bounds, truncation and unrelated code are handled',()=>{
 assert.equal(inspect('\x1b[33m'+warning()+'\x1b[0m').findings[0].code,'NG8109');
 const r=inspect(warning().repeat(11));
 assert.equal(r.truncated,true);
 assert.equal(r.findings.length,8);
 assert.equal(r.observed_warning_count,11);
 assert.equal(inspect('▲ [WARNING] AA9999: unrelated\n').findings.length,0);
});
test('invalid input and excessive text fail closed',()=>{
 for(const value of [
  {stdout:'',stderr:'',exitCode:-1,sourceFiles:files},
  {stdout:warning(),stderr:'',exitCode:256,sourceFiles:files},
  {stdout:warning(),stderr:'',exitCode:0,sourceFiles:['../.env']},
  {stdout:warning(),stderr:'',exitCode:0,sourceFiles:[...files,files[0]]},
  {stdout:warning().repeat(5000),stderr:'',exitCode:0,sourceFiles:files}
 ]) assert.equal(collectAngularCompilerWarnings(value),null);
});
test('previous errors-only parser remains unchanged and warning extractor ignores errors',()=>{
 assert.equal(collectAngularCompilerFailure({
  stdout:warning(),stderr:'',exitCode:0,sourceFiles:files
 }),null);
 assert.equal(inspect('✘ [ERROR] NG8002: invalid\n').findings.length,0);
});

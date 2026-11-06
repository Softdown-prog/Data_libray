import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectAngularCompilerFailure} from '../scripts/sac_compiler_evidence.mjs';
const sourceFiles=['src/main.ts','src/mode.ts','package.json'];
const line=(code='TS2322',file='src/mode.ts',n=1,col=13)=>
 '✘ [ERROR] '+code+": Type 'number' is not assignable to type 'string'. [plugin angular-compiler]\n\n"+
 '    '+file+':'+n+':'+col+':\n';
const parse=(stdout,extra={})=>collectAngularCompilerFailure({
 stdout,stderr:'',exitCode:1,sourceFiles,...extra});
test('verified TS code and allowed file and location are preserved, without raw text',()=>{
 const r=parse(line()+'SECRET_TOKEN=confidential\n');
 assert.equal(r.status,'fail');assert.equal(r.exit_code,1);
 assert.deepEqual([r.findings[0].code,r.findings[0].file,r.findings[0].line,r.findings[0].column],
  ['TS2322','src/mode.ts',1,13]);
 assert.equal(r.findings[0].location_verified,true);
 assert.equal(r.root_cause_verified,false);assert.equal(r.deployment_authorized,false);
 assert.equal(JSON.stringify(r).includes('confidential'),false);
});
test('unapproved paths and wrong columns are not fabricated',()=>{
 for(const name of ['src/other.ts','../../root/.env','/root/private.ts','src/.env.ts']){
  const r=parse(line('TS2322',name));
  assert.deepEqual([r.findings[0].file,r.findings[0].line,r.findings[0].column],[null,null,null]);
  assert.equal(r.findings[0].location_verified,false);
 }
 assert.equal(parse(line('TS2322','src/mode.ts',1,0)).findings[0].location_verified,false);
});
test('unknown TS code keeps its code and uses a neutral description',()=>{
 const r=parse(line('TS9999'));
 assert.equal(r.findings[0].code,'TS9999');
 assert.match(r.findings[0].message,/registrou um erro/);
});
test('Docker failure, invalid/oversized output, no TS signature and successful exit are not mislabeled',()=>{
 for(const payload of [
  {stdout:'docker denied',stderr:'',exitCode:125,sourceFiles},
  {stdout:'nothing',stderr:'',exitCode:1,sourceFiles},
  {stdout:line(),stderr:'',exitCode:0,sourceFiles},
  {stdout:line(),stderr:'',exitCode:1,sourceFiles:['../secret.ts']},
  {stdout:line().repeat(1000),stderr:'',exitCode:1,sourceFiles}
 ])assert.equal(collectAngularCompilerFailure(payload),null);
});
test('four findings maximum and truncation preserve order',()=>{
 const r=parse(Array.from({length:7},(_,i)=>line('TS2322','src/main.ts',i+1,1)).join('\n'));
 assert.equal(r.findings.length,4);assert.equal(r.truncated,true);
 assert.deepEqual(r.findings.map(f=>f.line),[1,2,3,4]);
});
test('ANSI coloring does not hide trusted compiler evidence',()=>{
 assert.equal(parse('\x1b[31m'+line()+'\x1b[0m').findings[0].file,'src/mode.ts');
});

test('Angular NG8002 external template diagnostic is retained without raw template or secrets',()=>{
 const output='✘ [ERROR] NG8002: Cannot bind to \'x\' [plugin angular-compiler]\\n'+
  '    src/template.html:3:9:\\n'+ 'API_KEY=secret\\n';
 const r=parse(output,{sourceFiles:[...sourceFiles,'src/template.html']});
 assert.equal(r.status,'fail');
 assert.deepEqual(r.findings,[{tool:'angular',code:'NG8002',file:'src/template.html',
  line:3,column:9,message:'O compilador Angular registrou um diagnóstico NG.',
  location_verified:true}]);
 assert.equal(JSON.stringify(r).includes('secret'),false);
});
test('Angular NG codes can point at ts sources; TypeScript cannot claim HTML locations',()=>{
 const ng=parse('✘ [ERROR] NG5002: parser [plugin angular-compiler]\\n'+
  '    src/main.ts:4:2:\\n');
 assert.deepEqual([ng.findings[0].tool,ng.findings[0].file],['angular','src/main.ts']);
 const ts=parse(line('TS2322','src/template.html',2,3),
  {sourceFiles:[...sourceFiles,'src/template.html']});
 assert.equal(ts.findings[0].location_verified,false);
 assert.equal(ts.findings[0].file,null);
});
test('NG template paths are checked against source manifest and strict code prefixes',()=>{
 const unknown=parse('✘ [ERROR] NG8001: Unknown element\\n    src/private.html:1:1:\\n');
 assert.equal(unknown.findings[0].location_verified,false);
 for(const invalid of ['ng8002','NG80020','WX8002']){
  assert.equal(parse('✘ [ERROR] '+invalid+': bad\\n    src/main.ts:1:1:\\n'),null);
 }
});
test('mixed TS and NG diagnostics preserve individual tools, locations and bounds',()=>{
 const r=parse(line()+'\\n✘ [ERROR] NG8002: Angular binding\\n    src/template.html:2:7:\\n',
  {sourceFiles:[...sourceFiles,'src/template.html']});
 assert.deepEqual(r.findings.map(f=>f.tool),['typescript','angular']);
 assert.deepEqual(r.findings.map(f=>f.file),['src/mode.ts','src/template.html']);
});

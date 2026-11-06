import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectRustcErrorCodes} from '../packages/sac-multistack/src/rustc-diagnostics.mjs';
const sample={message:'synthetic secrets must be dropped',level:'error',
 code:{code:'E0308',explanation:'untrusted source'},spans:[{file_name:'/etc/secret'}]};
test('accept rustc JSON diagnostics with code but never messages or paths',()=>{
 const codes=collectRustcErrorCodes({stderr:JSON.stringify(sample)+'\n',exitCode:1});
 assert.deepEqual(codes,['E0308']);
 assert.ok(!JSON.stringify(codes).includes('secret'));
});
test('deduplicate and limit Rust error codes',()=>{
 const items=[sample,{...sample,code:{code:'E0308'}},
  {...sample,code:{code:'E0277'}},{...sample,level:'warning',code:{code:'E0500'}}];
 assert.deepEqual(collectRustcErrorCodes({stderr:items.map(JSON.stringify).join('\n'),exitCode:1}),
   ['E0308','E0277']);
});
test('fail closed on stdout injection, invalid JSON, missing exit code or oversized output',()=>{
 for(const data of [
  {stderr:'E0308 syntax',exitCode:1},
  {stderr:'{"level":"error","code":{"code":"E0308"}}\nNOT JSON',exitCode:1},
  {stderr:JSON.stringify(sample),exitCode:0},
  {stderr:'x'.repeat(32769),exitCode:1},
  {stderr:JSON.stringify({...sample,code:{code:'E0308\nTOKEN'}}),exitCode:1}
 ]){
   const actual=collectRustcErrorCodes(data);
   if(data.stderr.includes('E0308\\nTOKEN')){
     assert.deepEqual(actual,[]);
   }else assert.ok(actual===null||actual.length===0);
 }
});

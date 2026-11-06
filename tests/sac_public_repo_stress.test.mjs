import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {eligibleGitBlob,checkGitBlob,stableCandidates,runPublicRepoStress} from '../packages/sac-multistack/src/public-repo-stress.mjs';
import {PUBLIC_STRESS_TARGETS} from '../packages/sac-multistack/src/public-stress-targets.mjs';

const bytes=Buffer.from('int main(){return 0;}\n');
const sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const ROOT='1'.repeat(40),LEAF='2'.repeat(40),COMMIT='3'.repeat(40);
const f={path:'example.cc',sha,size:bytes.length,type:'blob',mode:'100644'};
function fake({badBlob=false,oversized=false,empty=false}={}){
 let calls=0;
 return {http:async (url,opts)=>{
  calls++;
  assert.equal(opts.redirect,'error');
  assert.ok(url.startsWith('https://api.github.com/repos/chromium/chromium'));
  let object;
  if(url.endsWith('chromium/chromium'))
   object={full_name:'chromium/chromium',private:false,default_branch:'main',size:68000000};
  else if(url.endsWith('/commits/main'))
   object={sha:COMMIT,commit:{tree:{sha:ROOT}}};
  else if(url.endsWith('/git/trees/'+ROOT))
   object={tree:[{path:'base',type:'tree',sha:LEAF}],truncated:false};
  else if(url.endsWith('/git/trees/'+LEAF))
   object={tree:empty?[]:[f],truncated:false};
  else if(url.endsWith('/git/blobs/'+sha))
   object={encoding:'base64',content:(badBlob?Buffer.from('wrong'):bytes).toString('base64')};
  else throw Error('unexpected request');
  const data=JSON.stringify(object);
  return new Response(data,{status:200,headers:{
   'content-length':oversized?'9000000':String(Buffer.byteLength(data))}});
 },getCalls:()=>calls};
}
test('samples actual SAC preflight and never asserts a full audit',async()=>{
 const req=fake();
 const report=await runPublicRepoStress({http:req.http,targets:[PUBLIC_STRESS_TARGETS[0]]});
 const r=report.repositories[0];
 assert.equal(req.getCalls(),5);
 assert.equal(r.blob_files_verified,1);
 assert.equal(r.source_sha,COMMIT);
 assert.equal(r.repository_size_kb,68000000);
 assert.equal(r.preflight_status,'pass');
 assert.equal(r.finding,'bounded-preflight-only');
 assert.equal(r.overall_audit,'unverified');
 assert.equal(r.build,'not-run');
 assert.equal(report.third_party_code_executed,false);
 assert.equal(report.full_clone,false);
});
test('report digest and metadata budget failures with stable codes',async()=>{
 for(const [opts,expected] of [
   [{badBlob:true},'git-object-digest-mismatch'],
   [{oversized:true},'response-budget-reached']
 ]){
  const req=fake(opts);
  const {repositories:[r]}=await runPublicRepoStress({
   http:req.http,targets:[PUBLIC_STRESS_TARGETS[0]]});
  assert.equal(r.preflight_status,'not-run');
  assert.equal(r.finding,expected);
  assert.equal(r.overall_audit,'unverified');
 }
});
test('missing source coverage is unverified rather than green',async()=>{
 const req=fake({empty:true});
 const {repositories:[r]}=await runPublicRepoStress({
  http:req.http,targets:[PUBLIC_STRESS_TARGETS[0]]});
 assert.equal(r.finding,'no-supported-sources-in-sample');
 assert.equal(r.overall_audit,'unverified');
});
test('refuse symlinks, unsafe filenames and unreviewed repositories',async()=>{
 assert.equal(checkGitBlob(bytes,sha),true);
 assert.equal(checkGitBlob(Buffer.from('wrong'),sha),false);
 assert.equal(eligibleGitBlob(f,['.cc']),true);
 assert.equal(eligibleGitBlob({...f,mode:'120000'},['.cc']),false);
 assert.equal(eligibleGitBlob({...f,size:900000},['.cc']),false);
 assert.deepEqual(stableCandidates([f,{...f,path:'../secret.cc'},
   {...f,mode:'120000',path:'unsafe.cc'}],'base',['.cc'])
   .map(x=>x.path),['base/example.cc']);
 await assert.rejects(()=>runPublicRepoStress({targets:[{
  repo:'unexpected/public',branch:'main',directory:'src',module:'javascript'
 }]}),/unapproved-public-stress-targets/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {interpretWorkerReply} from '../scripts/sac_brain_worker_reply.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/sac-brain-vps-reply.synthetic.json',import.meta.url)));
test('synthetic Panel job reply can be classified without proving provenance',()=>{
 const r=interpretWorkerReply(fixture);
 assert.equal(r.status,'fail');assert.equal(r.code,'diagnostic-available');
 assert.equal(r.known,1);assert.equal(r.unknown,1);
 assert.equal(r.job_id,'gha-111222-1');assert.equal(r.source_sha,'a'.repeat(40));
 assert.equal(r.findings[0].classification,'known-pattern');
 assert.equal(r.findings[1].classification,'insufficient-evidence');
 assert.equal(r.origin_verified,false);assert.equal(r.deployment_authorized,false);
 assert.equal(JSON.stringify(r).includes('SECRET_SHOULD_NOT_APPEAR'),false);
});
test('actual shape of rejected VPS query is unverified, never a pass',()=>{
 const r=interpretWorkerReply({exitCode:1,error:'ValueError: request rejected SECRET'});
 assert.equal(r.status,'unverified');assert.equal(r.code,'worker-query-not-completed');
 assert.equal(JSON.stringify(r).includes('SECRET'),false);
});
test('absent job or diagnostics cannot claim pass',()=>{
 const missing=structuredClone(fixture);
 missing.sacWorker={action:'job',jobId:'gha-111222-1',status:'not-recorded',readOnly:true};
 assert.equal(interpretWorkerReply(missing).code,'job-not-recorded');
 const noDiag=structuredClone(fixture);delete noDiag.sacWorker.diagnostic;
 assert.equal(interpretWorkerReply(noDiag).status,'unverified');
 assert.equal(interpretWorkerReply(noDiag).code,'worker-diagnostic-not-recorded');
});
test('fake identity, deploy approval, unsupported status and forged pass rejected',()=>{
 for(const mutation of [
  o=>{o.operation='deploy'},o=>{o.id='999-1-sac_worker-infrastructure'},
  o=>{o.sacWorker.jobId='../etc'},o=>{o.sacWorker.readOnly=false},
  o=>{o.sacWorker.deploymentAuthorized=true},
  o=>{o.sacWorker.sourceSha='not-sha'},
  o=>{o.sacWorker.status='pass'},
  o=>{o.sacWorker.diagnostic.status='pass'}
 ]){
  const v=structuredClone(fixture);mutation(v);
  assert.throws(()=>interpretWorkerReply(v),/invalid-worker-reply|invalid-diagnostic/);
 }
});
test('CLI rejects raw or private payload without echoing it',()=>{
 const dir=mkdtempSync(join(tmpdir(),'brain-worker-'));
 try{
  const file=join(dir,'reply.json');
  const cli=fileURLToPath(new URL('../scripts/sac_brain_worker_reply_cli.mjs',import.meta.url));
  writeFileSync(file,JSON.stringify(fixture));
  const yes=spawnSync(process.execPath,[cli,file],{encoding:'utf8',timeout:5000});
  assert.equal(yes.status,0,yes.stderr);assert.equal(JSON.parse(yes.stdout).known,1);
  writeFileSync(file,'{"exitCode":0,"secret":"PRIVATE_TOKEN"}');
  const no=spawnSync(process.execPath,[cli,file],{encoding:'utf8',timeout:5000});
  assert.equal(no.status,2);assert.equal(no.stdout,'');
  assert.equal(no.stderr.includes('PRIVATE_TOKEN'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

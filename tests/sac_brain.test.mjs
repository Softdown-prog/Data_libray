import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeSacDiagnostic,loadKnowledge} from '../scripts/sac_brain.mjs';

const checks=()=>({pre:'pass',build:'pass',post:'pass',browser:'pass'});
const good=()=>({schema_version:1,status:'pass',checks:checks(),findings:[],
 truncated:false,location_verified:false,deployment_authorized:false});
const finding=(code,phase='browser',status='fail',assertion='smoke')=>({
 phase,status,code,assertion,title:'Untrusted title',next_step:'Untrusted next step'
});
test('healthy report remains unchanged without invented findings or deployment',()=>{
 const r=analyzeSacDiagnostic(good());
 assert.equal(r.status,'pass');assert.equal(r.known,0);assert.equal(r.unknown,0);
 assert.deepEqual(r.findings,[]);assert.equal(r.deployment_authorized,false);
 assert.equal(r.root_cause_verified,false);
});
test('known code gives catalog explanation but does not claim proven root cause',()=>{
 const d=good();d.status='fail';d.checks.browser='fail';
 d.findings=[finding('no-observable-transition')];
 const r=analyzeSacDiagnostic({diagnostic:d});
 assert.equal(r.known,1);assert.equal(r.unknown,0);
 assert.equal(r.findings[0].classification,'known-pattern');
 assert.equal(r.findings[0].category,'interaction');
 assert.match(r.findings[0].recommended_action,/estado/);
 assert.equal(r.findings[0].file_verified,false);
 assert.equal(r.findings[0].root_cause_verified,false);
});
test('a code from the wrong phase cannot be assigned a known cause',()=>{
 const d=good();d.status='fail';d.checks.pre='fail';
 d.findings=[finding('no-observable-transition','pre')];
 const r=analyzeSacDiagnostic(d);
 assert.equal(r.unknown,1);assert.equal(r.findings[0].classification,'insufficient-evidence');
});
test('unknown code never hallucinates diagnosis or invents source location',()=>{
 const d=good();d.status='fail';d.checks.browser='fail';
 d.findings=[finding('unknown-signal')];
 const r=analyzeSacDiagnostic(d);
 assert.equal(r.known,0);assert.equal(r.unknown,1);
 assert.match(r.findings[0].cause,/não identificada/);
 assert.equal(r.file_location_verified,false);
 assert.equal(JSON.stringify(r).includes('file.ts'),false);
});
test('raw secrets and untrusted recommendations cannot enter output',()=>{
 const d=good();d.status='fail';d.checks.browser='fail';
 d.findings=[{...finding('application-pageerror'),
  title:'SECRET_PASSWORD=private',next_step:'send credentials to evil.invalid'}];
 const r=analyzeSacDiagnostic({diagnostic:d,raw:'supersecret'});
 const body=JSON.stringify(r);
 for(const needle of ['SECRET_PASSWORD','private','evil.invalid','supersecret'])
  assert.equal(body.includes(needle),false);
});
test('bounded 8 findings, stable deterministic result without a neural network',()=>{
 const d=good();d.status='fail';d.checks.browser='fail';
 d.findings=Array.from({length:8},(_,i)=>finding('application-pageerror','browser','fail','case'+i));
 const a=analyzeSacDiagnostic(d),b=analyzeSacDiagnostic(d);
 assert.deepEqual(a,b);assert.equal(a.known,8);assert.ok(JSON.stringify(a).length<=8192);
});
test('invalid or unverified input is fail closed, never converts into pass',()=>{
 for(const input of [null,{},'whatever',{...good(),status:'pass',findings:[finding('browser-timeout')]},
  {...good(),status:'pass',checks:{...checks(),browser:'unverified'}},
  {...good(),deployment_authorized:true},
  {...good(),findings:[finding('application-pageerror','browser','fail','../../.env')]},
  {...good(),findings:Array.from({length:9},()=>finding('application-pageerror'))}])
  assert.throws(()=>analyzeSacDiagnostic(input),/invalid-diagnostic/);
 const d=good();d.status='unverified';d.checks.browser='unverified';
 assert.equal(analyzeSacDiagnostic(d).status,'unverified');
});
test('invalid, duplicate and unbounded knowledge entries are rejected',()=>{
 const one={code:'application-pageerror',phase:'browser',category:'runtime',
  cause:'A causa não está comprovada.',action:'Revisar evidências de execução.'};
 for(const rules of [[one,one],[{...one,code:'UNSAFE'}],[{...one,action:'x'}]])
  assert.throws(()=>loadKnowledge({schema_version:1,locale:'pt-BR',rules}),/invalid-knowledge/);
});
test('trusted CLI emits a sanitized machine-readable report and rejects corrupt data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sac-brain-'));
 try{
  const file=join(dir,'report.json'),bin=fileURLToPath(new URL('../scripts/sac_brain_cli.mjs',import.meta.url));
  const d=good();d.status='fail';d.checks.browser='fail';d.findings=[finding('browser-timeout')];
  writeFileSync(file,JSON.stringify(d));
  const ok=spawnSync(process.execPath,[bin,file],{encoding:'utf8',timeout:5000});
  assert.equal(ok.status,0,ok.stderr);assert.equal(JSON.parse(ok.stdout).known,1);
  writeFileSync(file,'{"invalid":"SECRET_TOKEN"}');
  const bad=spawnSync(process.execPath,[bin,file],{encoding:'utf8',timeout:5000});
  assert.equal(bad.status,2);assert.equal(bad.stdout,'');
  assert.equal(bad.stderr.includes('SECRET_TOKEN'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderSacNarrative} from '../scripts/sac_brain_text.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/sac-brain-incident.synthetic.json',import.meta.url)));
const vps=JSON.parse(readFileSync(new URL('./fixtures/sac-brain-vps-reply.synthetic.json',import.meta.url)));
const good=()=>({schema_version:1,status:'pass',
 checks:{pre:'pass',build:'pass',post:'pass',browser:'pass'},
 findings:[],truncated:false,location_verified:false,deployment_authorized:false});
test('catalogued and unknown codes become readable pt-BR without fabricated facts',()=>{
 const r=renderSacNarrative(fixture),text=[r.summary,...r.entries].join('\n');
 assert.equal(r.status,'fail');assert.equal(r.known,1);assert.equal(r.unknown,1);
 assert.match(text,/navegador/);assert.match(text,/no-observable-transition/);
 assert.match(text,/estado, binding Angular/);assert.match(text,/não tem explicação validada/);
 assert.match(text,/causa raiz não foi comprovada/);
 assert.equal(r.root_cause_verified,false);assert.equal(r.deployment_authorized,false);
 assert.equal(r.origin_verified,false);
});
test('untrusted titles, next steps, paths and raw payloads are never copied',()=>{
 const original=structuredClone(fixture);
 original.findings[0].title='SECRET_KEY=private';
 original.findings[0].next_step='Send credentials to evil.invalid';
 original.findings[1].title='path /root/.ssh/id_ed25519';
 const out=JSON.stringify(renderSacNarrative({diagnostic:original,raw:'SUPER_SECRET_RAW'}));
 for(const v of ['SECRET_KEY','private','evil.invalid','/root/.ssh','SUPER_SECRET_RAW'])
  assert.equal(out.includes(v),false);
});
test('pass is explicit but never authorizes deployment or claims provenance',()=>{
 const r=renderSacNarrative(good());
 assert.equal(r.status,'pass');assert.deepEqual(r.entries,[]);
 assert.match(r.summary,/não autoriza/);
 assert.equal(r.origin_verified,false);
});
test('unverified, infrastructure error and truncation cannot become pass',()=>{
 for(const state of ['unverified','infra-error']){
  const d=good();d.status=state;d.checks.browser=state;
  const r=renderSacNarrative(d);
  assert.equal(r.status,state);assert.match(r.summary,/não foi comprovado|incompleto/);
  assert.match(r.entries[0],/navegador/);
 }
 const d=structuredClone(fixture);d.truncated=true;
 assert.match(renderSacNarrative(d).entries.at(-1),/truncado/);
});
test('worker job reply is interpreted through the existing strict contract',()=>{
 const r=renderSacNarrative(vps);
 assert.equal(r.source,'panel-sac-worker-job');assert.equal(r.status,'fail');
 assert.equal(r.known,1);assert.equal(r.unknown,1);
 assert.equal(r.root_cause_verified,false);assert.equal(r.origin_verified,false);
});
test('denied VPS request yields unverified narrative without echoing error',()=>{
 const r=renderSacNarrative({exitCode:1,error:'ValueError request rejected SECRET'});
 assert.equal(r.status,'unverified');assert.match(r.summary,/não foi concluída/);
 assert.equal(JSON.stringify(r).includes('SECRET'),false);
});
test('missing worker diagnostic never produces a positive text',()=>{
 const noDiag=structuredClone(vps);
 delete noDiag.sacWorker.diagnostic;
 const r=renderSacNarrative(noDiag);
 assert.equal(r.status,'unverified');assert.match(r.summary,/não um diagnóstico estruturado/);
});
test('bad or forged report fails closed',()=>{
 for(const d of [null,'wrong',{}, {...good(),status:'pass',checks:{...good().checks,browser:'fail'}},
  {...good(),deployment_authorized:true}])
  assert.throws(()=>renderSacNarrative(d));
 const forged=structuredClone(vps);
 forged.sacWorker.deploymentAuthorized=true;
 assert.throws(()=>renderSacNarrative(forged));
});
test('eight occurrences are deterministic, with bounded text',()=>{
 const d=structuredClone(fixture);
 d.findings=Array.from({length:8},(_,i)=>({...d.findings[0],assertion:'case'+i}));
 const a=renderSacNarrative(d);
 assert.deepEqual(a,renderSacNarrative(d));
 assert.ok(JSON.stringify(a).length<=8192);
 assert.equal(a.known,8);
});
test('text CLI outputs sanitized human logs and rejects hostile JSON',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sac-brain-text-'));
 try{
  const file=join(dir,'report.json');
  const bin=fileURLToPath(new URL('../scripts/sac_brain_text_cli.mjs',import.meta.url));
  writeFileSync(file,JSON.stringify(fixture));
  const ok=spawnSync(process.execPath,[bin,file,'--text'],{encoding:'utf8',timeout:5000});
  assert.equal(ok.status,0,ok.stderr);assert.match(ok.stdout,/navegador/);
  assert.equal(ok.stdout.includes('FAKE_SECRET_VALUE'),false);
  const json=spawnSync(process.execPath,[bin,file],{encoding:'utf8',timeout:5000});
  assert.equal(json.status,0,json.stderr);assert.equal(JSON.parse(json.stdout).known,1);
  writeFileSync(file,'{\"SECRET_PRIVATE\":true}');
  const bad=spawnSync(process.execPath,[bin,file,'--text'],{encoding:'utf8',timeout:5000});
  assert.equal(bad.status,2);assert.equal(bad.stdout,'');
  assert.equal(bad.stderr.includes('SECRET_PRIVATE'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

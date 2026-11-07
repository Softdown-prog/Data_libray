/**
 * First-party seeded Canvas 2D pixel proof in SAC pinned, offline Chromium.
 * No user code, no arbitrary command, no network to external hosts.
 */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cp,chmod,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {fixedBrowserDockerArgs} from '../packages/sac-multistack/src/browser-docker.mjs';
import {decodeCanvasBrowserOutput} from '../packages/sac-multistack/src/canvas-evidence.mjs';
import {dockerChildEnvironment} from '../packages/angular-guardian/src/docker-environment.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const fixture=path.join(repo,'packages/sac-multistack/fixtures/canvas');
const guardian=path.join(repo,'packages/angular-guardian');
const image=process.env.SAC_SANDBOX_IMAGE;
assert.match(image??'',/^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const stage=await mkdtemp(path.join(os.tmpdir(),'sac-canvas-'));
const runtime=path.join(stage,'runtime'),dist=path.join(stage,'dist');
const input=path.join(stage,'input.json');
const name='sac-multistack-'+randomUUID().replaceAll('-','').slice(0,20);
try{
 await mkdir(path.join(runtime,'src'),{recursive:true});
 await mkdir(path.join(runtime,'node_modules'),{recursive:true});
 await mkdir(dist,{recursive:true});
 const names=['index.html','scene.js'];
 const records=[];
 for(const f of names){
  const buffer=await readFile(path.join(fixture,f));
  assert.ok(buffer.length>0&&buffer.length<64*1024,'fixture-budget');
  await writeFile(path.join(dist,f),buffer);
  records.push([f,sha(buffer)]);
 }
 const digest=sha(JSON.stringify(records));
 await cp(path.join(repo,'packages/sac-multistack/canvas/entry.mjs'),
  path.join(runtime,'src/entry.mjs'));
 await cp(path.join(guardian,'src/artifact-server.mjs'),
  path.join(runtime,'src/artifact-server.mjs'));
 for(const moduleName of ['playwright','playwright-core']){
  await cp(path.join(guardian,'node_modules',moduleName),
   path.join(runtime,'node_modules',moduleName),{
    recursive:true,dereference:false
   });
 }
 await writeFile(input,JSON.stringify({
  scenario:'canvas-seeded-2d',digest
 }));
 for(const folder of [stage,runtime,path.join(runtime,'src'),
  path.join(runtime,'node_modules'),dist])
  await chmod(folder,0o755);
 const args=fixedBrowserDockerArgs({
  image,seccomp:path.join(guardian,'sandbox/seccomp_profile.json'),
  runtime,dist,input,name
 });
 const res=spawnSync('docker',args,{
  shell:false,encoding:'utf8',timeout:90000,maxBuffer:32768,
  env:dockerChildEnvironment()
 });
 assert.equal(Boolean(res.error||res.signal),false,'canvas-docker-infra-failed');
 assert.equal(res.status,0,'canvas-docker-runtime-failed');
 const proof=decodeCanvasBrowserOutput(res.stdout,digest);
 assert.equal(proof.status,'pass',JSON.stringify(proof.codes));
 assert.equal(proof.dpr_variants_verified,2);
 const report={
  schema_version:1,kind:'sac-canvas2d-first-party-chromium-pixels',
  fixture_digest:digest,
  browser_status:proof.status,
  canvas_context:'2d',
  dpr_variants_verified:proof.dpr_variants_verified,
  same_seed_pixel_repetition:'pass',
  different_seed_pixel_change:'pass',
  blank_frame_negative_control:'detected',
  sandbox:'pinned-docker-network-none',
  project_runtime_verified:false,
  git_source_revision_verified:false,
  deployment_authorized:false
 };
 process.stdout.write(JSON.stringify(report)+'\n');
}finally{
 spawnSync('docker',['rm','--force',name],{
  stdio:'ignore',timeout:10000,env:dockerChildEnvironment()
 });
 await rm(stage,{force:true,recursive:true});
}

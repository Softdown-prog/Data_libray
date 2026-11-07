/**
 * SAC: pinned full offline game loops in network-none Chromium.
 * Two fixed adapters compile LHS runtime ticks and Terrania
 * PhaserGame+Game scene graphs. No server, payments or WS.
 * All source reads and bundling happen on a disposable GitHub runner,
 * not the VPS. The browser executes inside network-none Docker.
 */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {cp,chmod,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {fixedBrowserDockerArgs} from '../packages/sac-multistack/src/browser-docker.mjs';
import {decodeGameBehaviorOutput} from '../packages/sac-multistack/src/game-behavior-evidence.mjs';
import {scanProceduralCanvasWorkspace} from '../packages/sac-multistack/src/procedural-canvas-stream.mjs';
import {dockerChildEnvironment} from '../packages/angular-guardian/src/docker-environment.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const guardian=path.join(root,'packages/angular-guardian');
const source={
 lhs:{root:path.join(root,'.sac-snapshots/lhs-canvas/games/lan_house_simulator'),
  repo:path.join(root,'.sac-snapshots/lhs-canvas'),
  sha:'2cb4be0144354f1753c9a0cec4edca929a9dc92f'},
 terrania:{root:path.join(root,'.sac-snapshots/terrania-canvas'),
  repo:path.join(root,'.sac-snapshots/terrania-canvas'),
  sha:'3c94b6f11d656afc6740121b853056efe164830c'}
};
for(const game of Object.values(source)){
 const sha=execFileSync('git',['-C',game.repo,'rev-parse','HEAD'],{
  encoding:'utf8',timeout:5000
 }).trim();
 assert.equal(sha,game.sha,'source-revision-not-pinned');
}
const image=process.env.SAC_SANDBOX_IMAGE;
assert.match(image??'',/^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/);
const require=createRequire(path.join(source.lhs.root,'package.json'));
const esbuild=require('esbuild');
const trusted=createRequire(path.join(root,'packages/angular-postcompiler/smoke/package.json'));
const ts=trusted('typescript');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={schema_version:1,kind:'sac-real-game-behaviors-combat-and-queues',
 scope:'pinned-source-offline-behaviors',source_revision_verified:true,
 games:[],sandbox:'pinned-chromium-network-none',
 full_gameplay_verified:false,phaser_game_loop_verified:true,
 multiplayer_verified:false,deployment_authorized:false};
for(const name of ['lhs','terrania']){
 const game=source[name];
 const inventory=await scanProceduralCanvasWorkspace({
  workspace:game.root,sourceRoot:'src',typescript:ts,
  maxFiles:20000,maxElapsedMs:180000
 });
 assert.equal(inventory.scan_completed,true,'source-scan-incomplete-'+name);
 assert.equal(inventory.inventory.parse_error_files,0,'syntax-observations-'+name);
 assert.ok(inventory.inventory.source_files>=30,'unrealistically-small-game-scope');
 const stage=await mkdtemp(path.join(os.tmpdir(),'sac-real-render-'+name+'-'));
 const runtime=path.join(stage,'runtime'),dist=path.join(stage,'dist');
 const input=path.join(stage,'input.json');
 const containerName='sac-multistack-'+randomUUID().replaceAll('-','').slice(0,20);
 try{
  await mkdir(path.join(runtime,'src'),{recursive:true});
  await mkdir(path.join(runtime,'node_modules'),{recursive:true});
  await mkdir(dist,{recursive:true});
  const adapter=await readFile(path.join(root,
   'packages/sac-multistack/real-games/'+(name==='lhs'?'lhs-queue-entry.mjs':'terrania-combat-entry.mjs')),'utf8');
  assert.ok(adapter.length>100&&adapter.length<32*1024);
  await esbuild.build({
   stdin:{contents:adapter,resolveDir:path.join(game.root,'src'),
    sourcefile:'sac-real-'+name+'-adapter.js',loader:'js'},
   bundle:true,platform:'browser',format:'esm',target:'chrome120',
   minify:false,sourcemap:false,write:true,
   outfile:path.join(dist,'game.js'),
   logLevel:'silent',
   legalComments:'none'
  });
  const html='<!doctype html><html><head><meta charset="utf-8"></head>'+
   (name==='lhs'?'<body><canvas id="scene"></canvas>':
    '<body style="margin:0"><div id="mount" style="width:900px;height:640px"></div>')+
   '<script type="module" src="/game.js"></script></body></html>';
  await writeFile(path.join(dist,'index.html'),html);
  const records=[];
  for(const file of ['game.js','index.html']){
   const bytes=await readFile(path.join(dist,file));
   assert.ok(bytes.length>0&&bytes.length<8*1024*1024,'bounded-generated-bundle');
   records.push([file,hash(bytes)]);
  }
  const digest=hash(JSON.stringify(records));
  await cp(path.join(root,'packages/sac-multistack/real-games/behavior-browser-entry.mjs'),
   path.join(runtime,'src/entry.mjs'));
  await cp(path.join(guardian,'src/artifact-server.mjs'),
   path.join(runtime,'src/artifact-server.mjs'));
  for(const dependency of ['playwright','playwright-core'])
   await cp(path.join(guardian,'node_modules',dependency),
    path.join(runtime,'node_modules',dependency),
    {recursive:true,dereference:false});
  await writeFile(input,JSON.stringify({game:name,digest}));
  for(const folder of [stage,dist,runtime,path.join(runtime,'src'),
   path.join(runtime,'node_modules')])await chmod(folder,0o755);
  const args=fixedBrowserDockerArgs({
   image,seccomp:path.join(guardian,'sandbox/seccomp_profile.json'),
   runtime,dist,input,name:containerName
  });
  const browser=spawnSync('docker',args,{encoding:'utf8',shell:false,
   timeout:120000,maxBuffer:32768,env:dockerChildEnvironment()});
  assert.equal(Boolean(browser.error||browser.signal),false,
   'docker-render-infrastructure-'+name);
  assert.equal(browser.status,0,'docker-render-process-'+name);
  const proof=decodeGameBehaviorOutput(browser.stdout,name,digest);
  assert.equal(proof.status,'pass',
   'real-'+name+'-behavior-regression:'+proof.codes.join(','));
  assert.equal(proof.executed,true);
  report.games.push({
   id:name,git_sha:game.sha,source_files:inventory.inventory.source_files,
   source_sha256:inventory.snapshot_sha256,
   live_runtime_bundle_sha256:digest,
   runtime_status:proof.status,
   scenario_stage:proof.stage,
   scenario_observations:proof.observations,
   
   
   
   source_executed_in_docker_only:true,
   behavior_scenario_verified:true,full_gameplay_verified:false
  });
 }finally{
  spawnSync('docker',['rm','--force',containerName],{
   stdio:'ignore',timeout:10000,env:dockerChildEnvironment()
  });
  await rm(stage,{recursive:true,force:true});
 }
}
assert.equal(report.games.length,2);
assert.ok(JSON.stringify(report).length<8192);
process.stdout.write(JSON.stringify(report)+'\n');

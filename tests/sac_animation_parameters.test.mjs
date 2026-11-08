import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,rm,symlink,writeFile,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {selectAnimationRoots,inspectAnimationSources,
  assessAnimationFrameSamples} from '../packages/sac-multistack/src/animation-parameters.mjs';
import {scanAnimationWorkspace} from '../packages/sac-multistack/src/animation-parameter-scan.mjs';

const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',
 import.meta.url));
const ts=require('typescript');
const fixture=new URL('../packages/sac-multistack/fixtures/terrania/architecture/modules.json',
 import.meta.url);
const original=JSON.parse(await readFile(fixture,'utf8'));
async function setup(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'sac-animation-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'architecture'),{recursive:true});
 await copyFile(fixture,path.join(root,'architecture','modules.json'));
 for(const sub of ['src/render','src/ui','src/actors','src/engine','src/game'])
  await mkdir(path.join(root,sub),{recursive:true});
 await writeFile(path.join(root,'src/render','animation.ts'),
  'export const ATTACK_DURATION = 0.28;\n'+
  'export const ATTACK_WINDUP = 0.08;\n'+
  'export function animate(ctx){requestAnimationFrame(()=>{});ctx.rotate(0);}\n');
 await writeFile(path.join(root,'src/engine','Weapons.ts'),
  'export const weapons={wood:{interval:0.8,windup:0.07},iron:{interval:1,windup:0.09}};\n');
 await writeFile(path.join(root,'src/actors','Player.ts'),
  'export const WALK_SPEED = 30;\n');
 await writeFile(path.join(root,'src/game','Game.ts'),
  'export const frame=()=>{requestAnimationFrame(frame);};\n');
 await writeFile(path.join(root,'src/ui','CanvasScene.ts'),
  'export function draw(ctx){ctx.fillRect(0,0,3,3);}\n');
 return root;
}
test('pinned Terrania architecture fixture maps animation ownership rather than keyframes',()=>{
 assert.equal(original.schemaVersion,1);
 assert.equal(original.modules.length,16);
 const found=selectAnimationRoots(original);
 assert.deepEqual(found.modules,['renderer','actors','simulation','phaser-game']);
 assert.ok(found.roots.includes('src/render'));
 assert.ok(found.roots.includes('src/actors'));
 assert.ok(found.roots.includes('src/engine'));
 assert.ok(found.roots.includes('src/game'));
 assert.equal(found.roots.includes('src/app'),false);
 const fake=structuredClone(original);
 fake.modules[0].roots=['../secrets'];
 assert.throws(()=>selectAnimationRoots(fake),/manifest-invalid/);
 const dupe=structuredClone(original);
 dupe.modules.push(structuredClone(dupe.modules[0]));
 assert.throws(()=>selectAnimationRoots(dupe),/manifest-invalid/);
 assert.throws(()=>selectAnimationRoots(original,['not-a-module']),
  /animation-modules-unavailable/);
});
test('AST flags literal timing/opacity faults but refuses to claim runtime validation',()=>{
 const samples=[
  {path:'src/render/animation.ts',content:
   'export const ATTACK_DURATION=0.28;\n'+
   'export const ATTACK_WINDUP=0;\n'+
   'const fps=0; const attackInterval=flag?0.1:0.2;\n'+
   'ctx.globalAlpha=1.5; requestAnimationFrame(draw);\n'},
  {path:'src/engine/Weapons.ts',content:
   'export const weapons={wood:{interval:0.8},bad:{interval:-1}};\n'}
 ];
 const result=inspectAnimationSources({manifest:original,sources:samples,typescript:ts});
 assert.equal(result.status,'unverified');
 assert.equal(result.source_files,2);
 assert.ok(result.parameters_observed>=5);
 assert.equal(result.dynamic_parameters,1);
 assert.ok(result.render_or_timer_calls>=1);
 const codes=result.candidate_findings.map(f=>f.code);
 assert.ok(codes.includes('non-positive-animation-timing'));
 assert.ok(codes.includes('frame-rate-outside-supported-range'));
 assert.ok(codes.includes('opacity-outside-zero-one'));
 assert.match(result.source_snapshot_sha256,/^[a-f0-9]{64}$/);
 assert.equal(result.runtime_execution_verified,false);
 assert.equal(result.deployment_authorized,false);
 assert.doesNotMatch(JSON.stringify(result),/requestAnimationFrame\(draw\)|flag\?/);
 const reversed=inspectAnimationSources({manifest:original,sources:samples.reverse(),typescript:ts});
 assert.deepEqual(reversed,result,'input file order must not change source observation');
 assert.throws(()=>inspectAnimationSources({manifest:original,typescript:ts,
  sources:[{path:'src/app/private.ts',content:'const fps=0;'}]}),/out-of-scope/);
});
const timeline=[0,250,500,750,1000];
const pose=ms=>({x:ms/20,y:Math.sin(ms/200),rotation:ms/1000,
 scaleX:1.02,scaleY:0.98,opacity:1-ms/1000,progress:ms/1000});
const samples=()=>[30,60].flatMap(fps=>timeline.map(timeMs=>({
 fps,timeMs,pose:pose(timeMs)
})));
test('animation samples compare 30/60 FPS at common time checkpoints',()=>{
 const report=assessAnimationFrameSamples({samples:samples()});
 assert.equal(report.status,'pass');
 assert.equal(report.checkpoints_checked,5);
 assert.deepEqual(report.frame_rates,[30,60]);
 assert.equal(report.maximum_observed_delta,0);
 assert.equal(report.runtime_execution_verified,false);
 assert.equal(report.deployment_authorized,false);
});
test('frame-rate drift, bad opacity/progress and invalid numbers are negatives',()=>{
 let values=samples();
 values[6].pose={...values[6].pose,x:values[6].pose.x+3};
 assert.equal(assessAnimationFrameSamples({samples:values}).code,'animation-frame-rate-drift');
 values=samples();values[0].pose={...values[0].pose,opacity:1.4};
 assert.equal(assessAnimationFrameSamples({samples:values}).code,'animation-opacity-outside-zero-one');
 values=samples();values[0].pose={...values[0].pose,progress:-.1};
 assert.equal(assessAnimationFrameSamples({samples:values}).code,'animation-progress-outside-zero-one');
 values=samples();values[0].pose={...values[0].pose,x:NaN};
 assert.equal(assessAnimationFrameSamples({samples:values}).status,'unverified');
 values=samples();values[9].timeMs=250;
 assert.equal(assessAnimationFrameSamples({samples:values}).code,'duplicate-animation-timestamp');
 values=samples();values[0].pose={...values[0].pose,hidden:'PRIVATE'};
 const ignored=assessAnimationFrameSamples({samples:values});
 assert.equal(ignored.status,'unverified');
 assert.doesNotMatch(JSON.stringify(ignored),/PRIVATE/);
});
test('filesystem reader scopes real source modules without importing app code',async t=>{
 const root=await setup(t);
 await writeFile(path.join(root,'src/render','broken.ts'),
  "const ATTACK_DURATION=0; const fps=30; ctx.globalAlpha=-1;\n");
 const first=await scanAnimationWorkspace({workspace:root,typescript:ts});
 assert.equal(first.scan_completed,true);
 assert.equal(first.status,'unverified');
 assert.equal(first.source_files,6);
 assert.equal(first.parse_error_files,0);
 assert.equal(first.modules.length,4);
 assert.ok(first.parameters_observed>=4);
 assert.ok(first.candidate_findings.length>=2);
 assert.match(first.module_manifest_sha256,/^[a-f0-9]{64}$/);
 const second=await scanAnimationWorkspace({workspace:root,typescript:ts});
 assert.deepEqual(first,second,'repeat scan should be stable');
 const budget=await scanAnimationWorkspace({workspace:root,typescript:ts,maxFiles:1});
 assert.equal(budget.scan_completed,false);
 assert.equal(budget.code,'animation-file-budget');
 await symlink(path.join(root,'src/render','animation.ts'),
  path.join(root,'src/render','link.ts'));
 const bad=await scanAnimationWorkspace({workspace:root,typescript:ts});
 assert.equal(bad.scan_completed,false);
 assert.equal(bad.code,'animation-source-symlink');
});
test('incomplete roots and malformed manifest fail closed with sanitized reason',async t=>{
 const root=await setup(t);
 await rm(path.join(root,'src/ui'),{recursive:true,force:true});
 const r=await scanAnimationWorkspace({workspace:root,typescript:ts});
 assert.equal(r.scan_completed,false);
 assert.equal(r.code,'animation-source-unavailable');
 assert.equal(r.deployment_authorized,false);
 const badRoot=await scanAnimationWorkspace({workspace:root,typescript:ts,
  manifestPath:'../.env'});
 assert.equal(badRoot.scan_completed,false);
 assert.equal(badRoot.code,'animation-manifest-path-invalid');
});
test('CLI emits bounded JSON from real module index and never runs game npm scripts',async t=>{
 const root=await setup(t);
 const cmd=fileURLToPath(new URL('../packages/sac-multistack/bin/animation-parameters.mjs',
   import.meta.url));
 const run=spawnSync(process.execPath,[cmd,root],{
  encoding:'utf8',timeout:20000,maxBuffer:65536
 });
 assert.equal(run.status,0,run.stderr);
 const out=JSON.parse(run.stdout);
 assert.equal(out.scan_completed,true);
 assert.equal(out.source_files,5);
 assert.equal(out.status,'unverified');
 assert.equal(out.runtime_execution_verified,false);
});

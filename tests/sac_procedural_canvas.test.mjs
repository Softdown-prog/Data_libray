import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,symlink} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {scanProceduralCanvasWorkspace} from '../packages/sac-multistack/src/procedural-canvas-stream.mjs';
import {assessProceduralGridSamples} from '../packages/sac-multistack/src/procedural-properties.mjs';

const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const make=async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sac-proc-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(path.join(dir,'src'),{recursive:true});
 return dir;
};
test('5000 files use a bounded per-file AST scanner without executing game source',async t=>{
 const dir=await make(t),paths=[];
 for(let i=0;i<50;i++){
  const sub=path.join(dir,'src','zone-'+String(i).padStart(2,'0'));
  await mkdir(sub);paths.push(sub);
 }
 for(let i=0;i<5000;i+=100){
  const batch=[];
  for(let n=i;n<i+100;n++){
   const file=path.join(paths[n%50],'f-'+String(n).padStart(4,'0')+'.ts');
   const code=n===0?"const c = canvas.getContext('2d'); c.fillRect(0,0,8,8);\n":
    n===1?"export function generateTerrain(seed:number){return seed ^ 11}\n":
    n===2?"const x=Math.random();\n":'export const tile'+n+'='+n+';\n';
   batch.push(writeFile(file,code));
  }
  await Promise.all(batch);
 }
 await mkdir(path.join(dir,'node_modules'));
 await writeFile(path.join(dir,'node_modules','vendor.ts'),'malformed-ignored');
 const first=await scanProceduralCanvasWorkspace({
  workspace:dir,sourceRoot:'src',typescript:ts,maxElapsedMs:180000
 });
 assert.equal(first.scan_completed,true,JSON.stringify(first.findings));
 assert.equal(first.inventory.source_files,5000);
 assert.equal(first.inventory.parse_error_files,0);
 assert.equal(first.status,'unverified');
 assert.equal(first.signals.canvas_context,1);
 assert.equal(first.signals.canvas_drawing,1);
 assert.equal(first.signals.procedural_functions,1);
 assert.equal(first.signals.math_random,1);
 assert.ok(first.candidate_paths.canvas.length>0);
 assert.ok(first.candidate_paths.procedural.length>0);
 assert.equal(first.snapshot_sha256.length,64);
 assert.equal(first.runtime_verified,false);
 assert.equal(first.deployment_authorized,false);
 const second=await scanProceduralCanvasWorkspace({
  workspace:dir,sourceRoot:'src',typescript:ts
 });
 assert.equal(second.snapshot_sha256,first.snapshot_sha256);
 const limited=await scanProceduralCanvasWorkspace({
  workspace:dir,sourceRoot:'src',typescript:ts,maxFiles:64
 });
 assert.equal(limited.scan_completed,false);
 assert.ok(limited.findings.includes('source-file-budget'));
 assert.equal(limited.snapshot_sha256,null);
});
test('symlink, syntax diagnostic, size limit and unsafe paths fail closed',async t=>{
 const dir=await make(t);
 await writeFile(path.join(dir,'src','bad.ts'),'function broken( {\n');
 let result=await scanProceduralCanvasWorkspace({
  workspace:dir,sourceRoot:'src',typescript:ts
 });
 assert.equal(result.scan_completed,true);
 assert.equal(result.inventory.parse_error_files,1);
 assert.ok(result.findings.includes('source-syntax-diagnostic-observed'));
 await symlink(path.join(dir,'src','bad.ts'),path.join(dir,'src','evil.ts'));
 result=await scanProceduralCanvasWorkspace({
  workspace:dir,sourceRoot:'src',typescript:ts
 });
 assert.equal(result.scan_completed,false);
 assert.ok(result.findings.includes('source-symlink-blocked'));
 await rm(path.join(dir,'src','evil.ts'));
 await symlink(path.join(dir,'src'),path.join(dir,'source-link'));
 const linked=await scanProceduralCanvasWorkspace({
  workspace:dir,sourceRoot:'source-link',typescript:ts
 });
 assert.equal(linked.scan_completed,false);
 assert.ok(linked.findings.includes('source-root-symlink'));
 await rm(path.join(dir,'source-link'));
 result=await scanProceduralCanvasWorkspace({
  workspace:dir,sourceRoot:'src',typescript:ts,maxFileBytes:3
 });
 assert.equal(result.scan_completed,false);
 assert.ok(result.findings.includes('single-source-budget'));
 await assert.rejects(()=>scanProceduralCanvasWorkspace({
  workspace:dir,sourceRoot:'../',typescript:ts
 }),/invalid-procedural-scan-config/);
});
const generate=(seed,size=256)=>{
 let state=seed>>>0;
 const grid=new Uint8Array(size);
 for(let i=0;i<size;i++){
  state^=state<<13;state^=state>>>17;state^=state<<5;
  grid[i]=(state>>>0)%8;
 }
 return grid;
};
const samples=generator=>[7,13,73].flatMap(seed=>[0,1].map(trial=>({
 seed,trial,grid:generator(seed,trial)
})));
test('same seed reproduces terrain and independent seeds are distinct',()=>{
 const result=assessProceduralGridSamples({
  width:16,height:16,maxTile:7,
  samples:samples(seed=>generate(seed)),requireSeedDiversity:true
 });
 assert.equal(result.status,'pass');
 assert.equal(result.seeds_checked,3);
 assert.equal(result.distinct_grid_digests,3);
 assert.equal(result.runtime_execution_verified,false);
 assert.equal(result.deployment_authorized,false);
});
test('negative property controls catch nondeterminism and tile overflow',()=>{
 let n=0;
 const nondet=samples(seed=>{const grid=generate(seed);grid[0]=n++%7;return grid;});
 assert.equal(assessProceduralGridSamples({
  width:16,height:16,maxTile:7,samples:nondet
 }).code,'same-seed-nondeterministic');
 const bad=samples(seed=>{const grid=generate(seed);grid[2]=255;return grid;});
 assert.equal(assessProceduralGridSamples({
  width:16,height:16,maxTile:7,samples:bad
 }).code,'tile-out-of-range');
});
test('missing pairs, forged samples and constant terrain never get false evidence',()=>{
 const valid=samples(seed=>generate(seed));
 assert.equal(assessProceduralGridSamples({
  width:16,height:16,maxTile:7,samples:valid.slice(1)
 }).status,'unverified');
 const uniform=samples(()=>new Uint8Array(256));
 assert.equal(assessProceduralGridSamples({
  width:16,height:16,maxTile:7,samples:uniform,requireSeedDiversity:true
 }).code,'seed-diversity-unobserved');
 const forged=samples(seed=>generate(seed));
 forged[0]={...forged[0],grid:'PRIVATE_VALUE'};
 const r=assessProceduralGridSamples({
  width:16,height:16,maxTile:7,samples:forged
 });
 assert.equal(r.status,'unverified');
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_VALUE/);
});

test('generic CLI scans an arbitrary checkout without executing its code',async t=>{
 const dir=await make(t);
 await writeFile(path.join(dir,'src','canvas.ts'),
  "const ctx = stage.getContext('2d'); ctx.fillRect(0,0,10,10);\n");
 const cli=fileURLToPath(new URL('../packages/sac-multistack/bin/canvas-stream.mjs',
  import.meta.url));
 const result=spawnSync(process.execPath,[cli,dir,'src'],{
  encoding:'utf8',timeout:20000,maxBuffer:32768
 });
 assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(result.stdout);
 assert.equal(report.scan_completed,true);
 assert.equal(report.inventory.source_files,1);
 assert.equal(report.signals.canvas_context,1);
 assert.equal(report.status,'unverified');
 assert.equal(report.deployment_authorized,false);
});

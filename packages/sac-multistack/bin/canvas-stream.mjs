#!/usr/bin/env node
// SAC Canvas/procedural CLI: inventory only. Does NOT run untrusted game modules.
import {createRequire} from 'node:module';
import path from 'node:path';
import {scanProceduralCanvasWorkspace} from '../src/procedural-canvas-stream.mjs';

const argv=process.argv.slice(2);
if(argv.length!==2||argv.some(x=>!x||x.startsWith('--'))){
 process.stderr.write('usage: node canvas-stream.mjs WORKSPACE SOURCE_ROOT\n');
 process.exitCode=2;
}else{
 try{
  const require=createRequire(new URL('../../angular-postcompiler/smoke/package.json',
   import.meta.url));
  const ts=require('typescript'); // trusted, pinned SAC fixture parser
  const report=await scanProceduralCanvasWorkspace({
   workspace:path.resolve(argv[0]),sourceRoot:argv[1],typescript:ts
  });
  process.stdout.write(JSON.stringify(report)+'\n');
  // Exit zero only means enumeration finished with zero parse errors.
  // Overall audit status stays unverified: no code, build or Canvas executed.
  if(!report.scan_completed||report.inventory.parse_error_files>0)
   process.exitCode=1;
 }catch{
  process.stderr.write('sac-canvas-stream-configuration-unverified\n');
  process.exitCode=2;
 }
}

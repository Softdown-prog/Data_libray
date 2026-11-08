#!/usr/bin/env node
// Standalone, read-only SAC animation parameters inventory. Never runs game code.
import {createRequire} from 'node:module';
import path from 'node:path';
import {scanAnimationWorkspace} from '../src/animation-parameter-scan.mjs';

const argv=process.argv.slice(2);
if(argv.length!==1||!argv[0]||argv[0].startsWith('--')){
 process.stderr.write('usage: node animation-parameters.mjs TERRANIA_CHECKOUT\n');
 process.exitCode=2;
}else{
 try{
  const require=createRequire(new URL('../../angular-postcompiler/smoke/package.json',
   import.meta.url));
  const ts=require('typescript'); // pinned SAC-controlled parser
  const result=await scanAnimationWorkspace({
   workspace:path.resolve(argv[0]),typescript:ts
  });
  process.stdout.write(JSON.stringify(result)+'\n');
  // No source-only result can certify visual smoothness or runtime gameplay.
  if(!result.scan_completed||result.parse_error_files>0)process.exitCode=1;
 }catch{
  process.stderr.write('sac-animation-parameters-configuration-unverified\n');
  process.exitCode=2;
 }
}

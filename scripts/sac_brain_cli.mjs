/** Trusted CI / operator CLI; read a small SAC diagnostic and print only safe analysis. */
import {readFileSync} from 'node:fs';
import {analyzeSacDiagnostic} from './sac_brain.mjs';
const arg=process.argv[2];
if(process.argv.length!==3||!arg||arg.startsWith('-')){
 console.error('Usage: node scripts/sac_brain_cli.mjs <trusted-diagnostic-json>');
 process.exitCode=2;
}else{
 try{
  const input=readFileSync(arg);
  if(input.length>8192)throw Error('too-large');
  const report=analyzeSacDiagnostic(JSON.parse(input.toString('utf8')));
  process.stdout.write(JSON.stringify(report)+'\n');
 }catch{
  console.error('sac-brain: invalid input (no untrusted details emitted)');
  process.exitCode=2;
 }
}

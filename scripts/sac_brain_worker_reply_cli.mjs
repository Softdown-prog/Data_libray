/** Offline read-only conversion of a bounded VPS Actions result file. */
import {readFileSync} from 'node:fs';
import {interpretWorkerReply} from './sac_brain_worker_reply.mjs';
if(process.argv.length!==3||!process.argv[2]||process.argv[2].startsWith('-')){
 console.error('Usage: node scripts/sac_brain_worker_reply_cli.mjs <trusted-vps-result.json>');
 process.exitCode=2;
}else{
 try{
  const b=readFileSync(process.argv[2]);
  if(b.byteLength>16384)throw Error('too-large');
  process.stdout.write(JSON.stringify(interpretWorkerReply(JSON.parse(b.toString('utf8'))))+'\n');
 }catch{
  console.error('sac-brain-worker: invalid input; no untrusted contents emitted');
  process.exitCode=2;
 }
}

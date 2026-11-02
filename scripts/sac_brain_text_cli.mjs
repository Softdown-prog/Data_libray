/** Offline text/JSON CLI for trusted sanitized SAC diagnostics or Panel job reply. */
import {readFileSync} from 'node:fs';
import {renderSacNarrative} from './sac_brain_text.mjs';
const arg=process.argv[2],asText=process.argv[3]==='--text';
if(!arg||arg.startsWith('-')||process.argv.length>4||
   process.argv.length===4&&!asText){
 console.error('Usage: node scripts/sac_brain_text_cli.mjs <trusted-diagnostic-or-worker-json> [--text]');
 process.exitCode=2;
}else{
 try{
  const bytes=readFileSync(arg);
  if(bytes.byteLength>16384)throw Error('too-large');
  const report=renderSacNarrative(JSON.parse(bytes.toString('utf8')));
  process.stdout.write(asText?[report.summary,...report.entries].join('\n')+'\n':JSON.stringify(report)+'\n');
 }catch{
  console.error('sac-brain-text: invalid input (no untrusted details emitted)');
  process.exitCode=2;
 }
}

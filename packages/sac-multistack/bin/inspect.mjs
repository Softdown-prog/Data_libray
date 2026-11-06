// SAC read-only CLI: receives a local request, executes no user code.
import { readFile } from 'node:fs/promises';
import { inspectModule } from '../src/inspect.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--request'){
  process.stderr.write('Uso: node packages/sac-multistack/bin/inspect.mjs --request request.json\n');
  process.exitCode=2;
}else{
  try{
    const data=await readFile(args[1]);
    if(data.length>16384)throw Error('request-too-large');
    const r=JSON.parse(data.toString('utf8'));
    if(!r||Object.keys(r).sort().join(',')!=='module_id,source_files,workspace')
      throw Error('invalid-request');
    const report=await inspectModule({
      moduleId:r.module_id,workspace:r.workspace,sourceFiles:r.source_files
    });
    process.stdout.write(JSON.stringify(report)+'\n');
    if(report.preflight.status==='fail')process.exitCode=1;
    if(report.preflight.status==='unverified')process.exitCode=3;
  }catch{
    process.stderr.write('Requisição SAC multistack inválida.\n');
    process.exitCode=2;
  }
}

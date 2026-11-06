// Synthetic HTML5/CSS conformance. No project source or arbitrary script execution.
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../packages/sac-multistack/fixtures/',import.meta.url));
const bin=path.join(root,'node_modules','.bin');
const stage=await mkdtemp(path.join(os.tmpdir(),'sac-markup-probes-'));
const checks=[];
const run=(cli,args,diagnose=false)=>{
  const proc=spawnSync(path.join(bin,cli),args,{cwd:stage,
    encoding:'utf8',timeout:20000,maxBuffer:16384,shell:false,
    env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:stage,
      CI:'true',NODE_ENV:'test'}});
  if(diagnose&&proc.status!==0){
    const ids=[...String(proc.stdout||'').matchAll(/"ruleId"\s*:\s*"([a-z0-9-]+)"/g)]
      .map(x=>x[1]).slice(0,12);
    process.stderr.write('Synthetic HTML rule IDs: '+JSON.stringify([...new Set(ids)])+
      '; exit='+String(proc.status)+'\n');
  }
  return proc.error||proc.signal?'unverified':proc.status===0?'pass':'fail';
};
try{
  const html=path.join(stage,'fixture.html');
  await writeFile(html,'<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8">\n    <title>Valid synthetic fixture</title>\n  </head>\n  <body>\n    <main><h1>Heading</h1></main>\n  </body>\n</html>\n');
  const hp=run('html-validate',['--preset','recommended','--formatter','json',html],true);
  await writeFile(html,'<!doctype html><html lang="pt-BR"><head><title>Teste</title></head><body><p><div>Inválido</div></p></body></html>\n');
  const hn=run('html-validate',['--preset','recommended','--formatter','json',html]);
  checks.push({module_id:'html5',tool:'html-validate',positive:hp,negative:hn,
    status:hp==='pass'&&hn==='fail'?'pass':
      hp==='unverified'||hn==='unverified'?'unverified':'fail'});

  const css=path.join(stage,'fixture.css');
  const config=path.join(root,'stylelint.config.mjs');
  await writeFile(css,':root {\n  color: #000;\n}\n');
  const cp=run('stylelint',['--config',config,css]);
  await writeFile(css,':root {\n  colr: #000;\n}\n');
  const cn=run('stylelint',['--config',config,css]);
  checks.push({module_id:'css',tool:'stylelint',positive:cp,negative:cn,
    status:cp==='pass'&&cn==='fail'?'pass':
      cp==='unverified'||cn==='unverified'?'unverified':'fail'});
}finally{await rm(stage,{force:true,recursive:true});}
process.stdout.write(JSON.stringify({schema_version:1,
 kind:'synthetic-markup-positive-negative-probes',deployment_authorized:false,
 checks})+'\n');
if(checks.length!==2||checks.some(x=>x.status!=='pass'))process.exitCode=1;

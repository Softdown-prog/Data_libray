/**
 * SAC diagnostic v2 research: observe an actual Angular/TypeScript error.
 * The fixture is copied into a disposable directory and never deployed.
 * This probe NEVER emits the raw compiler stdout/stderr to Actions artifacts.
 * No execution from GitHub issue/user-controlled arguments is accepted.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const fixture=fileURLToPath(new URL('../packages/angular-postcompiler/smoke/',import.meta.url));
const source='src/main.ts';
const safeFiles=['package.json','package-lock.json','angular.json','tsconfig.json',
                 source,'src/index.html','src/styles.css'];
const stripAnsi=text=>text.replace(/\x1b\[[0-9;]*m/g,'');
const failure=message=>{throw Error('sac-negative-probe: '+message);};

export function inspectKnownSyntheticAngularError(output, expectedLine){
 // This is NOT a generic production parser; it recognizes this one artificial
 // known fixture only. It proves what the official compiler actually provides.
 if(typeof output!=='string'||output.length>65536)failure('invalid-output');
 if(!Number.isSafeInteger(expectedLine)||expectedLine<1)failure('invalid-fixture-line');
 const text=stripAnsi(output);
 const code=/\bTS2322\b/.test(text)?'TS2322':null;
 const locations=[...text.matchAll(/\bsrc\/main\.ts:(\d+):(\d+)\b/g)];
 const location=locations.map(m=>({line:Number(m[1]),column:Number(m[2])}))
   .find(m=>m.line===expectedLine&&Number.isSafeInteger(m.column)&&m.column>0);
 if(!code||!location)failure('compiler-code-or-location-unobserved');
 return Object.freeze({
   code, file:source, line:location.line, column:location.column,
   location_verified:true
 });
}

export async function runSyntheticAngularFailureProbe(){
 const nodeModules=path.join(fixture,'node_modules');
 const bin=path.join(nodeModules,'@angular/cli/bin/ng.js');
 const temporary=await mkdtemp(path.join(tmpdir(),'sac-compiler-negative-'));
 try{
  for(const name of safeFiles){
   const dest=path.join(temporary,name);
   await mkdir(path.dirname(dest),{recursive:true});
   await copyFile(path.join(fixture,name),dest);
  }
  // CI has already installed the pinned fixture dependencies using npm ci.
  await symlink(nodeModules,path.join(temporary,'node_modules'),'dir');
  const original=await readFile(path.join(temporary,source),'utf8');
  const prefix=original.endsWith('\n')?original:original+'\n';
  const expectedLine=prefix.split('\n').length;
  await writeFile(path.join(temporary,source),
     prefix+'const sacSyntheticString: string = 123;\n');
  const child=spawnSync(process.execPath,[bin,'build','smoke'],{
   cwd:temporary,encoding:'utf8',timeout:120000,maxBuffer:65536,shell:false,
   env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:temporary,
     CI:'true',NG_CLI_ANALYTICS:'false',NO_COLOR:'1',FORCE_COLOR:'0'}
  });
  if(child.error||child.signal||child.status!==1)
   failure('official-angular-build-did-not-return-expected-error');
  const diagnostic=inspectKnownSyntheticAngularError(
    String(child.stdout??'')+'\n'+String(child.stderr??''),expectedLine);
  return {
   schema_version:1,
   probe:'synthetic-angular-compiler-failure',
   stage:'build',
   build_status:'fail',
   exit_code:child.status,
   diagnostic,
   post_status:'not-run',
   browser_status:'not-run',
   original_output_exported:false,
   deployment_authorized:false
  };
 }finally{
  await rm(temporary,{recursive:true,force:true});
 }
}

// No arbitrary CLI options, source paths, projects, or shell commands.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2){
  console.error('sac-negative-probe: arguments-not-accepted');
  process.exitCode=2;
 }else{
  try{
   const report=await runSyntheticAngularFailureProbe();
   process.stdout.write(JSON.stringify(report)+'\n');
  }catch{
   // Intentionally never relay raw compiler text or host paths.
   console.error('sac-negative-probe: expected-diagnostic-not-confirmed');
   process.exitCode=1;
  }
 }
}

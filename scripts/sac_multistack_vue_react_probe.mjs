/**
 * SAC-062: official Vue SFC and React TSX typecheck + official Vite builds.
 * Runs ONLY with repository-owned synthetic fixtures in disposable CI checkout.
 * Does not run project-defined npm scripts, browser or tenant source code.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const dir=fileURLToPath(new URL('../packages/sac-multistack/fixtures/ui/',import.meta.url));
const bin=path.join(dir,'node_modules','.bin');
const fixtures=[
  {module:'vue',tool:'vue-tsc',file:'vue/src/App.vue',
   tsconfig:'tsconfig.vue.json',viteconfig:'vite.vue.config.mjs',
   valid:'count.toFixed(0)',invalid:'count.unknownMethod()'},
  {module:'react',tool:'tsc',file:'react/src/App.tsx',
   tsconfig:'tsconfig.react.json',viteconfig:'vite.react.config.mjs',
   valid:'count.toFixed(0)',invalid:'count.unknownMethod()'}
];
const report={schema_version:1,kind:'synthetic-official-vue-react-typecheck-build',
  deployment_authorized:false,checks:[]};
const exec=(program,args)=>{
  const p=spawnSync(program,args,{cwd:dir,encoding:'utf8',
    timeout:90000,maxBuffer:16384,shell:false,
    env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:dir,
      CI:'true',NODE_ENV:'production'}});
  if(p.error||p.signal||p.status===null)return {status:'unverified',codes:[]};
  // Only fixed compiler diagnostic IDs, never raw logs or arbitrary messages.
  const safe=(String(p.stdout||'')+'\n'+String(p.stderr||'')).slice(0,16384);
  const codes=[...new Set([...safe.matchAll(/\bTS[0-9]{4,5}\b/g)]
    .map(match=>match[0]))].slice(0,8);
  return {status:p.status===0?'pass':'fail',codes};
};
let approved=true;
for(const fixture of fixtures){
  const target=path.join(dir,fixture.file);
  const original=await readFile(target,'utf8');
  assert.equal(original.includes(fixture.valid),true,'fixture-marker-missing');
  const cli=path.join(bin,fixture.tool);
  let positive,negative,build={status:'not-run'},dist='not-run';
  try{
    positive=exec(cli,['--noEmit','-p',fixture.tsconfig]);
    await writeFile(target,original.replace(fixture.valid,fixture.invalid));
    negative=exec(cli,['--noEmit','-p',fixture.tsconfig]);
  }finally{
    await writeFile(target,original);
  }
  // Require actual TS2339; generic nonzero exit is not evidence of a type error.
  if(positive.status==='pass'&&negative.status==='fail'&&
     negative.codes.includes('TS2339')){
    build=exec(path.join(bin,'vite'),['build','--config',fixture.viteconfig]);
    if(build.status==='pass'){
      try{
        const output=path.join(dir,'dist',fixture.module);
        const html=await readFile(path.join(output,'index.html'),'utf8');
        const assets=await readdir(path.join(output,'assets'));
        const scripts=assets.filter(name=>/\.js$/.test(name));
        if(scripts.length>0&&html.includes('<script')&&
           (await stat(path.join(output,'assets',scripts[0]))).size>0)dist='pass';
        else dist='fail';
      }catch{dist='fail';}
    }
  }
  const status=positive.status==='pass'&&negative.status==='fail'&&
    negative.codes.includes('TS2339')&&build.status==='pass'&&dist==='pass'?
    'pass':positive.status==='unverified'||negative.status==='unverified'||
      build.status==='unverified'?'unverified':'fail';
  report.checks.push({module_id:fixture.module,tools:[fixture.tool,'vite'],
    positive_typecheck:positive.status,
    negative_typecheck:negative.status,
    observed_diagnostic:negative.codes.includes('TS2339')?'TS2339':null,
    official_build:build.status,build_artifact:dist,
    browser:'not-run',status});
  if(status!=='pass')approved=false;
}
process.stdout.write(JSON.stringify(report)+'\n');
if(!approved)process.exitCode=1;

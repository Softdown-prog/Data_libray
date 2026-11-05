/**
 * SAC-PRE004 pinned LHS template inventory, read-only.
 * Capture static evidence BEFORE project dependencies/AOT and reconcile it
 * AFTER the existing independent game-ui and site-rewrite Angular builds.
 * Only bounded sanitized counts and fixed finding codes leave the process.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstat,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {inspectAngularTemplateLinks} from '../packages/angular-precompiler/src/template-links.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pinned='c5139c2cc5088adc3bbf0bf85d2952e64e2fc5ac';
const checkout=path.join(root,'.sac-snapshots','lhs');
const angular=path.join(checkout,'games/lan_house_simulator/frontend-angular');
const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const temp=process.env.RUNNER_TEMP;
const mode=process.argv[2];
assert.ok(['before','after'].includes(mode)&&process.argv.length===3,'pre004-lhs-invalid-mode');
assert.ok(temp&&path.isAbsolute(temp),'pre004-lhs-runner-temp-required');
const before=path.join(temp,'sac-pre004-lhs-template-before.json');
const aot=path.join(temp,'sac-pre003-lhs-aot-comparison.json');
const git=(...args)=>execFileSync('git',['-C',checkout,...args],{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000
}).trim();
assert.equal(git('rev-parse','HEAD'),pinned,'pre004-lhs-unexpected-revision');

async function bounded(file,max) {
  const stat=await lstat(file);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max,
    'pre004-lhs-unsafe-file');
  return readFile(file,'utf8');
}
async function collect() {
  const home=path.join(angular,'src');
  const files=[],templates=[];
  let count=0,bytes=0;
  async function visit(dir) {
    assert.ok(++count<=128,'pre004-lhs-too-many-directories');
    const items=(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for(const item of items) {
      assert.ok(!item.isSymbolicLink(),'pre004-lhs-symlinks-unsupported');
      const absolute=path.join(dir,item.name);
      if(item.isDirectory()){await visit(absolute);continue;}
      assert.ok(item.isFile(),'pre004-lhs-special-file');
      if(!/\.(?:tsx?|html)$/.test(item.name))continue;
      const relative=path.relative(angular,absolute).split(path.sep).join('/');
      assert.ok(relative.startsWith('src/')&&!relative.includes('..'),'pre004-lhs-path-escape');
      const source=await bounded(absolute,512*1024);
      bytes+=Buffer.byteLength(source,'utf8');
      assert.ok(bytes<=2*1024*1024,'pre004-lhs-total-size');
      if(/\.tsx?$/.test(item.name))files.push({path:relative,source});
      else templates.push({path:relative,source});
      assert.ok(files.length<=128&&templates.length<=128,'pre004-lhs-too-many-files');
    }
  }
  await visit(home);
  assert.equal(files.length,45,'pre004-lhs-ts-inventory-drift');
  assert.equal(templates.length,44,'pre004-lhs-html-inventory-drift');
  return {files,templates};
}
function tally(findings){
  const out={};
  for(const f of findings)out[f.code]=(out[f.code]??0)+1;
  return Object.fromEntries(Object.entries(out).sort(([a],[b])=>a.localeCompare(b)));
}
if(mode==='before'){
  const {files,templates}=await collect();
  const r=inspectAngularTemplateLinks({files,templates,typescript:ts});
  const back=inspectAngularTemplateLinks({
    files:[...files].reverse(),templates:[...templates].reverse(),typescript:ts
  });
  assert.deepEqual(r,back,'pre004-lhs-nondeterministic');
  assert.equal(r.status,'unverified');
  assert.equal(r.aot_verified,false);
  assert.equal(r.deployment_authorized,false);
  assert.equal(r.components_checked,45,'pre004-lhs-component-count-drift');
  const report={
    schema_version:1,probe:'SAC-PRE004-LHS-TEMPLATE-BEFORE-AOT',
    project:'lhs',source_commit:pinned,frontend_ts_files:files.length,
    frontend_html_files:templates.length,
    components_checked:r.components_checked,
    external_template_links_observed:r.external_templates_linked,
    inline_templates_observed:r.inline_templates_observed,
    missing_enumerated_template_references:r.external_templates_not_enumerated,
    findings_by_code:tally(r.findings),
    static_status:r.status,html_compilation_verified:false,
    deployment_authorized:false
  };
  assert.ok(JSON.stringify(report).length<2048,'pre004-lhs-report-oversize');
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}else{
  const first=JSON.parse(await bounded(before,4096));
  const compilation=JSON.parse(await bounded(aot,8192));
  assert.equal(first.probe,'SAC-PRE004-LHS-TEMPLATE-BEFORE-AOT');
  assert.equal(first.source_commit,pinned);
  assert.equal(first.frontend_html_files,44);
  assert.equal(first.static_status,'unverified');
  assert.equal(compilation.probe,'SAC-PRE003-LHS-PINNED-AOT-COMPARISON');
  assert.equal(compilation.source_commit,pinned);
  assert.equal(compilation.snapshot_two_aot_builds_verified,true);
  assert.deepEqual(compilation.builds.map(x=>x.app),['game-ui','site-rewrite']);
  assert.ok(compilation.builds.every(x=>x.aot_build_step_succeeded===true));
  assert.equal(compilation.deployment_authorized,false);
  assert.equal(git('status','--porcelain','--','games/lan_house_simulator/frontend-angular/src'),
    '','pre004-lhs-snapshot-source-drift');
  const report={
    schema_version:1,probe:'SAC-PRE004-LHS-TEMPLATE-AOT-OBSERVATION',
    project:'lhs',source_commit:pinned,
    frontend_ts_files:first.frontend_ts_files,
    frontend_html_files:first.frontend_html_files,
    external_template_links_observed:first.external_template_links_observed,
    inline_templates_observed:first.inline_templates_observed,
    missing_enumerated_template_references:first.missing_enumerated_template_references,
    findings_by_code:first.findings_by_code,
    angular_aot_builds_observed:['game-ui','site-rewrite'],
    observation:'no-runtime-or-universal-template-certification',
    static_status:'unverified',static_html_compilation_verified:false,
    project_aot_steps_succeeded:true,production_aot_verified:false,
    runtime_verified:false,deployment_authorized:false
  };
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

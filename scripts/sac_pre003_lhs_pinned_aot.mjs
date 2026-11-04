/**
 * SAC-PRE003 pinned LHS source-versus-AOT observation.
 * All 45 source files are read-only; AOT builds run as independent CI steps.
 * Run "before" and then "after" around the two official Angular builds.
 * Never loads/evaluates project source or promotes static status to pass.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstat,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {analyzeAngularComponentWiring} from '../packages/angular-precompiler/src/component-wiring.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SNAPSHOT=path.join(ROOT,'.sac-snapshots','lhs');
const ANGULAR=path.join(SNAPSHOT,'games/lan_house_simulator/frontend-angular');
const SHA='c5139c2cc5088adc3bbf0bf85d2952e64e2fc5ac';
const EXPECTED_FILES=45;
const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const mode=process.argv[2];
assert.ok(['before','after'].includes(mode)&&process.argv.length===3,'pre003-lhs-invalid-mode');
const temp=process.env.RUNNER_TEMP;
assert.ok(temp&&path.isAbsolute(temp),'pre003-lhs-no-runner-temp');
const reportFile=path.join(temp,'sac-pre003-lhs-before.json');

function git(...args) {
  return execFileSync('git',['-C',SNAPSHOT,...args],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000
  }).trim();
}
assert.equal(git('rev-parse','HEAD'),SHA,'pre003-lhs-snapshot-sha-mismatch');
async function regular(file,max) {
  const info=await lstat(file);
  assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.size<=max,'pre003-lhs-nonregular-or-oversized');
  return readFile(file,'utf8');
}
async function collect() {
  const root=path.join(ANGULAR,'src'),files=[];
  let bytes=0,dirs=0;
  async function visit(dir) {
    assert.ok(++dirs<=128,'pre003-lhs-too-many-directories');
    const entries=(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries) {
      assert.ok(!entry.isSymbolicLink(),'pre003-lhs-symlink-rejected');
      const absolute=path.join(dir,entry.name);
      if(entry.isDirectory()) {await visit(absolute);continue;}
      assert.ok(entry.isFile(),'pre003-lhs-special-file-rejected');
      if(!/\.tsx?$/.test(entry.name)) continue;
      const relative=path.relative(ANGULAR,absolute).split(path.sep).join('/');
      assert.ok(relative.startsWith('src/')&&!relative.includes('..'),'pre003-lhs-outside-src');
      const source=await regular(absolute,512*1024);
      bytes+=Buffer.byteLength(source,'utf8');
      assert.ok(bytes<=2*1024*1024&&files.length<128,'pre003-lhs-source-limits');
      files.push({path:relative,source});
    }
  }
  await visit(root);
  assert.equal(files.length,EXPECTED_FILES,'pre003-lhs-inventory-drift');
  return files;
}
function aggregate(r) {
  const finding_codes={};
  for(const f of r.findings)finding_codes[f.code]=(finding_codes[f.code]??0)+1;
  return Object.fromEntries(Object.entries(finding_codes).sort(([a],[b])=>a.localeCompare(b)));
}
if(mode==='before') {
  const files=await collect();
  const r=analyzeAngularComponentWiring({files,typescript:ts});
  const reversed=analyzeAngularComponentWiring({files:[...files].reverse(),typescript:ts});
  assert.deepEqual(r,reversed,'pre003-lhs-determinism-failed');
  assert.equal(r.scope,'operator-enumerated-angular-component-metadata-only');
  assert.equal(r.aot_verified,false);
  assert.equal(r.deployment_authorized,false);
  assert.ok(r.components_checked>0,'pre003-lhs-no-angular-components');
  const report={
    schema_version:1,probe:'SAC-PRE003-LHS-PINNED-BEFORE-AOT',
    project:'lhs',source_commit:SHA,
    frontend_ts_sources:files.length,
    components_checked:r.components_checked,
    component_metadata_observed:r.component_metadata_observed,
    import_entries_checked:r.import_entries_checked,
    sac_status:r.status,
    finding_count:r.findings.length,
    finding_codes:aggregate(r),
    source_execution_verified:false,
    aot_verified:false,
    deployment_authorized:false
  };
  assert.ok(JSON.stringify(report).length<=2048);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}else{
  const prior=JSON.parse(await regular(reportFile,4096));
  assert.equal(prior.probe,'SAC-PRE003-LHS-PINNED-BEFORE-AOT');
  assert.equal(prior.source_commit,SHA);
  assert.equal(prior.frontend_ts_sources,EXPECTED_FILES);
  assert.equal(prior.aot_verified,false);
  assert.equal(prior.deployment_authorized,false);
  // Native Angular CLI writes compiled files only inside the disposable
  // checked-out snapshot; the upstream repository remains untouched.
  assert.equal(git('status','--porcelain','--','games/lan_house_simulator/frontend-angular/src'),
    '','pre003-lhs-tracked-source-changed');
  const builds=[];
  for(const name of ['game-ui','site-rewrite']) {
    const folder=path.join(ANGULAR,'dist',name,'browser');
    const entries=await readdir(folder,{withFileTypes:true});
    assert.ok(entries.some(x=>x.isFile()&&/^main(?:-[A-Za-z0-9]+)?\.js$/.test(x.name)),
      'pre003-lhs-angular-entry-bundle-missing');
    assert.ok(entries.some(x=>x.isFile()&&x.name==='index.html'),
      'pre003-lhs-angular-entry-html-missing');
    builds.push({app:name,bundled_entry_observed:true,aot_build_step_succeeded:true});
  }
  const result={
    schema_version:1,probe:'SAC-PRE003-LHS-PINNED-AOT-COMPARISON',
    project:'lhs',source_commit:SHA,frontend_ts_sources:EXPECTED_FILES,
    components_checked:prior.components_checked,
    component_metadata_observed:prior.component_metadata_observed,
    import_entries_checked:prior.import_entries_checked,
    sac_status:prior.sac_status,
    finding_codes:prior.finding_codes,
    builds,observational_concordance:prior.sac_status==='fail'?'conflict-investigate':'no-proven-contradiction',
    static_analysis_aot_verified:false,
    snapshot_two_aot_builds_verified:true,
    full_runtime_verified:false,production_aot_verified:false,
    root_cause_verified:false,deployment_authorized:false
  };
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  // Fail on a proven static error only AFTER emitting the comparative report.
  assert.notEqual(prior.sac_status,'fail','pre003-lhs-static-aot-contradiction');
}

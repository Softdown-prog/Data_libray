/**
 * SAC-PRE005 static expression evidence on a pinned LHS Angular source tree.
 * The snapshot is read-only, the parser comes from Data Library's official
 * Angular smoke fixture, and AOT is checked by a separate workflow step.
 * No source, HTML, raw compiler error or member name leaves this process.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstat,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {inspectAngularTemplateBindings} from '../packages/angular-precompiler/src/template-binding-evidence.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const checkout=path.join(root,'.sac-snapshots','lhs');
const angular=path.join(checkout,'games/lan_house_simulator/frontend-angular');
const pinned='c5139c2cc5088adc3bbf0bf85d2952e64e2fc5ac';
const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const angularCompiler=await import(pathToFileURL(require.resolve('@angular/compiler')).href);
const mode=process.argv[2],temp=process.env.RUNNER_TEMP;
assert.ok(['before','after'].includes(mode)&&process.argv.length===3,'pre005-lhs-invalid-mode');
assert.ok(temp&&path.isAbsolute(temp),'pre005-lhs-invalid-temp');
const previous=path.join(temp,'sac-pre005-lhs-bindings-before.json');
const verified=path.join(temp,'sac-pre004-lhs-template-aot.json');
const git=(...args)=>execFileSync('git',['-C',checkout,...args],{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000
}).trim();
assert.equal(git('rev-parse','HEAD'),pinned,'pre005-lhs-unexpected-revision');
async function bounded(p,max){
  const stat=await lstat(p);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max,
    'pre005-lhs-invalid-file');
  return readFile(p,'utf8');
}
async function collect(){
  const home=path.join(angular,'src'),files=[],templates=[];
  let dirs=0,bytes=0;
  async function visit(dir){
    assert.ok(++dirs<=128,'pre005-lhs-too-many-directories');
    const items=(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for(const item of items){
      assert.ok(!item.isSymbolicLink(),'pre005-lhs-no-symlinks');
      const absolute=path.join(dir,item.name);
      if(item.isDirectory()){await visit(absolute);continue;}
      assert.ok(item.isFile(),'pre005-lhs-special-file');
      if(!/\.(?:tsx?|html)$/.test(item.name))continue;
      const relative=path.relative(angular,absolute).split(path.sep).join('/');
      assert.ok(relative.startsWith('src/')&&!relative.includes('..'),'pre005-lhs-invalid-path');
      const source=await bounded(absolute,512*1024);
      bytes+=Buffer.byteLength(source,'utf8');
      assert.ok(bytes<=2*1024*1024,'pre005-lhs-too-many-bytes');
      if(/\.tsx?$/.test(item.name))files.push({path:relative,source});
      else templates.push({path:relative,source});
      assert.ok(files.length<=128&&templates.length<=128,'pre005-lhs-too-many-files');
    }
  }
  await visit(home);
  assert.equal(files.length,45,'pre005-lhs-ts-inventory-drift');
  assert.equal(templates.length,44,'pre005-lhs-html-inventory-drift');
  return {files,templates};
}
function tally(findings){
  const codes={};
  for(const f of findings)codes[f.code]=(codes[f.code]??0)+1;
  return Object.fromEntries(Object.entries(codes).sort(([a],[b])=>a.localeCompare(b)));
}
if(mode==='before'){
  const {files,templates}=await collect();
  const data={files,templates,typescript:ts,angularCompiler};
  const r=inspectAngularTemplateBindings(data);
  const backwards=inspectAngularTemplateBindings({
    files:[...files].reverse(),templates:[...templates].reverse(),typescript:ts,angularCompiler
  });
  assert.deepEqual(r,backwards,'pre005-lhs-nondeterministic-evidence');
  assert.equal(r.rule_id,'SAC-PRE005');
  assert.equal(r.status,'unverified');
  assert.equal(r.aot_verified,false);
  assert.equal(r.deployment_authorized,false);
  assert.equal(r.component_links_observed,43,'pre005-lhs-component-links-drift');
  assert.equal(r.external_templates_parsed,43,'pre005-lhs-template-parse-count-drift');
  const summary={
    schema_version:1,probe:'SAC-PRE005-LHS-BINDING-OBSERVATION-BEFORE-AOT',
    project:'lhs',source_commit:pinned,
    frontend_ts_files:files.length,frontend_html_files:templates.length,
    external_templates_parsed:r.external_templates_parsed,
    inline_templates_not_inspected:r.inline_templates_not_inspected,
    bound_events_observed:r.bound_events_observed,
    bound_properties_observed:r.bound_properties_observed,
    interpolations_observed:r.interpolations_observed,
    same_file_inherited_event_calls_observed:r.same_file_inherited_event_calls_observed,
    same_file_inherited_property_reads_observed:r.same_file_inherited_property_reads_observed,
    template_local_event_calls_observed:r.template_local_event_calls_observed,
    template_local_property_reads_observed:r.template_local_property_reads_observed,
    potential_event_handlers_not_declared_locally:r.potential_event_handlers_not_declared_locally,
    potential_property_bindings_not_declared_locally:r.potential_property_bindings_not_declared_locally,
    template_parser_error_count:r.template_parser_error_count,
    finding_codes:tally(r.findings),
    completeness:'partial-static-template-ast',
    status:'unverified',aot_verified:false,deployment_authorized:false
  };
  assert.ok(JSON.stringify(summary).length<=3072);
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
}else{
  const observed=JSON.parse(await bounded(previous,4096));
  const built=JSON.parse(await bounded(verified,8192));
  assert.equal(observed.probe,'SAC-PRE005-LHS-BINDING-OBSERVATION-BEFORE-AOT');
  assert.equal(observed.source_commit,pinned);
  assert.equal(observed.status,'unverified');
  assert.equal(observed.aot_verified,false);
  assert.equal(observed.deployment_authorized,false);
  assert.equal(built.probe,'SAC-PRE004-LHS-TEMPLATE-AOT-OBSERVATION');
  assert.equal(built.source_commit,pinned);
  assert.equal(built.project_aot_steps_succeeded,true);
  assert.deepEqual(built.angular_aot_builds_observed,['game-ui','site-rewrite']);
  assert.equal(built.deployment_authorized,false);
  assert.equal(git('status','--porcelain','--','games/lan_house_simulator/frontend-angular/src'),
    '','pre005-lhs-tracked-sources-changed');
  const report={
    schema_version:1,probe:'SAC-PRE005-LHS-BINDING-AOT-COMPARISON',
    project:'lhs',source_commit:pinned,
    frontend_ts_files:observed.frontend_ts_files,
    frontend_html_files:observed.frontend_html_files,
    external_templates_parsed:observed.external_templates_parsed,
    bound_events_observed:observed.bound_events_observed,
    bound_properties_observed:observed.bound_properties_observed,
    interpolations_observed:observed.interpolations_observed,
    same_file_inherited_event_calls_observed:observed.same_file_inherited_event_calls_observed,
    same_file_inherited_property_reads_observed:observed.same_file_inherited_property_reads_observed,
    template_local_event_calls_observed:observed.template_local_event_calls_observed,
    template_local_property_reads_observed:observed.template_local_property_reads_observed,
    potential_event_handlers_not_declared_locally:observed.potential_event_handlers_not_declared_locally,
    potential_property_bindings_not_declared_locally:observed.potential_property_bindings_not_declared_locally,
    template_parser_error_count:observed.template_parser_error_count,
    finding_codes:observed.finding_codes,
    official_aot_builds_observed:['game-ui','site-rewrite'],
    observational_concordance:observed.template_parser_error_count===0
      ?'no-proven-syntax-contradiction':'parser-errors-need-investigation',
    static_status:'unverified',
    complete_template_typecheck_verified:false,
    production_aot_verified:false,runtime_verified:false,
    deployment_authorized:false
  };
  assert.ok(JSON.stringify(report).length<=3072);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  // Parser errors on any enumerated (potentially unused) template deserve a
  // failure/investigation even if two particular app entrypoints built.
  assert.equal(observed.template_parser_error_count,0,'pre005-lhs-parser-aot-divergence');
}

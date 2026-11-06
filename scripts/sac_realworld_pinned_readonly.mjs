/**
 * Pinned third-party Angular RealWorld read-only scan with genuine SAC-PRE001..005.
 * Never loads third-party application modules, installs its dependencies or runs it.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {lstat,readdir,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyWorkspace} from '../packages/angular-precompiler/src/index.mjs';
import {analyzeImportGraph} from '../packages/angular-precompiler/src/dependency-graph.mjs';
import {analyzeAngularComponentWiring} from '../packages/angular-precompiler/src/component-wiring.mjs';
import {inspectAngularTemplateLinks} from '../packages/angular-precompiler/src/template-links.mjs';
import {inspectAngularTemplateBindings} from '../packages/angular-precompiler/src/template-binding-evidence.mjs';

const PIN='d426ec804f7d035c374aa4a1b48ecdb05a03eb02';
const root=path.resolve(fileURLToPath(new URL('../.sac-snapshots/realworld-angular/',import.meta.url)));
const trusted=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=trusted('typescript');
const ng=await import(pathToFileURL(trusted.resolve('@angular/compiler')).href);
const maxFiles=128,maxBytes=2*1024*1024;
const files=[],templates=[];
let size=0,dirs=0;
async function visit(folder){
 assert.ok(++dirs<=128,'directory-limit');
 const entries=(await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
 for(const entry of entries){
  const abs=path.join(folder,entry.name);
  assert.ok(!entry.isSymbolicLink(),'symlink-input');
  if(entry.isDirectory()){await visit(abs);continue;}
  assert.ok(entry.isFile(),'special-input');
  const target=/\.tsx?$/.test(entry.name)?files:/\.html$/.test(entry.name)?templates:null;
  if(target===null)continue;
  const stat=await lstat(abs);
  assert.ok(stat.isFile()&&stat.nlink===1&&stat.size<=512*1024,'file-limit');
  size+=stat.size;
  assert.ok(files.length+templates.length<maxFiles&&size<=maxBytes,'total-limit');
  const name=path.relative(root,abs).split(path.sep).join('/');
  assert.match(name,/^src\/[A-Za-z0-9_./-]+\.(?:tsx?|html)$/);
  target.push({path:name,source:await readFile(abs,'utf8')});
 }
}
const physical=await realpath(root);
assert.equal(physical,root,'snapshot-root-must-be-physical');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
assert.equal(pkg.dependencies['@angular/core'],'21.2.12');
assert.equal(pkg.devDependencies['@angular/compiler-cli'],'21.2.12');
await visit(path.join(root,'src'));
assert.equal(files.length,48,'pinned-ts-source-count');
assert.equal(templates.length,11,'pinned-html-source-count');
const installed=await verifyWorkspace({workspace:root,angularVersion:'21.2.12'});
const graph=analyzeImportGraph({
 files,typescript:ts,
 policy:{layers:[],allowImports:{},external:['@angular/','@rx-angular/','rxjs',
  'rxjs/','marked','tslib','vitest','@playwright/','jsdom']},
 tsconfig:{path:'tsconfig.json',text:await readFile(path.join(root,'tsconfig.json'),'utf8')}
});
const wiring=analyzeAngularComponentWiring({files,typescript:ts});
const linking=inspectAngularTemplateLinks({files,templates,typescript:ts});
const binding=inspectAngularTemplateBindings({files,templates,typescript:ts,angularCompiler:ng});
assert.equal(installed.rule_id,'SAC-PRE001');
for(const r of [graph,wiring,linking,binding])assert.equal(r.deployment_authorized,false);
assert.equal(graph.nodes.length,48);
assert.ok(wiring.components_checked>0,'no-observed-component');
assert.ok(linking.external_templates_linked>0,'no-observed-linked-template');
assert.ok(binding.templates_total_parsed>0,'no-parsed-angular-template');
// In-memory negative mutation of the REAL root component. No repository writes.
const marker="import { RouterOutlet } from '@angular/router';";
const original=files.find(x=>x.path==='src/app/app.component.ts');
assert.ok(original?.source.includes(marker),'realworld-source-drift');
const mutated=files.map(x=>x===original?{...x,source:x.source.replace(marker,
 "import type { RouterOutlet } from '@angular/router';")}:x);
const negative=analyzeAngularComponentWiring({files:mutated,typescript:ts});
assert.equal(negative.status,'fail');
assert.ok(negative.findings.some(x=>x.code==='component-import-is-type-only'),
 'controlled-defect-missed');
const counts=findings=>{
 const out=Object.create(null);
 for(const f of findings||[]){
  if(typeof f.code==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(f.code))
   out[f.code]=(out[f.code]??0)+1;
 }
 return Object.fromEntries(Object.entries(out).sort((a,b)=>a[0].localeCompare(b[0],'en')));
};
const report={
 schema_version:1,kind:'realworld-angular-external-pinned-static',
 repository:'realworld-apps/angular-realworld-example-app',
 source_sha:PIN,angular_version:'21.2.12',lockfile:'bun',
 source_files:{typescript:files.length,html:templates.length,bytes:size},
 preflight:{status:installed.status,diagnostics:(installed.evidence||[])
  .map(x=>({assertion:x.assertion,status:x.status,code:x.code}))},
 graph:{status:graph.status,nodes:graph.nodes.length,edges:graph.edges.length,findings:counts(graph.findings)},
 components:{status:wiring.status,checked:wiring.components_checked,findings:counts(wiring.findings)},
 templates:{status:linking.status,linked:linking.external_templates_linked,findings:counts(linking.findings)},
 bindings:{status:binding.status,parsed:binding.templates_total_parsed,parser_errors:binding.template_parser_error_count,
  events:binding.bound_events_observed,properties:binding.bound_properties_observed,findings:counts(binding.findings)},
 negative_control:{rule:'SAC-PRE003',code:'component-import-is-type-only',observed:true,status:'pass'},
 source_only:true,third_party_executed:false,
 official_build:'not-run',app_tests:'not-run',browser:'not-run',
 overall:'unverified',deployment_authorized:false
};
process.stdout.write(JSON.stringify(report)+'\n');

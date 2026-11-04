import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,unlink,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {verifyAngularIslands} from '../packages/angular-postcompiler/src/angular-islands.mjs';

const contract=()=>({
 schema_version:1,index:'index.html',mount:'/dashboard/',
 host_ids:['billing-host','report-host'],
 required_elements:[{tag:'main',id:'workspace'}],
 forbidden_tags:['legacy-app'],
 entrypoint_scripts:['modules/ui.js'],
 allowed_resources:['modules/ui.js','css/main.css','modules/data.js'],
 required_resources:['modules/ui.js','css/main.css'],
 required_files:['modules/data.js'],
 query_policy:'none'
});
const html=()=>[
 '<!doctype html><main id="workspace">',
 '<div id="billing-host"></div><section id="report-host"></section>',
 '</main><script type="module" src="./modules/ui.js"></script>',
 '<link rel="stylesheet" href="./css/main.css">'
].join('');
async function fixture(t,override){
 const dist=await mkdtemp(path.join(os.tmpdir(),'sac-generic-islands-'));
 t.after(()=>rm(dist,{recursive:true,force:true}));
 await mkdir(path.join(dist,'modules'));
 await mkdir(path.join(dist,'css'));
 const put=(p,data)=>writeFile(path.join(dist,p),data);
 await put('index.html',override??html());
 await put('modules/ui.js','export const name="ui";');
 await put('modules/data.js','export const name="data";');
 await put('css/main.css','main{display:block}');
 return {dist,put};
}
test('independent dashboard project supports div and section hosts without LHS naming',async t=>{
 const f=await fixture(t);
 const r=await verifyAngularIslands(f.dist,contract());
 assert.deepEqual(r,await verifyAngularIslands(f.dist,contract()));
 assert.equal(r.rule_id,'SAC-P001-ISLAND-EXT');
 assert.equal(r.status,'pass');
 assert.equal(r.host_count,2);
 assert.equal(r.entrypoint_count,1);
 assert.equal(r.p001_v1_covered,false);
 assert.equal(r.runtime_mount_verified,false);
 assert.equal(r.deployment_authorized,false);
 assert.ok(JSON.stringify(r).length<1024);
});
test('HTML omitted, duplicate and inert template hosts fail closed',async t=>{
 const a=await fixture(t,html().replace('<div id="billing-host"></div>',''));
 assert.equal((await verifyAngularIslands(a.dist,contract())).code,'host-id-coverage-invalid');
 const b=await fixture(t,html()+'<div id="report-host"></div>');
 assert.equal((await verifyAngularIslands(b.dist,contract())).code,'duplicate-dom-id');
 const c=await fixture(t,html().replace('<div id="billing-host"></div>',
  '<template><div id="billing-host"></div></template>'));
 assert.equal((await verifyAngularIslands(c.dist,contract())).code,'host-id-coverage-invalid');
});
test('unexpected, forbidden and missing native DOM elements are denied',async t=>{
 const a=await fixture(t,html().replace('<main id="workspace">','<div id="workspace">'));
 assert.equal((await verifyAngularIslands(a.dist,contract())).code,'required-element-missing');
 const b=await fixture(t,html()+'<legacy-app></legacy-app>');
 assert.equal((await verifyAngularIslands(b.dist,contract())).code,'forbidden-tag');
});
test('unlisted and external scripts cannot pass as Angular entrypoint',async t=>{
 for(const uri of ['./modules/other.js','../private.js','https://attacker.invalid/ui.js',
   './modules/%75i.js','//attacker.invalid/ui.js']){
  const f=await fixture(t,html().replace('./modules/ui.js',uri));
  assert.equal((await verifyAngularIslands(f.dist,contract())).status,'fail');
 }
});
test('missing asset, script as CSS and inline JavaScript are denied',async t=>{
 const f=await fixture(t);await unlink(path.join(f.dist,'modules/ui.js'));
 assert.equal((await verifyAngularIslands(f.dist,contract())).code,'resource-missing');
 const g=await fixture(t,html().replace('rel="stylesheet"','rel="stylesheet" data-safe="1"')
   .replace('href="./css/main.css"','href="./modules/ui.js"'));
 assert.equal((await verifyAngularIslands(g.dist,contract())).code,'resource-type-invalid');
 const h=await fixture(t,html()+'<script>alert("x")</script>');
 assert.equal((await verifyAngularIslands(h.dist,contract())).code,'inline-or-missing-resource');
});
test('remote base and query mutation require explicit local policy',async t=>{
 const f=await fixture(t,'<base href="https://attacker.invalid/">'+html());
 assert.equal((await verifyAngularIslands(f.dist,contract())).code,'base-href-invalid');
 const g=await fixture(t,html().replace('./modules/ui.js','./modules/ui.js?v=123456789abc'));
 assert.equal((await verifyAngularIslands(g.dist,contract())).status,'fail');
 const v={...contract(),query_policy:'hex12'};
 assert.equal((await verifyAngularIslands(g.dist,v)).status,'pass');
 const h=await fixture(t,html().replace('./modules/ui.js','./modules/ui.js?v=untrusted'));
 assert.equal((await verifyAngularIslands(h.dist,v)).status,'fail');
});
test('unsafe contract, duplicate ids and free-form fields fail without leaking input',async t=>{
 const f=await fixture(t);
 for(const c of [
  {...contract(),cmd:'cat ~/.ssh/id_rsa'},
  {...contract(),host_ids:['billing-host','billing-host']},
  {...contract(),allowed_resources:['../secrets.js']},
  {...contract(),entrypoint_scripts:['not-listed.js']},
  {...contract(),mount:'/app/../'},
  {...contract(),required_elements:[{tag:'script',id:'billing-host'}]},
  {...contract(),query_policy:'arbitrary'}
 ]){
  const result=await verifyAngularIslands(f.dist,c);
  assert.equal(result.status,'fail');
  assert.equal(result.deployment_authorized,false);
  assert.ok(!JSON.stringify(result).includes('id_rsa'));
 }
});
test('symlinks escaping dist fail closed without reading source files',async t=>{
 const f=await fixture(t);
 const external=await mkdtemp(path.join(os.tmpdir(),'sac-island-external-'));
 t.after(()=>rm(external,{recursive:true,force:true}));
 await writeFile(path.join(external,'ui.js'),'export const leaked=true;');
 await unlink(path.join(f.dist,'modules/ui.js'));
 await symlink(path.join(external,'ui.js'),path.join(f.dist,'modules/ui.js'));
 assert.equal((await verifyAngularIslands(f.dist,contract())).code,'resource-outside-dist');
});
test('resource files must be regular, nonempty and under budget',async t=>{
 const f=await fixture(t);
 await writeFile(path.join(f.dist,'modules/data.js'),'');
 const status=await verifyAngularIslands(f.dist,contract());
 assert.equal(status.status,'fail');
 assert.equal(status.code,'resource-budget-or-type-invalid');
});

/**
 * Pinned LHS postflight. Site uses the real SAC-P001 Core rule; game Angular
 * islands use a separate, explicitly scoped static check because SAC-P001 v1
 * only supports custom-element hosts, not native DIV mount targets.
 * No shell/network/writes; no deployment or gameplay assertions.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import {realpath,lstat,readFile} from 'node:fs/promises';
import {parse} from 'parse5';
import {RuleRegistry,execute} from '../../angular-core/src/index.mjs';
import {registerSACP001} from '../../angular-core/src/sac-p001.mjs';

const ids=[
  'angular-save-transfer','angular-menu-preferences','angular-notice-inbox',
  'angular-time-weather','angular-player-account','angular-shop-overview',
  'angular-shop-catalog','angular-stock-workspace','angular-merchandise-catalog',
  'angular-finance-workspace','angular-prices-workspace','angular-licenses-workspace',
  'angular-consoles-workspace'
];
const refFiles=[
  'js/privacyConsent.js','__angular/main.js','style.css','__angular/styles.css',
  'js/main.js'
];
const hashed=/^(?:[a-z][a-z0-9_-]*-)[a-z0-9]{6,}\.(?:js|css)$/i;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=code=>{throw new Error('sac-lhs-postflight-'+code);};
const manifestName=/^[a-z][a-z0-9_-]*-[a-z0-9]{6,}\.(?:js|css)$/i;
const attr=(node,name)=>node.attrs?.find(x=>x.name===name)?.value;
async function boundedFile(root,rel,limit=16*1024*1024){
  if(!refFiles.includes(rel)&&rel!=='index.html'&&rel!=='angular-site-assets.json')
    fail('unapproved-file');
  const file=path.join(root,rel),canonical=await realpath(file);
  if(!canonical.startsWith(root+path.sep))fail('path-outside-dist');
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size===0||info.size>limit)
    fail('resource-invalid');
  return readFile(file);
}
function documents(html){
  const nodes=[];
  const walk=n=>{
    nodes.push(n);
    // Template content is inert and intentionally excluded from mounted hosts.
    if(n.tagName==='template')return;
    for(const child of n.childNodes??[])walk(child);
  };
  walk(parse(html));
  return nodes;
}
function nativeReference(reference){
  if(typeof reference!=='string'||reference.length>180||
     /[\\%\x00-\x20\x7f]/.test(reference))fail('url-unsafe');
  let resolved;
  try {resolved=new URL(reference,'https://sac.invalid/game/');}
  catch{fail('url-invalid');}
  if(resolved.origin!=='https://sac.invalid'||!resolved.pathname.startsWith('/game/'))
    fail('url-outside-game-mount');
  const relative=resolved.pathname.slice('/game/'.length);
  if(!refFiles.includes(relative))fail('unexpected-game-reference');
  if(resolved.hash)fail('fragment-unsupported');
  if(resolved.search&&!/^\?v=[a-f0-9]{12}$/.test(resolved.search))
    fail('revision-unrecognized');
  return relative;
}
function safeManifest(manifest){
  if(!plain(manifest)||Object.keys(manifest).sort().join(',')!=='files,main,styles,version'||
     manifest.version!==1||!Array.isArray(manifest.files)||
     manifest.files.length<2||manifest.files.length>79||
     !manifest.files.every(x=>typeof x==='string'&&manifestName.test(x))||
     new Set(manifest.files).size!==manifest.files.length||
     !/^main-[a-z0-9]{6,}\.js$/i.test(manifest.main??'')||
     !/^styles-[a-z0-9]{6,}\.css$/i.test(manifest.styles??'')||
     !manifest.files.includes(manifest.main)||!manifest.files.includes(manifest.styles))
    fail('manifest-invalid');
}
export async function verifyLhsAngularScopes(dist){
  const root=await realpath(dist);
  const manifest=JSON.parse((await boundedFile(root,'angular-site-assets.json',16384)).toString('utf8'));
  safeManifest(manifest);
  const siteProfile={
    schema_version:1,profile_id:'lhs-pinned-site-postflight',
    angular_version:'22.2.4',capabilities:['angular','static-dist'],
    mode:'angular-only',mount:'/',
    bundle_hints:{
      index:'index.html',angular_host:'lhs-site',
      angular_entrypoints:['assets/site/'+manifest.main],
      assets:['assets/site/'+manifest.styles],
      legacy_react_entrypoints:['js/react-entry.js','assets/site/react-entry.js']
    },
    rules:[{rule_id:'SAC-P001',version:'1.0.0',required:true,enforcement:'blocking'}]
  };
  const site=await execute({
    registry:registerSACP001(new RuleRegistry()),
    profile:siteProfile,
    resources:{dist:root}
  });
  if(site.status!=='pass'||site.promotion_allowed!==true||
     site.results.length!==1||site.results[0].status!=='pass')
    fail('site-sac-p001-not-passed');
  const game=await realpath(path.join(root,'game'));
  if(game!==path.join(root,'game'))fail('game-symlink-unsupported');
  const html=(await boundedFile(game,'index.html',2*1024*1024)).toString('utf8');
  const nodes=documents(html);
  const counts=new Map();
  for(const n of nodes){
    const id=attr(n,'id');
    if(id)counts.set(id,(counts.get(id)??0)+1);
  }
  if(ids.some(id=>counts.get(id)!==1)||[...counts.values()].some(n=>n>1))
    fail('game-island-id-coverage-failed');
  if(nodes.some(n=>n.tagName==='lhs-site'))fail('game-site-root-duplicated');
  if(!nodes.some(n=>n.tagName==='canvas'&&attr(n,'id')==='game'))
    fail('native-game-canvas-missing');
  const refs=[];
  for(const n of nodes){
    const isScript=n.tagName==='script';
    const isCss=n.tagName==='link'&&(attr(n,'rel')??'').toLowerCase()==='stylesheet';
    if(!isScript&&!isCss)continue;
    const raw=attr(n,isScript?'src':'href');
    if(!raw)fail('inline-or-empty-game-resource');
    if(isScript&&!['module','text/javascript','application/javascript',''].includes(
      (attr(n,'type')??'').toLowerCase()))fail('game-script-type-unsupported');
    const value=nativeReference(raw);
    if(isScript&&!value.endsWith('.js')||isCss&&!value.endsWith('.css'))
      fail('game-resource-type-mismatch');
    refs.push(value);
  }
  if(new Set(refs).size!==refs.length||
     !['__angular/main.js','__angular/styles.css','style.css','js/privacyConsent.js']
       .every(x=>refs.includes(x))||
     refs.includes('js/react-entry.js')||
     !nodes.some(n=>n.tagName==='script'&&nativeReference(attr(n,'src')??'')==='__angular/main.js'))
    fail('game-entrypoint-incomplete');
  for(const resource of refFiles)await boundedFile(game,resource);
  // The asset presence is structural evidence. It cannot certify app state.
  const result={
    schema_version:1,report_type:'sac-p001-lhs-scoped-static',
    site:{rule_id:'SAC-P001',status:'pass',mount:'/',angular_host:'lhs-site',
      angular_entrypoint_observed:true},
    game:{rule_id:'SAC-P001-ISLAND-EXT',status:'pass',mount:'/game/',
      angular_island_count:ids.length,canvas_present:true,
      angular_entrypoint_observed:true,legacy_react_entrypoint_absent:true},
    root_p001_game_status:'not-applicable',
    complete_sac_pipeline_approved:false,deployment_authorized:false
  };
  assert.ok(JSON.stringify(result).length<2048);
  return result;
}

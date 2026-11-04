/**
 * Pinned LHS postflight. Site uses the real SAC-P001 Core rule; game Angular
 * islands use a separate, explicitly scoped static check because SAC-P001 v1
 * only supports custom-element hosts, not native DIV mount targets.
 * No shell/network/writes; no deployment or gameplay assertions.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import {realpath,lstat,readFile} from 'node:fs/promises';
import {verifyAngularIslands} from './angular-islands.mjs';
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
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=code=>{throw new Error('sac-lhs-postflight-'+code);};
const manifestName=/^[a-z][a-z0-9_-]*-[a-z0-9]{6,}\.(?:js|css)$/i;
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
  const island=await verifyAngularIslands(game,{
    schema_version:1,index:'index.html',mount:'/game/',
    host_ids:ids,
    required_elements:[{tag:'canvas',id:'game'}],forbidden_tags:['lhs-site'],
    entrypoint_scripts:['__angular/main.js'],
    allowed_resources:refFiles,
    required_resources:[
      '__angular/main.js','__angular/styles.css','style.css','js/privacyConsent.js'
    ],
    required_files:refFiles,query_policy:'hex12'
  });
  if(island.status!=='pass'){
    const mapped={
      'host-id-coverage-invalid':'game-island-id-coverage-failed',
      'duplicate-dom-id':'game-island-id-coverage-failed',
      'required-element-missing':'native-game-canvas-missing',
      'resource-not-allowed':'unexpected-game-reference',
      'inline-or-missing-resource':'inline-or-empty-game-resource'
    };
    fail(mapped[island.code]??'game-island-'+(island.code??'infra-error'));
  }
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {verifyLhsAngularScopes} from '../packages/angular-postcompiler/src/lhs-scoped-postflight.mjs';

const islands=[
 'angular-save-transfer','angular-menu-preferences','angular-notice-inbox',
 'angular-time-weather','angular-player-account','angular-shop-overview',
 'angular-shop-catalog','angular-stock-workspace','angular-merchandise-catalog',
 'angular-finance-workspace','angular-prices-workspace','angular-licenses-workspace',
 'angular-consoles-workspace'
];
function site(){return '<!doctype html><base href="/"><lhs-site></lhs-site>'+
 '<script type="module" src="/assets/site/main-a1b2c3.js"></script>'+
 '<link rel="stylesheet" href="/assets/site/styles-a1b2c3.css">';}
function game(){return '<!doctype html><link rel="stylesheet" href="./style.css">'+
 '<link rel="stylesheet" href="./__angular/styles.css">'+
 '<link rel="stylesheet" href="./__angular/compatibility.css">'+
 '<script type="module" src="./js/privacyConsent.js"></script>'+
 '<script type="module" src="./__angular/main.js"></script>'+
 islands.map(id=>'<div id="'+id+'"></div>').join('')+
 '<canvas id="game"></canvas>';}
async function fixture(t){
 const dist=await mkdtemp(path.join(os.tmpdir(),'sac-lhs-scoped-'));
 t.after(()=>rm(dist,{recursive:true,force:true}));
 const siteAssets=path.join(dist,'assets/site'),angular=path.join(dist,'game/__angular'),
   native=path.join(dist,'game/js');
 await Promise.all([mkdir(siteAssets,{recursive:true}),mkdir(angular,{recursive:true}),
   mkdir(native,{recursive:true})]);
 const create=async(rel,content)=>writeFile(path.join(dist,rel),content);
 const manifest={version:1,main:'main-a1b2c3.js',styles:'styles-a1b2c3.css',
   files:['main-a1b2c3.js','styles-a1b2c3.css']};
 for(const [file,content] of Object.entries({
  'angular-site-assets.json':JSON.stringify(manifest),
  'index.html':site(),
  'assets/site/main-a1b2c3.js':'export const site=true',
  'assets/site/styles-a1b2c3.css':'body{margin:0}',
  'game/index.html':game(),
  'game/__angular/main.js':'export const ui=true',
  'game/__angular/styles.css':'body{margin:0}',
  'game/__angular/compatibility.css':'#shop-catalog{display:none!important}',
  'game/style.css':'body{margin:0}',
  'game/js/privacyConsent.js':'export const consent=true',
  'game/js/main.js':'export const game=true'
 })) await create(file,content);
 return {dist,create};
}
test('SAC-P001 site and bounded island extension independently pass without deployment',async t=>{
 const {dist}=await fixture(t);
 const out=await verifyLhsAngularScopes(dist);
 assert.deepEqual(out,await verifyLhsAngularScopes(dist));
 assert.equal(out.site.rule_id,'SAC-P001');
 assert.equal(out.site.status,'pass');
 assert.equal(out.game.rule_id,'SAC-P001-ISLAND-EXT');
 assert.equal(out.game.status,'pass');
 assert.equal(out.game.angular_island_count,13);
 assert.equal(out.root_p001_game_status,'not-applicable');
 assert.equal(out.complete_sac_pipeline_approved,false);
 assert.equal(out.deployment_authorized,false);
 assert.ok(JSON.stringify(out).length<2048);
});
test('site without custom Angular host cannot pass SAC-P001',async t=>{
 const f=await fixture(t);
 await f.create('index.html',site().replace('<lhs-site></lhs-site>',''));
 await assert.rejects(verifyLhsAngularScopes(f.dist),/site-sac-p001-not-passed/);
});
test('site bundle missing or moved outside mount is not approved',async t=>{
 const f=await fixture(t);
 await unlink(path.join(f.dist,'assets/site/main-a1b2c3.js'));
 await assert.rejects(verifyLhsAngularScopes(f.dist),/site-sac-p001-not-passed/);
 const g=await fixture(t);
 await g.create('index.html',site().replace('/assets/site/main-a1b2c3.js','https://elsewhere.invalid/main.js'));
 await assert.rejects(verifyLhsAngularScopes(g.dist),/site-sac-p001-not-passed/);
});
test('missing, duplicated and inert island hosts fail closed',async t=>{
 const f=await fixture(t);
 await f.create('game/index.html',game().replace('<div id="angular-save-transfer"></div>',''));
 await assert.rejects(verifyLhsAngularScopes(f.dist),/game-island-id-coverage-failed/);
 const g=await fixture(t);
 await g.create('game/index.html',game()+'<div id="angular-save-transfer"></div>');
 await assert.rejects(verifyLhsAngularScopes(g.dist),/game-island-id-coverage-failed/);
 const h=await fixture(t);
 await h.create('game/index.html',game().replace('<div id="angular-save-transfer"></div>',
  '<template><div id="angular-save-transfer"></div></template>'));
 await assert.rejects(verifyLhsAngularScopes(h.dist),/game-island-id-coverage-failed/);
});
test('missing canvas and React reintroduction do not pass',async t=>{
 const f=await fixture(t);
 await f.create('game/index.html',game().replace('<canvas id="game"></canvas>',''));
 await assert.rejects(verifyLhsAngularScopes(f.dist),/native-game-canvas-missing/);
 const g=await fixture(t);
 await g.create('game/index.html',game()+'<script type="module" src="./js/react-entry.js"></script>');
 await assert.rejects(verifyLhsAngularScopes(g.dist),/unexpected-game-reference/);
});
test('game references reject traversal, external URLs and unapproved cache queries',async t=>{
 for(const from of ['../secret.js','https://invalid.example/x.js',
   './__angular/main.js?v=untrusted']){
   const f=await fixture(t);
   await f.create('game/index.html',game().replace('./__angular/main.js',from));
   await assert.rejects(verifyLhsAngularScopes(f.dist));
 }
});
test('manifest mismatches and tampered game files cannot pass',async t=>{
 const f=await fixture(t);
 await f.create('angular-site-assets.json',JSON.stringify({
  version:1,main:'../../main.js',styles:'styles-a1b2c3.css',
  files:['../../main.js','styles-a1b2c3.css']
 }));
 await assert.rejects(verifyLhsAngularScopes(f.dist),/manifest-invalid/);
 const g=await fixture(t);
 await unlink(path.join(g.dist,'game/js/main.js'));
 await assert.rejects(verifyLhsAngularScopes(g.dist));
});
test('inline executable scripts are never mistaken for approved Angular bootstrap',async t=>{
 const f=await fixture(t);
 await f.create('game/index.html',game()+'<script>window.malicious=1</script>');
 await assert.rejects(verifyLhsAngularScopes(f.dist),/inline-or-empty-game-resource/);
});

test('externalized compatibility CSS is explicitly required and bounded',async t=>{
 const f=await fixture(t);
 await unlink(path.join(f.dist,'game/__angular/compatibility.css'));
 await assert.rejects(verifyLhsAngularScopes(f.dist),/game-island-|sac-lhs-postflight/);
 const g=await fixture(t);
 await g.create('game/index.html',game()+
  '<link rel="stylesheet" href="./__angular/arbitrary.css">');
 await assert.rejects(verifyLhsAngularScopes(g.dist),/unexpected-game-reference/);
});

/**
 * SAC-PRE002: isolated Chromium verification of two LHS runtime imports.
 * Pinned source, compiled static files, loopback only, no auth/payment clicks,
 * no deployment. The game boot is observed, not exercised with interactions.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {lstat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(new URL('../packages/angular-guardian/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const snapshot=path.join(root,'.sac-snapshots','lhs');
const output=path.join(snapshot,'games/lan_house_simulator/out/site-clean-angular');
const pinned='db639a117024b2e14c4af844bfb69b90bef5da20';
const revision=execFileSync('git',['-C',snapshot,'rev-parse','HEAD'],
  {encoding:'utf8',timeout:5000}).trim();
assert.equal(revision,pinned,'sac-browser-unexpected-source-revision');
const cspText=await readFile(path.join(output,'_headers'),'utf8');
const csp=cspText.match(/^\s+Content-Security-Policy:\s*(.+)$/m)?.[1]?.trim();
assert.ok(csp && /script-src\s+'self'/.test(csp) && /object-src\s+'none'/.test(csp),
  'sac-browser-source-csp-missing');
const mime={
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.webp':'image/webp',
  '.png':'image/png',
  '.woff2':'font/woff2',
  '.txt':'text/plain; charset=utf-8'
};
const sha=x=>createHash('sha256').update(x).digest('hex');
const tracked={
  '/game/js/main.js':'a3206e92f6af5934f80c11f39f32ff62c0d8728077626d06e8b81bf647f10bab',
  '/game/js/sim/saveTransfer.js':'97a78a0494d7b5b2dcb59431046c016ab2a756ec80955dc0af5a8031dda4c3d6'
};
for(const [url,digest] of Object.entries(tracked)){
  const bytes=await readFile(path.join(output,url.slice(1)));
  assert.equal(sha(bytes),digest,'sac-browser-native-module-content-drift');
}

const probePath='/__sac__/probe';
const server=createServer(async (req,res)=>{
  try {
    if (req.method!=='GET' && req.method!=='HEAD') {res.writeHead(405).end();return;}
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if (pathname===probePath) {
      const body='<!doctype html><html><head><meta charset="utf-8"></head><body>Module probe</body></html>';
      res.writeHead(200,{'Content-Type':mime['.html'],'Content-Security-Policy':csp,
        'Cache-Control':'no-store'}).end(req.method==='HEAD'?'':body);return;
    }
    if (pathname.includes('%') || pathname.includes('\\') ||
        pathname.startsWith('/.') || pathname.includes('/..') ||
        pathname==='/_headers') {res.writeHead(404).end();return;}
    const relative=(pathname.endsWith('/')?pathname+'index.html':pathname).slice(1);
    const resolved=path.resolve(output,relative);
    if (!resolved.startsWith(output+path.sep)) {res.writeHead(404).end();return;}
    const st=await lstat(resolved);
    if (!st.isFile() || st.isSymbolicLink() || st.size>8*1024*1024) {
      res.writeHead(404).end();return;
    }
    const type=mime[path.extname(resolved)];
    if (!type){res.writeHead(415).end();return;}
    const body=await readFile(resolved);
    res.writeHead(200,{'Content-Type':type,'Content-Security-Policy':csp,
      'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?'':body);
  } catch {res.writeHead(404).end();}
});
await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
});
const address=server.address();
const origin='http://127.0.0.1:'+address.port;
const browser=await chromium.launch({headless:true,args:['--disable-background-networking']});
let blockedExternal=0;
async function isolated(){
  const ctx=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,
    permissions:[],viewport:{width:1280,height:720}});
  await ctx.route('**/*',route=>{
    const requestUrl=route.request().url();
    if (/^https?:\/\//.test(requestUrl) && new URL(requestUrl).origin!==origin) {
      blockedExternal++;
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  return ctx;
}
async function checkTarget(url){
  const ctx=await browser.newContext();
  try {
    const response=await ctx.request.get(origin+url,{timeout:12000});
    const body=await response.body();
    assert.equal(response.status(),200,'sac-browser-module-404');
    assert.match(response.headers()['content-type']??'',/^text\/javascript/,'sac-browser-invalid-module-mime');
    assert.match(response.headers()['content-security-policy']??'',/script-src\s+'self'/,
      'sac-browser-module-csp-not-applied');
    assert.equal(sha(body),tracked[url],'sac-browser-module-sha-mismatch');
    return {status:response.status(),javascript_mime:true,csp_header:true,sha256:tracked[url]};
  } finally {await ctx.close();}
}
let report;
try {
  const canvasHttp=await checkTarget('/game/js/main.js');
  const saveHttp=await checkTarget('/game/js/sim/saveTransfer.js');
  const gameContext=await isolated();
  const gamePage=await gameContext.newPage();
  const pageErrors=[];
  gamePage.on('pageerror',e=>pageErrors.push(e.name));
  const nativeRequest=gamePage.waitForResponse(
    x=>new URL(x.url()).pathname==='/game/js/main.js', {timeout:20000});
  const navigation=await gamePage.goto(origin+'/game/',{waitUntil:'domcontentloaded',timeout:20000});
  assert.equal(navigation?.status(),200,'sac-browser-game-navigation-failed');
  const nativeResponse=await nativeRequest;
  assert.equal(nativeResponse.status(),200,'sac-browser-canvas-import-response-failed');
  assert.match(nativeResponse.headers()['content-type']??'',/^text\/javascript/,
    'sac-browser-canvas-import-mime-failed');
  await gamePage.waitForFunction(
    () => document.documentElement.dataset['uiFramework']==='angular',
    null, {timeout:20000});
  // No game controls are clicked; Angular bootstrap triggers native Canvas load.
  await gamePage.waitForTimeout(800);
  assert.deepEqual(pageErrors,[],'sac-browser-game-bootstrap-pageerrors');
  const game={navigation_status:navigation.status(),angular_bootstrap:true,
    canvas_dynamic_request_observed:true,canvas_response_status:nativeResponse.status(),
    pageerror_count:pageErrors.length,...canvasHttp};
  await gameContext.close();

  const saveContext=await isolated();
  const savePage=await saveContext.newPage();
  await savePage.goto(origin+probePath,{waitUntil:'domcontentloaded'});
  const saveName=await savePage.evaluate(async()=>{
    const m=await import('/game/js/sim/saveTransfer.js');
    return typeof m.parseImportedSave;
  });
  assert.equal(saveName,'function','sac-browser-save-validator-export-missing');
  await saveContext.close();

  async function negative(mode){
    const ctx=await isolated();
    const page=await ctx.newPage();
    if(mode==='csp'){
      await page.route('**/__sac__/probe',async route=>{
        await route.fulfill({status:200,contentType:'text/html',
          headers:{'Content-Security-Policy':"default-src 'self'; script-src 'none'; object-src 'none'"},
          body:'<!doctype html><html><body>Restricted</body></html>'});
      });
    }
    await page.goto(origin+probePath,{waitUntil:'domcontentloaded'});
    if(mode==='missing'||mode==='mime'){
      await page.route('**/game/js/sim/saveTransfer.js*',async route=>{
        await route.fulfill({status:mode==='missing'?404:200,
          contentType:mode==='mime'?'text/plain':'text/javascript',
          body:mode==='mime'?'export const parseImportedSave=()=>{};':'missing'});
      });
    }
    const rejected=await page.evaluate(async()=>{
      try {
        await import('/game/js/sim/saveTransfer.js?__sac_negative=1');
        return false;
      } catch {return true;}
    });
    await ctx.close();
    assert.equal(rejected,true,'sac-browser-negative-case-accepted');
    return rejected;
  }
  const negativeTests={missing_module_rejected:await negative('missing'),
    incorrect_mime_rejected:await negative('mime'),
    restrictive_csp_rejected:await negative('csp')};
  report={schema_version:1,rule_id:'SAC-PRE002-EXT-BROWSER',
    source_commit:pinned,scope:'isolated-loopback-browser-dynamic-imports',
    browser:'chromium',server:'127.0.0.1',game,
    save:{dynamic_import_executed:true,export_detected:true,...saveHttp},
    negative_tests:negativeTests,
    external_network_blocked_count:blockedExternal,
    browser_module_load_verified:true,gameplay_verified:false,
    authentication_attempted:false,payment_attempted:false,
    deployment_authorized:false};
  console.log(JSON.stringify(report,null,2));
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}

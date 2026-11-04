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

const islandHostIds=Object.freeze([
  'angular-save-transfer','angular-menu-preferences','angular-notice-inbox',
  'angular-time-weather','angular-player-account','angular-shop-overview',
  'angular-shop-catalog','angular-stock-workspace','angular-merchandise-catalog',
  'angular-finance-workspace','angular-prices-workspace',
  'angular-licenses-workspace','angular-consoles-workspace'
]);
const angularEntrypointSha=sha(await readFile(path.join(output,'game/__angular/main.js')));

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
async function isolated(mobileWidth=null){
  const phone=mobileWidth!==null;
  const ctx=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,
    permissions:[],viewport:phone
      ? {width:mobileWidth,height:mobileWidth===360?800:896}
      : {width:1280,height:720},
    ...(phone?{isMobile:true,hasTouch:true,deviceScaleFactor:2}:{})});
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

/** Reloads are independent navigations: modules must load again over HTTP. */
/**
 * Dispatches a genuine browser touch gesture via the Chromium DevTools
 * protocol, not element.click(). The app stays in a disposable local save.
 * A separate synthetic negative probe verifies the viewport's click guard.
 */
async function probeSwipeDoesNotSelect(page){
  const viewport=page.locator('#scene-viewport');
  await viewport.scrollIntoViewIfNeeded({timeout:12000});
  const before=await page.evaluate(()=>{
    const v=document.getElementById('scene-viewport');
    const canvas=document.getElementById('game');
    if(!(v instanceof HTMLElement)||!(canvas instanceof HTMLCanvasElement))
      throw new Error('sac-swipe-viewport-or-canvas-missing');
    v.scrollLeft=0;
    const rect=v.getBoundingClientRect(),c=canvas.getBoundingClientRect();
    const region={left:Math.max(rect.left,c.left,0)+12,
      right:Math.min(rect.right,c.right,innerWidth)-12,
      top:Math.max(rect.top,c.top,0)+12,
      bottom:Math.min(rect.bottom,c.bottom,innerHeight)-12};
    const samples=[];
    for(const fy of [.25,.5,.75]){
      for(const fx of [.75,.6,.45,.3]){
        const x=region.left+(region.right-region.left)*fx;
        const y=region.top+(region.bottom-region.top)*fy;
        const target=document.elementFromPoint(x,y);
        samples.push({x,y,tag:target?.tagName??null,id:target?.id??null});
      }
    }
    const chosen=samples.find(q=>document.elementFromPoint(q.x,q.y)===canvas);
    const evidence={clicks:0};
    canvas.addEventListener('click',()=>{evidence.clicks++;},{capture:true});
    window.__sacSwipeEvidence=evidence;
    return {x:chosen?.x??0,y:chosen?.y??0,scroll:v.scrollLeft,
      maxScroll:v.scrollWidth-v.clientWidth,pointInsideCanvas:!!chosen,
      diagnostic:chosen?null:{viewport:{top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right},
        canvas:{top:c.top,bottom:c.bottom,left:c.left,right:c.right},
        region,samples}};

  });
  if(!before.pointInsideCanvas)console.error('SAC_SWIPE_GEOMETRY',JSON.stringify(before.diagnostic));
  assert.equal(before.pointInsideCanvas,true,'sac-swipe-start-not-on-game-canvas');
  assert.ok(before.maxScroll>60,'sac-swipe-canvas-has-no-horizontal-overflow');
  const distance=Math.min(135,Math.max(65,before.x-45));
  assert.ok(distance>55,'sac-swipe-distance-too-small');
  const cdp=await page.context().newCDPSession(page);
  let touched=false;
  try {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',
      touchPoints:[{x:before.x,y:before.y}]});touched=true;
    for(let step=1;step<=9;step++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',
        touchPoints:[{x:before.x-distance*step/9,y:before.y}]});
      await page.waitForTimeout(22);
    }
  } finally {
    if(touched)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await cdp.detach();
  }
  await page.waitForFunction(prev=>{
    const v=document.getElementById('scene-viewport');
    return v && v.scrollLeft>prev+15;
  },before.scroll,{timeout:6500});
  await page.waitForTimeout(240);
  const after=await page.evaluate(()=>{
    const v=document.getElementById('scene-viewport');
    return {scroll:v.scrollLeft,clicks:window.__sacSwipeEvidence.clicks,
      adminHidden:document.getElementById('admin').hidden,
      shopHidden:document.getElementById('shop').hidden,
      placementHidden:document.getElementById('placement-toolbar').hidden};
  });
  assert.ok(after.scroll-before.scroll>15,'sac-swipe-did-not-pan-canvas');
  assert.equal(after.clicks,0,'sac-swipe-generated-game-click');
  assert.equal(after.adminHidden,true,'sac-swipe-opened-admin');
  assert.equal(after.shopHidden,true,'sac-swipe-opened-shop');
  assert.equal(after.placementHidden,true,'sac-swipe-opened-placement');

  // A negative test for browsers synthesizing click after a pointer drag.
  // Untrusted DOM events cannot stand in for the CDP gesture above.
  const guard=await page.evaluate(()=>{
    const v=document.getElementById('scene-viewport');
    const c=document.getElementById('game');
    const r=c.getBoundingClientRect();
    const init={bubbles:true,clientX:r.left+48,clientY:r.top+45,pointerType:'touch'};
    v.dispatchEvent(new PointerEvent('pointerdown',init));
    v.dispatchEvent(new PointerEvent('pointermove',{...init,clientX:init.clientX+50}));
    const click=new MouseEvent('click',{bubbles:true,cancelable:true,
      clientX:init.clientX+50,clientY:init.clientY});
    c.dispatchEvent(click);
    return {prevented:click.defaultPrevented,canvasClicks:window.__sacSwipeEvidence.clicks};
  });
  assert.equal(guard.prevented,true,'sac-swipe-synthetic-click-not-prevented');
  assert.equal(guard.canvasClicks,0,'sac-swipe-synthetic-click-reached-canvas');
  assert.equal(await page.locator('#admin').isVisible(),false,
    'sac-swipe-synthetic-click-opened-admin');
  return {native_touch_swipe:true,canvas_scrolled:true,
    scroll_delta_px:Math.round(after.scroll-before.scroll),
    game_clicks:after.clicks,admin_remained_closed:true,
    shop_remained_closed:true,placement_remained_closed:true,
    synthetic_post_drag_click_blocked:true};
}

/**
 * Read-only DOM inspection of every known cutover host, plus a disposable
 * Angular signal update through the actual document event listener.
 * Does not prove Angular ownership of arbitrary HTML, all UI interactions,
 * game simulation correctness, or a real Android device.
 */
async function probeAngularIslandRuntime(page,phase,width){
  await page.waitForFunction(ids=>ids.every(id=>{
    const host=document.getElementById(id);
    return host instanceof HTMLElement && host.childElementCount>0;
  }),islandHostIds,{timeout:18000});
  const landmarks=await page.evaluate(ids=>{
    const has=(host,selector)=>!!document.getElementById(host)?.querySelector(selector);
    return {
      allRendered:ids.every(id=>document.getElementById(id)?.childElementCount>0),
      prefs:has('angular-menu-preferences','#menu-settings'),
      calendar:has('angular-time-weather','#time-weather-date'),
      catalog:has('angular-shop-catalog','.angular-catalog'),
      finance:has('angular-finance-workspace','[data-angular-workspace="finance"]')
    };
  },islandHostIds);
  assert.deepEqual(landmarks,{allRendered:true,prefs:true,calendar:true,
    catalog:true,finance:true},'sac-islands-rendered-content-missing');
  const marker='SAC-CHROMIUM-DATE-ONLY';
  await page.evaluate(value=>{
    // This signal only affects a throwaway UI view, not game state, purchases,
    // persistence or account data.
    document.dispatchEvent(new CustomEvent('lhs:time-weather-updated',{
      detail:{day:1,date:value,time:'10:00',weekday:'test',
        nightActive:false,ended:false,weather:'Tempo firme',
        weatherIcon:'sun',impact:'',outlook:''}
    }));
  },marker);
  await page.waitForFunction(value=>
    document.querySelector('#angular-time-weather #time-weather-date')?.textContent?.trim()===value,
    marker,{timeout:8000});
  assert.equal((await page.locator('#angular-time-weather #time-weather-date').innerText()).trim(),
    marker,'sac-islands-reactive-update-did-not-render');
  return {viewport_width:width,phase,host_count:islandHostIds.length,
    rendered:true,reactive_dom_updated:true,no_page_errors:true};
}

/**
 * Two independent UI-only probes. The native game emits these events to
 * present state; no action button is clicked and no persistent API is called.
 * All expectations are read from DOM after Angular reacts to the event.
 */
async function probeIslandComponentInteractions(page,phase,width){
  const noticeTitle='SAC-CHROMIUM-INBOX-ONLY';
  await page.evaluate(title=>{
    document.dispatchEvent(new CustomEvent('lhs:notice-inbox-updated',{
      detail:{letters:[{title,body:'Isolated UI smoke only',day:1,
        severity:'info',read:false,items:[]}]}
    }));
  },noticeTitle);
  await page.waitForFunction(title=>
    document.querySelector('#angular-notice-inbox #notices-list .notice-letter h3')
      ?.textContent?.includes(title)===true,
    noticeTitle,{timeout:8000});
  assert.equal(await page.locator('#angular-notice-inbox #notices-list .notice-letter').count(),1,
    'sac-inbox-angular-render-count-mismatch');
  // Verify state can be cleared; the inbox dialog remains hidden and no
  // notice action is clicked.
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent(
    'lhs:notice-inbox-updated',{detail:{letters:[]}}
  )));
  await page.waitForFunction(()=>
    document.querySelector('#angular-notice-inbox #notices-list')?.textContent
      ?.includes('Nenhuma mensagem recebida por enquanto.')===true,
    null,{timeout:8000});
  const noticeCleared=await page.locator(
    '#angular-notice-inbox #notices-list .notice-letter'
  ).count()===0;
  assert.equal(noticeCleared,true,'sac-inbox-angular-clear-not-rendered');

  const money='SAC-CHROMIUM-CASH-VIEW-ONLY';
  await page.evaluate(cash=>{
    document.dispatchEvent(new CustomEvent('lhs:admin-finance-updated',{
      detail:{cash,bills:'0',served:'0'}
    }));
  },money);
  await page.waitForFunction(cash=>
    document.querySelector('#angular-finance-workspace .angular-workspace-live')
      ?.textContent?.includes(cash)===true,
    money,{timeout:8000});
  assert.match(await page.locator(
    '#angular-finance-workspace .angular-workspace-live'
  ).textContent(),/SAC-CHROMIUM-CASH-VIEW-ONLY/);
  // No finance task, restart, purchase, save or account action is invoked.
  return {viewport_width:width,phase,probes:[
    {id:'notice-inbox',dom_updated:true},
    {id:'finance-summary',dom_updated:true}
  ]};
}

/**
 * Accessibility smoke (not a full WCAG or screen-reader certification).
 * Real key presses activate Angular tab handlers. The existing native
 * controller must remain the only authority for selected admin sections.
 */
async function probeAdminKeyboardAccessibility(page,phase,width){
  const selector='#angular-admin-area-navigation nav[role="tablist"]';
  assert.equal(await page.locator(selector).count(),1,
    'sac-a11y-tablist-semantic-role-missing');
  const tab=area=>page.locator(
    '#angular-admin-area-navigation [data-angular-admin-tab="'+area+'"]');
  async function expectSelection(area,keyboard){
    await page.waitForFunction(({area,keyboard})=>{
      const root=document.getElementById('angular-admin-area-navigation');
      const tabs=Array.from(root?.querySelectorAll('button[role="tab"]')??[]);
      const selected=tabs.filter(t=>t.getAttribute('aria-selected')==='true');
      const focus=selected[0];
      const native=document.querySelector(
        '#admin .admin-tabs button[data-admin-tab="'+area+'"]');
      const section=document.getElementById('section-'+area);
      const responsive=document.getElementById('admin-area');
      return tabs.length>=6&&selected.length===1&&
        focus?.dataset.angularAdminTab===area&&
        tabs.filter(t=>t.tabIndex===0).length===1&&
        tabs.every(t=>t.getAttribute('aria-controls')&&
          document.getElementById(t.getAttribute('aria-controls')))&&
        tabs.every(t=>t.getAttribute('role')==='tab')&&
        native?.getAttribute('aria-selected')==='true'&&
        section?.hidden===false&&responsive?.value===area&&
        (!keyboard||document.activeElement===focus);
    },{area,keyboard},{timeout:8000});
  }
  const finance=tab('finance');
  await finance.focus();
  await page.keyboard.press('Home');
  await expectSelection('prices',true);
  await page.keyboard.press('End');
  await expectSelection('finance',true);
  await page.keyboard.press('ArrowLeft');
  await expectSelection('consoles',true);
  await page.keyboard.press('ArrowRight');
  await expectSelection('finance',true);
  const select=page.locator('#admin-area');
  assert.equal(await select.isVisible(),true,'sac-a11y-responsive-admin-select-hidden');
  await select.selectOption('stock');
  await expectSelection('stock',false);
  await select.selectOption('finance');
  await expectSelection('finance',false);
  const a11y=await page.evaluate(()=>{
    const tabs=Array.from(document.querySelectorAll(
      '#angular-admin-area-navigation button[role="tab"]'));
    const active=tabs.find(t=>t.getAttribute('aria-selected')==='true');
    return {
      keyboard_home_end_arrows:true,
      focus_follows_keyboard:true,
      roving_tabindex:tabs.filter(t=>t.tabIndex===0).length===1&&
        active?.tabIndex===0,
      aria_controls_connected:tabs.every(t=>!!t.getAttribute('aria-controls')&&
        !!document.getElementById(t.getAttribute('aria-controls'))),
      native_angular_sync:true,
      responsive_selector_synced:
        document.getElementById('admin-area')?.value==='finance'
    };
  });
  assert.deepEqual(a11y,{
    keyboard_home_end_arrows:true,focus_follows_keyboard:true,
    roving_tabindex:true,aria_controls_connected:true,
    native_angular_sync:true,responsive_selector_synced:true
  },'sac-a11y-focus-aria-or-native-sync-invalid');
  return {viewport_width:width,phase,...a11y};
}

/**
 * Non-destructive browser measurement of a real :focus-visible outline,
 * foreground/background RGB and the locked 1998 catalog behavior.
 * Samples CSS only; this is not a screenshot or WCAG certification.
 */
async function probeFocusContrastAndLockedKeyboard(page,phase,width){
  const tab=area=>page.locator(
    '#angular-admin-area-navigation [data-angular-admin-tab="'+area+'"]');
  await tab('finance').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.waitForFunction(()=>{
    const node=document.querySelector(
      '#angular-admin-area-navigation [data-angular-admin-tab="finance"]');
    return node?.matches(':focus-visible')===true&&
      document.activeElement===node&&
      node.getAttribute('aria-selected')==='true';
  },null,{timeout:8000});
  const sample=await page.evaluate(()=>{
    const focused=document.querySelector(
      '#angular-admin-area-navigation [data-angular-admin-tab="finance"]');
    const inactive=document.querySelector(
      '#angular-admin-area-navigation [data-angular-admin-tab="prices"]');
    const nav=document.querySelector('#angular-admin-area-navigation nav');
    if(!focused||!inactive||!nav)throw Error('focus-target-absent');
    const a=getComputedStyle(focused),b=getComputedStyle(inactive),n=getComputedStyle(nav);
    const parseRgb=v=>{
      const m=/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
      if(!m)throw Error('opaque-computed-rgb-required');
      return m.slice(1,4).map(Number);
    };
    return {
      focus_visible:focused.matches(':focus-visible')&&
        document.activeElement===focused,
      outline_width_px:Number.parseFloat(a.outlineWidth),
      outline_style:a.outlineStyle,
      focus_outline_rgb:parseRgb(a.outlineColor),
      adjacent_nav_rgb:parseRgb(n.backgroundColor),
      selected_text_rgb:parseRgb(a.color),
      selected_background_rgb:parseRgb(a.backgroundColor),
      inactive_text_rgb:parseRgb(b.color),
      inactive_background_rgb:parseRgb(b.backgroundColor)
    };
  });
  await page.locator('#admin-area').selectOption('stock');
  await page.waitForFunction(()=>{
    const t=document.querySelector(
      '#angular-admin-area-navigation [data-angular-admin-tab="stock"]');
    return t?.getAttribute('aria-selected')==='true'&&
      document.getElementById('section-stock')?.hidden===false;
  },null,{timeout:8000});
  const disabled=await page.evaluate(()=>{
    const catalog=document.querySelector(
      '#angular-stock-workspace [data-angular-task="catalog"]');
    const native=document.querySelector(
      '#section-stock [data-panel-choice="catalog"]');
    const pane=document.getElementById('page-stock-catalog');
    if(!(catalog instanceof HTMLButtonElement)||
       !(native instanceof HTMLButtonElement)||!pane)
      throw Error('catalog-lock-target-absent');
    catalog.focus();
    return {
      locked_disabled:catalog.disabled,
      locked_native_disabled:native.disabled,
      locked_unfocusable:document.activeElement!==catalog,
      locked_pane_hidden:pane.hidden
    };
  });
  // Tab traversal must not land on the disabled catalog.
  await page.locator('#angular-stock-workspace [data-angular-task="suppliers"]').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute(
    'data-angular-task')==='catalog'),false,
    'sac-visual-disabled-catalog-keyboard-focus');
  assert.ok(Object.values(disabled).every(x=>x===true),
    'sac-visual-disabled-catalog-lock-failed');
  return {viewport_width:width,phase,...sample,...disabled};
}

/**
 * Real Angular buttons -> native panels and native button -> Angular status.
 * This only changes navigation of an ephemeral local game in Chromium.
 * No restart, catalog purchase, inventory action, payment or save mutation.
 */
async function probeAdminNavigation(page,phase,width){
  await page.locator('#open-admin').tap({timeout:12000});
  await page.waitForFunction(()=>document.getElementById('admin')?.hidden===false,
    null,{timeout:12000});
  const angularTab=area=>page.locator(
    '#angular-admin-area-navigation [data-angular-admin-tab="'+area+'"]');
  async function verifyArea(area){
    await page.waitForFunction(area=>{
      const native=document.querySelector('#admin .admin-tabs [data-admin-tab="'+area+'"]');
      const angular=document.querySelector(
        '#angular-admin-area-navigation [data-angular-admin-tab="'+area+'"]');
      const section=document.getElementById('section-'+area);
      const select=document.getElementById('admin-area');
      return native?.getAttribute('aria-selected')==='true'&&
        angular?.getAttribute('aria-selected')==='true'&&
        section?.hidden===false&&select?.value===area;
    },area,{timeout:8000});
  }
  async function verifyPage(area,task){
    await page.waitForFunction(({area,task})=>{
      const native=document.querySelector(
        '#section-'+area+' .management-pages [data-panel-choice="'+task+'"]');
      const angular=document.querySelector(
        '#angular-'+(area==='finance'?'finance':'stock')+
        '-workspace [data-angular-task="'+task+'"]');
      const pane=document.getElementById('page-'+area+'-'+task);
      return native?.getAttribute('aria-pressed')==='true'&&
        angular?.getAttribute('aria-pressed')==='true'&&
        pane?.hidden===false;
    },{area,task},{timeout:8000});
  }
  await angularTab('finance').tap({timeout:12000});
  await verifyArea('finance');
  await page.locator('#angular-finance-workspace [data-angular-task="usage"]')
    .tap({timeout:12000});
  await verifyPage('finance','usage');
  // The original native controls may be visually suppressed by Angular.
  // The real controller click listener is exercised, without a fake event.
  await page.locator(
    '#section-finance .management-pages [data-panel-choice="balance"]'
  ).evaluate(button=>button.click());
  await verifyPage('finance','balance');

  await angularTab('stock').tap({timeout:12000});
  await verifyArea('stock');
  await page.locator('#angular-stock-workspace [data-angular-task="orders"]')
    .tap({timeout:12000});
  await verifyPage('stock','orders');
  await page.locator(
    '#section-stock .management-pages [data-panel-choice="suppliers"]'
  ).evaluate(button=>button.click());
  await verifyPage('stock','suppliers');
  // The advanced catalogue is locked in the pinned 1998 scenario.
  const lock=await page.evaluate(()=>{
    const native=document.querySelector(
      '#section-stock .management-pages [data-panel-choice="catalog"]');
    const angular=document.querySelector(
      '#angular-stock-workspace [data-angular-task="catalog"]');
    return {native:native?.disabled,angular:angular?.disabled,
      catalogHidden:document.getElementById('page-stock-catalog')?.hidden};
  });
  assert.deepEqual(lock,{native:true,angular:true,catalogHidden:true},
    'sac-navigation-locked-catalog-became-enabled');
  assert.equal(await page.locator('#admin').isVisible(),true,
    'sac-navigation-admin-closed-unexpectedly');
  const accessibility=await probeAdminKeyboardAccessibility(page,phase,width);
  const visual=await probeFocusContrastAndLockedKeyboard(page,phase,width);
  await page.locator('#close-admin').tap({timeout:12000});
  await page.waitForFunction(()=>document.getElementById('admin')?.hidden===true,
    null,{timeout:8000});
  return {navigationProbes:[
    {id:'finance-navigation',dom_updated:true},
    {id:'stock-navigation',dom_updated:true}
  ],accessibility,visual};
}

/** Interaction smoke: only presentational buttons plus creating an isolated local test save. */
async function exerciseMobileControls(page,phase,width){
  await page.waitForFunction(()=>document.documentElement.dataset.gameReady==='true',
    null,{timeout:20000});
  const chapters=page.locator('#react-menu-tour');
  await chapters.locator('#react-tab-historia').tap({timeout:12000});
  await page.waitForFunction(
    ()=>document.getElementById('react-tab-historia')?.getAttribute('aria-selected')==='true',
    null,{timeout:8000});
  assert.match(await chapters.locator('#react-chapter-content').innerText(),
    /internet tem uma história/i,'sac-touch-tour-content-did-not-update');
  await chapters.locator('#react-tab-abrir').tap({timeout:12000});
  await page.waitForFunction(
    ()=>document.getElementById('react-tab-abrir')?.getAttribute('aria-selected')==='true',
    null,{timeout:8000});

  const options=page.locator('#menu-options');
  await options.tap({timeout:12000});
  assert.equal(await options.getAttribute('aria-expanded'),'true',
    'sac-touch-options-did-not-expand');
  assert.equal(await page.locator('#menu-settings').isVisible(),true,
    'sac-touch-settings-panel-not-visible');
  await options.tap({timeout:12000});
  assert.equal(await options.getAttribute('aria-expanded'),'false',
    'sac-touch-options-did-not-collapse');
  assert.equal(await page.locator('#menu-settings').isVisible(),false,
    'sac-touch-settings-panel-not-hidden');

  const start=phase==='initial'?'#menu-new':'#menu-continue';
  const playButton=page.locator(start);
  assert.equal(await playButton.isEnabled(),true,
    'sac-touch-save-missing-or-start-button-disabled');
  await playButton.tap({timeout:12000});
  await page.waitForFunction(()=>document.getElementById('game-app')?.hidden===false
    && document.getElementById('start-screen')?.hidden===true,
    null,{timeout:15000});
  const swipeEvidence=await probeSwipeDoesNotSelect(page);
  const zoom=page.locator('#scene-zoom');
  const readZoom=()=>zoom.evaluate(el=>String(el.value??el.textContent??'').trim());
  const prior=await readZoom();
  await page.locator('#scene-zoom-in').tap({timeout:12000});
  const increased=await readZoom();
  const numeric=v=>Number.parseInt(v.replace('%',''),10);
  assert.ok(Number.isFinite(numeric(prior))&&numeric(increased)>numeric(prior),
    'sac-touch-zoom-did-not-increase');
  await page.locator('#scene-zoom-out').tap({timeout:12000});
  const decreased=await readZoom();
  assert.ok(numeric(decreased)<numeric(increased),'sac-touch-zoom-did-not-decrease');
  await page.locator('#scene-fit').tap({timeout:12000});
  const fitted=await readZoom();
  assert.ok(Number.isFinite(numeric(fitted))&&numeric(fitted)>=60&&numeric(fitted)<=300,
    'sac-touch-fit-invalid-zoom');

  const {navigationProbes,accessibility,visual}=await probeAdminNavigation(page,phase,width);
  // Returning to the menu is safe and exercises the native control binding.
  await page.locator('#open-menu').tap({timeout:12000});
  await page.waitForFunction(()=>document.getElementById('start-screen')?.hidden===false
    && document.getElementById('game-app')?.hidden===true,
    null,{timeout:15000});
  const result={phase,viewport_width:width,tab_switch:true,options_open_close:true,
    game_started:phase==='initial',saved_game_continued:phase==='reload',
    zoom_in_and_out:true,fit_scene:true,returned_to_menu:true,
    canvas_swipe:swipeEvidence};
  return {control:result,navigationProbes,accessibility,visual};
}

async function runMobileReloads(){
  const widths=[360,414], outcome=[],islandCycles=[],interactionCycles=[],accessibilityCycles=[],visualCycles=[];
  for(const width of widths){
    const ctx=await isolated(width);
    try{
      const page=await ctx.newPage();
      const pageErrors=[];
      page.on('pageerror',error=>pageErrors.push(error.name));
      const cycles=[], controls=[];
      for(const phase of ['initial','reload']){
        const canvasRequest=page.waitForResponse(
          res=>new URL(res.url()).pathname==='/game/js/main.js',{timeout:20000});
        const angularRequest=page.waitForResponse(
          res=>new URL(res.url()).pathname==='/game/__angular/main.js',{timeout:20000});
        const navigation=phase==='initial'
          ? await page.goto(origin+'/game/',{waitUntil:'domcontentloaded',timeout:20000})
          : await page.reload({waitUntil:'domcontentloaded',timeout:20000});
        assert.equal(navigation?.status(),200,'sac-mobile-game-navigation-failed');
        const response=await canvasRequest;
        const angularResponse=await angularRequest;
        assert.equal(angularResponse.status(),200,'sac-islands-angular-module-404');
        assert.equal(sha(await angularResponse.body()),angularEntrypointSha,
          'sac-islands-angular-module-content-drift');
        assert.equal(response.status(),200,'sac-mobile-canvas-import-404');
        assert.match(response.headers()['content-type']??'',/^text\/javascript/,
          'sac-mobile-canvas-import-mime-error');
        assert.equal(sha(await response.body()),tracked['/game/js/main.js'],
          'sac-mobile-canvas-module-content-changed');
        await page.waitForFunction(
          ()=>document.documentElement.dataset['uiFramework']==='angular',
          null,{timeout:20000});
        const visible=await page.evaluate(()=>({
          width:window.innerWidth,
          hasTouch:navigator.maxTouchPoints>0,
          horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-window.innerWidth)
        }));
        assert.equal(visible.width,width,'sac-mobile-viewport-not-respected');
        assert.equal(visible.hasTouch,true,'sac-mobile-touch-not-emulated');
        await page.waitForTimeout(350);
        assert.deepEqual(pageErrors,[],'sac-mobile-game-pageerror');
        islandCycles.push(await probeAngularIslandRuntime(page,phase,width));
        const componentInteractions=await probeIslandComponentInteractions(page,phase,width);
        assert.deepEqual(pageErrors,[],'sac-islands-reactivity-triggered-pageerror');
        cycles.push({
          phase,navigation_status:navigation.status(),canvas_import_status:response.status(),
          angular_bootstrap:true,touch_emulation:true,
          horizontal_overflow_px:visible.horizontalOverflow,
          pageerror_count:pageErrors.length
        });
        const {control,navigationProbes,accessibility,visual}=await exerciseMobileControls(page,phase,width);
        accessibilityCycles.push(accessibility);
        visualCycles.push(visual);
        controls.push(control);
        interactionCycles.push({...componentInteractions,
          probes:[...componentInteractions.probes,...navigationProbes]});
        assert.deepEqual(pageErrors,[],'sac-mobile-controls-triggered-pageerror');
      }
      // The save module is imported by an isolated page; no account or
      // payment flow is activated, and parsing a real save is out of scope.
      const probe=await ctx.newPage();
      const saveCycles=[];
      for(const phase of ['initial','reload']){
        const navigation=phase==='initial'
          ? await probe.goto(origin+probePath,{waitUntil:'domcontentloaded',timeout:20000})
          : await probe.reload({waitUntil:'domcontentloaded',timeout:20000});
        assert.equal(navigation?.status(),200,'sac-mobile-probe-navigation-failed');
        const moduleURL='/game/js/sim/saveTransfer.js?__sac_mobile='+width+'&phase='+phase;
        const saveResponse=probe.waitForResponse(
          res=>res.url().includes('__sac_mobile='+width) &&
            new URL(res.url()).pathname==='/game/js/sim/saveTransfer.js',{timeout:20000});
        const exportType=await probe.evaluate(async url=>{
          const imported=await import(url);
          return typeof imported.parseImportedSave;
        },moduleURL);
        assert.equal(exportType,'function','sac-mobile-save-module-export-missing');
        const response=await saveResponse;
        assert.equal(response.status(),200,'sac-mobile-save-module-404');
        assert.match(response.headers()['content-type']??'',/^text\/javascript/,
          'sac-mobile-save-module-mime-error');
        assert.equal(sha(await response.body()),tracked['/game/js/sim/saveTransfer.js'],
          'sac-mobile-save-module-content-changed');
        saveCycles.push({phase,import_executed:true,export_detected:true,status:response.status()});
      }
      await probe.close();
      outcome.push({viewport_width:width,viewport_height:width===360?800:896,
        game:cycles,save:saveCycles,touch_controls:controls,
        no_page_errors:pageErrors.length===0});
    } finally {await ctx.close();}
  }
  return {mobileReloads:outcome,islandCycles,interactionCycles,accessibilityCycles,visualCycles};
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
  const {mobileReloads,islandCycles,interactionCycles,accessibilityCycles,visualCycles}=await runMobileReloads();
  const islandRuntimeEvidence={
    schema_version:1,source_commit:pinned,browser:'chromium',
    scope:'isolated-loopback-dom-events',mount:'/game/',
    entrypoint:'__angular/main.js',entrypoint_sha256:angularEntrypointSha,
    host_ids:islandHostIds,reactive_host_id:'angular-time-weather',
    event_name:'lhs:time-weather-updated',cycles:islandCycles
  };
  const islandInteractionEvidence={
    schema_version:1,source_commit:pinned,browser:'chromium',
    scope:'isolated-loopback-component-events',mount:'/game/',
    entrypoint:'__angular/main.js',entrypoint_sha256:angularEntrypointSha,
    probes:[
      {id:'notice-inbox',host_id:'angular-notice-inbox',
        event_name:'lhs:notice-inbox-updated'},
      {id:'finance-summary',host_id:'angular-finance-workspace',
        event_name:'lhs:admin-finance-updated'},
      {id:'finance-navigation',host_id:'angular-finance-workspace',
        event_name:'lhs:management-page-selected'},
      {id:'stock-navigation',host_id:'angular-stock-workspace',
        event_name:'lhs:management-page-selected'}
    ],
    cycles:interactionCycles
  };
  const adminAccessibilityEvidence={
    schema_version:1,source_commit:pinned,browser:'chromium',
    scope:'isolated-loopback-admin-keyboard',mount:'/game/',
    entrypoint:'__angular/main.js',entrypoint_sha256:angularEntrypointSha,
    host_id:'angular-admin-area-navigation',cycles:accessibilityCycles
  };
  const focusContrastEvidence={
    schema_version:1,source_commit:pinned,browser:'chromium',
    scope:'isolated-loopback-focus-and-contrast',mount:'/game/',
    entrypoint:'__angular/main.js',entrypoint_sha256:angularEntrypointSha,
    host_id:'angular-admin-area-navigation',cycles:visualCycles
  };
  report={schema_version:1,rule_id:'SAC-PRE002-EXT-BROWSER',
    source_commit:pinned,scope:'isolated-loopback-browser-dynamic-imports',
    browser:'chromium',server:'127.0.0.1',game,
    save:{dynamic_import_executed:true,export_detected:true,...saveHttp},
    negative_tests:negativeTests,
    mobile_reload_evidence:mobileReloads,
    island_runtime_evidence:islandRuntimeEvidence,
    island_interaction_evidence:islandInteractionEvidence,
    admin_accessibility_evidence:adminAccessibilityEvidence,
    focus_contrast_evidence:focusContrastEvidence,
    external_network_blocked_count:blockedExternal,
    browser_module_load_verified:true,gameplay_verified:false,
    authentication_attempted:false,payment_attempted:false,
    deployment_authorized:false};
  console.log(JSON.stringify(report,null,2));
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}

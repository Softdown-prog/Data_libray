import test from 'node:test';
import assert from 'node:assert/strict';
import {rgbContrast,verifyLhsFocusContrastEvidence as verify} from
  '../packages/angular-core/src/sac-lhs-focus-contrast.mjs';

const COMMIT='db639a117024b2e14c4af844bfb69b90bef5da20';
const HASH='a'.repeat(64);
const expected=()=>({source_commit:COMMIT,entrypoint:'__angular/main.js',
  mount:'/game/',host_id:'angular-admin-area-navigation'});
const fields=()=>({schema_version:1,source_commit:COMMIT,browser:'chromium',
  mount:'/game/',entrypoint:'__angular/main.js',entrypoint_sha256:HASH,
  host_id:'angular-admin-area-navigation'});
const samples=()=>[360,414].flatMap(viewport_width=>['initial','reload'].map(phase=>({
  viewport_width,phase,focus_visible:true,outline_width_px:3,outline_style:'solid',
  focus_outline_rgb:[198,138,66],adjacent_nav_rgb:[228,230,214],
  selected_text_rgb:[247,248,234],selected_background_rgb:[35,67,52],
  inactive_text_rgb:[75,97,78],inactive_background_rgb:[255,254,245],
  locked_disabled:true,locked_native_disabled:true,
  locked_unfocusable:true,locked_pane_hidden:true
})));
const baselineFields=()=>{const v=fields();delete v.host_id;return v;};
const baseline=()=>({
  ...baselineFields(),scope:'isolated-loopback-dom-events',
  host_ids:['angular-time-weather','angular-stock-workspace'],
  reactive_host_id:'angular-time-weather',event_name:'lhs:time-weather-updated',
  cycles:samples().map(v=>({
    viewport_width:v.viewport_width,phase:v.phase,host_count:2,
    rendered:true,reactive_dom_updated:true,no_page_errors:true
  }))
});
const keyboard=()=>({...fields(),scope:'isolated-loopback-admin-keyboard',
  cycles:samples().map(v=>({viewport_width:v.viewport_width,phase:v.phase,
    keyboard_home_end_arrows:true,focus_follows_keyboard:true,
    roving_tabindex:true,aria_controls_connected:true,
    native_angular_sync:true,responsive_selector_synced:true}))});
const proof=()=>({...fields(),scope:'isolated-loopback-focus-and-contrast',
  cycles:samples()});

test('CSS sample detects amber focus outline under 3:1 without inventing a pass',()=>{
  const r=verify(baseline(),keyboard(),proof(),expected());
  assert.deepEqual(r,{observed:true,code:'chromium-focus-contrast-sampled',
    focus_outline_contrast_finding:true,text_contrast_finding:false,
    universal_accessibility_attested:false,deployment_authorized:false});
  assert.ok(rgbContrast([198,138,66],[228,230,214])<3);
  assert.ok(rgbContrast([247,248,234],[35,67,52])>=4.5);
});
test('improved focus outline color removes finding without authorizing deployment',()=>{
  const p=proof();p.cycles.forEach(c=>c.focus_outline_rgb=[20,50,28]);
  const r=verify(baseline(),keyboard(),p,expected());
  assert.equal(r.observed,true);
  assert.equal(r.focus_outline_contrast_finding,false);
  assert.equal(r.deployment_authorized,false);
});
test('inadequate label contrast is recorded separately from focus outline',()=>{
  const p=proof();p.cycles[1].inactive_text_rgb=[215,215,215];
  const r=verify(baseline(),keyboard(),p,expected());
  assert.equal(r.observed,true);
  assert.equal(r.text_contrast_finding,true);
  assert.equal(r.focus_outline_contrast_finding,true);
});
test('focus must actually be visible and outline at least two pixels wide',()=>{
  for(const mutate of [
    p=>{p.cycles[0].focus_visible=false;},
    p=>{p.cycles[1].outline_width_px=0;},
    p=>{p.cycles[2].outline_style='none';},
    p=>{p.cycles[3].outline_width_px=Infinity;}
  ]){
    const p=proof();mutate(p);
    assert.equal(verify(baseline(),keyboard(),p,expected()).observed,false);
  }
});
test('locked native and Angular catalog cannot be keyboard-focusable or visible',()=>{
  for(const key of [
    'locked_disabled','locked_native_disabled','locked_unfocusable','locked_pane_hidden'
  ]){
    const p=proof();p.cycles[0][key]=false;
    assert.deepEqual(verify(baseline(),keyboard(),p,expected()),
      {observed:false,code:'visual-focus-or-lock-invalid'});
  }
});
test('missing cycles, reordered phases and extraneous or malformed colors reject evidence',()=>{
  for(const change of [
    p=>p.cycles.pop(),
    p=>{p.cycles[1].phase='initial';},
    p=>{p.cycles[0].viewport_width=414;},
    p=>{p.cycles[3].secret='PRIVATE';},
    p=>{p.cycles[0].focus_outline_rgb=[198,138,999];},
    p=>{p.cycles[2].inactive_text_rgb=[1,2];}
  ]){
    const p=proof();change(p);
    const r=verify(baseline(),keyboard(),p,expected());
    assert.equal(r.observed,false);
    assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  }
});
test('tampered module digest, source, mount and keyboard baseline fail closed',()=>{
  for(const mutate of [
    p=>{p.entrypoint_sha256='b'.repeat(64);},
    p=>{p.source_commit='0'.repeat(40);},
    p=>{p.host_id='different-host';},
    p=>{p.mount='/other/';},
    p=>{p.browser='firefox';}
  ]){
    const p=proof();mutate(p);
    assert.equal(verify(baseline(),keyboard(),p,expected()).observed,false);
  }
  const k=keyboard();k.cycles[0].focus_follows_keyboard=false;
  assert.equal(verify(baseline(),k,proof(),expected()).observed,false);
});
test('independent host expectation cannot be replaced by caller evidence',()=>{
  for(const altered of [
    {...expected(),source_commit:'f'.repeat(40)},
    {...expected(),mount:'/bad/'},
    {...expected(),host_id:'not-this-host'},
    {...expected(),extra:'PRIVATE'},
    null
  ]){
    assert.equal(verify(baseline(),keyboard(),proof(),altered).observed,false);
  }
});
test('color formula rejects invalid types and keeps conventional WCAG sample ratios',()=>{
  assert.equal(rgbContrast([0,0,0],[255,255,255]),21);
  assert.equal(rgbContrast([255,255,255],[255,255,255]),1);
  assert.equal(rgbContrast([255,0,0],[255,255,255])>3,true);
  assert.equal(rgbContrast([0,0,999],[255,255,255]),null);
  assert.equal(rgbContrast([],[]),null);
});

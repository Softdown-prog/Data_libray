import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLhsAdminAccessibilityEvidence as verify} from '../packages/angular-core/src/sac-lhs-admin-accessibility.mjs';

const sha='c5139c2cc5088adc3bbf0bf85d2952e64e2fc5ac';
const hash='a'.repeat(64);
const widths=[360,414], phases=['initial','reload'];
const expected=()=>({source_commit:sha,mount:'/game/',entrypoint:'__angular/main.js',
  host_id:'angular-admin-area-navigation'});
const baseline=()=>({
  schema_version:1,source_commit:sha,browser:'chromium',
  scope:'isolated-loopback-dom-events',mount:'/game/',
  entrypoint:'__angular/main.js',entrypoint_sha256:hash,
  host_ids:['angular-time-weather','angular-stock-workspace','angular-finance-workspace'],
  reactive_host_id:'angular-time-weather',event_name:'lhs:time-weather-updated',
  cycles:widths.flatMap(viewport_width=>phases.map(phase=>({
    viewport_width,phase,host_count:3,rendered:true,
    reactive_dom_updated:true,no_page_errors:true
  })))
});
const proof=()=>({
  schema_version:1,source_commit:sha,browser:'chromium',
  scope:'isolated-loopback-admin-keyboard',mount:'/game/',
  entrypoint:'__angular/main.js',entrypoint_sha256:hash,
  host_id:'angular-admin-area-navigation',
  cycles:widths.flatMap(viewport_width=>phases.map(phase=>({
    viewport_width,phase,keyboard_home_end_arrows:true,
    focus_follows_keyboard:true,roving_tabindex:true,
    aria_controls_connected:true,native_angular_sync:true,
    responsive_selector_synced:true
  })))
});
test('all four keyboard and responsive cycles yield bounded observational proof',()=>{
  assert.deepEqual(verify(baseline(),proof(),expected()),
    {observed:true,code:'chromium-admin-keyboard-observed'});
});
test('false focus, roving tabindex, controls, selector and native sync fail closed',()=>{
  for(const field of [
    'keyboard_home_end_arrows','focus_follows_keyboard','roving_tabindex',
    'aria_controls_connected','native_angular_sync','responsive_selector_synced'
  ]){
    const p=proof();p.cycles[2][field]=false;
    assert.deepEqual(verify(baseline(),p,expected()),
      {observed:false,code:'accessibility-cycle-invalid'});
  }
});
test('missing, repeated, re-ordered and arbitrary cycles are rejected',()=>{
  for(const alter of [
    p=>p.cycles.pop(),
    p=>{p.cycles[1].phase='initial';},
    p=>{p.cycles[0].viewport_width=414;},
    p=>{p.cycles[3].untrusted='SECRET';},
    p=>p.cycles.reverse()
  ]){
    const p=proof();alter(p);
    const v=verify(baseline(),p,expected());
    assert.equal(v.observed,false);
    assert.ok(!JSON.stringify(v).includes('SECRET'));
  }
});
test('wrong project SHA, host and module digest cannot be accepted',()=>{
  for(const alter of [
    p=>{p.source_commit='f'.repeat(40);},
    p=>{p.entrypoint_sha256='b'.repeat(64);},
    p=>{p.host_id='other-host';},
    p=>{p.mount='/different/';},
    p=>{p.entrypoint='main.js';},
    p=>{p.browser='firefox';}
  ]){
    const p=proof();alter(p);
    assert.equal(verify(baseline(),p,expected()).observed,false);
  }
});
test('trusted host expectations must not be derived from browser claims',()=>{
  for(const other of [
    {...expected(),source_commit:'f'.repeat(40)},
    {...expected(),mount:'/other/'},
    {...expected(),host_id:'angular-stock-workspace'},
    {...expected(),entrypoint:'../../private.js'},
    {...expected(),extra:'SECRET'},
    null
  ]){
    assert.equal(verify(baseline(),proof(),other).observed,false);
  }
});
test('baseline must match fixed source, entry and cycle coverage',()=>{
  for(const mutate of [
    b=>{b.source_commit='f'.repeat(40);},
    b=>{b.cycles.pop();},
    b=>{b.cycles[1].phase='initial';},
    b=>{b.entrypoint_sha256='b'.repeat(64);},
    b=>{b.extra='SECRET';}
  ]){
    const b=baseline();mutate(b);
    assert.equal(verify(b,proof(),expected()).observed,false);
  }
});
test('missing proof cannot certify keyboard, even with plausible baseline',()=>{
  assert.equal(verify(baseline(),undefined,expected()).observed,false);
  assert.equal(verify(baseline(),null,expected()).observed,false);
  assert.equal(verify({},proof(),expected()).observed,false);
});

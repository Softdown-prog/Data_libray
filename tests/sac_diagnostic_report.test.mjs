import assert from 'node:assert/strict';
import {test} from 'node:test';
import {makeDiagnosticReport} from '../scripts/sac_diagnostic_report.mjs';
const passed=()=>({status:'pass',static_pipeline_pass:true,browser_pass:true,
 deployment_authorized:false,network_isolation:'container-network-none',
 static_result:{phases:{pre:{status:'pass'},build:{status:'pass'},post:{status:'pass'}}},
 browser:{status:'pass',sandbox:'docker-network-none',cases:[{id:'click',status:'pass',codes:[]}]}
});
test('all verified stages pass without deployment authorization',()=>{
 const r=makeDiagnosticReport(passed());
 assert.equal(r.status,'pass');assert.deepEqual(r.findings,[]);
 assert.equal(r.deployment_authorized,false);assert.equal(r.location_verified,false);
});
test('runtime failure identifies exact scenario and next action but not file/line',()=>{
 const x=passed();x.status='fail';x.browser_pass=false;x.browser.status='fail';
 x.browser.cases=[{id:'inventory-panel',status:'fail',codes:['application-pageerror','required-assertion-failed']}];
 const r=makeDiagnosticReport(x);
 assert.equal(r.status,'fail');assert.equal(r.findings[0].assertion,'inventory-panel');
 assert.match(r.findings[0].next_step,/Playwright/);
 assert.ok(!JSON.stringify(r).includes('component.ts'));
});
test('pre build post failures retain controlled codes not private messages',()=>{
 const x=passed();x.static_pipeline_pass=false;x.browser_pass=false;x.status='fail';
 x.static_result.phases.pre={status:'fail',results:[{evidence:[{
 status:'fail',code:'typescript-peer-incompatible',assertion:'typescript-peers',
 message:'TOKEN=https://private.example'}]}]};
 x.static_result.phases.build={status:'fail',code:'official-build-failed'};
 x.static_result.phases.post={status:'fail',results:[{evidence:[
 {status:'fail',code:'mount-mismatch',assertion:'mount'}]}]};
 x.browser={status:'unverified',executed:false,code:'not-executed',cases:[]};
 const r=makeDiagnosticReport(x);
 assert.deepEqual(r.findings.map(f=>f.code),
 ['typescript-peer-incompatible','official-build-failed','mount-mismatch']);
 assert.ok(!JSON.stringify(r).includes('TOKEN'));
});
test('reject free-form secrets, paths and invalid scenario ids',()=>{
 const x=passed();x.browser_pass=false;x.status='fail';
 x.browser={status:'fail',cases:[{id:'../../.env',status:'fail',codes:['TOKEN=https://private']}]};
 const r=makeDiagnosticReport(x);
 assert.equal(r.findings[0].code,'diagnostic-unclassified');
 assert.equal(r.findings[0].assertion,null);
 assert.ok(!JSON.stringify(r).includes('TOKEN'));
});
test('browser pass without network isolation stays unverified',()=>{
 const x=passed();x.network_isolation='application-only';
 const r=makeDiagnosticReport(x);
 assert.equal(r.status,'unverified');
 assert.equal(r.findings[0].code,'browser-isolation-unverified');
});
test('incomplete result never claims pass',()=>{
 const r=makeDiagnosticReport(null);
 assert.equal(r.status,'unverified');assert.equal(r.findings[0].code,'audit-infrastructure-error');
});
test('bounded findings for large failed scenarios',()=>{
 const x=passed();x.browser_pass=false;x.status='fail';
 x.browser={status:'fail',cases:Array.from({length:40},(_,i)=>({
 id:'case'+i,status:'fail',codes:['http-error','request-failed','application-pageerror']}))};
 const r=makeDiagnosticReport(x);
 assert.equal(r.findings.length,8);assert.equal(r.truncated,true);
 assert.ok(JSON.stringify(r).length<4096);
});

test('static verified without scheduled browser test is unverified but not an infrastructure error',()=>{
 const x=passed();
 x.browser_pass=false;
 x.browser={status:'unverified',executed:false,code:'not-executed'};
 const r=makeDiagnosticReport(x);
 assert.equal(r.status,'unverified');
 assert.equal(r.checks.pre,'pass');
 assert.equal(r.checks.build,'pass');
 assert.equal(r.checks.post,'pass');
 assert.equal(r.checks.browser,'unverified');
 assert.deepEqual(r.findings,[]);
 assert.equal(r.deployment_authorized,false);
});

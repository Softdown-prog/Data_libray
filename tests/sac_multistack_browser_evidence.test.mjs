import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateSyntheticBrowserReport,decodeSyntheticBrowserOutput} from '../packages/sac-multistack/src/browser-evidence.mjs';
const digest='a'.repeat(64);
const valid={schema_version:1,scenario:'vue-click',artifact_digest:digest,status:'pass',
 executed:true,codes:[],deployment_authorized:false};
test('valid pass and observed semantic failure have distinct contracts',()=>{
 const p=validateSyntheticBrowserReport(valid,'vue-click',digest);
 assert.equal(p.status,'pass');assert.ok(Object.isFrozen(p.codes));
 const f={...valid,status:'fail',codes:['no-observable-transition']};
 assert.equal(validateSyntheticBrowserReport(f,'vue-click',digest).status,'fail');
});
test('reject forged success, wrong digest, arbitrary diagnostic and deployment flag',()=>{
 const cases=[
  {...valid,executed:false},{...valid,status:'fail'},
  {...valid,artifact_digest:'b'.repeat(64)},
  {...valid,deployment_authorized:true},
  {...valid,codes:['secret']},{...valid,secret:'extra'},
  {...valid,scenario:'react-click'},
  {...valid,status:'infra-error',executed:true}
 ];
 for(const c of cases)assert.throws(
   ()=>validateSyntheticBrowserReport(c,'vue-click',digest));
});
test('require exactly one bounded tagged browser report',()=>{
 const line='SAC_MULTISTACK_BROWSER_REPORT '+JSON.stringify(valid)+'\n';
 assert.equal(decodeSyntheticBrowserOutput(line,'vue-click',digest).status,'pass');
 for(const value of ['',line+line,'SAC_MULTISTACK_BROWSER_REPORT {invalid',
   'x'.repeat(33000)])assert.throws(
   ()=>decodeSyntheticBrowserOutput(value,'vue-click',digest));
});

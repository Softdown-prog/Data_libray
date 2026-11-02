import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectKnownSyntheticAngularError} from '../scripts/sac_angular_failure_probe.mjs';

test('a known synthetic Angular diagnostic exposes code and location',()=>{
 const sample='TS2322: synthetic compiler type error\n    src/main.ts:5:7:'.replace('error\n','error\\n');
 const d=inspectKnownSyntheticAngularError(sample,5);
 assert.deepEqual({...d},{code:'TS2322',file:'src/main.ts',
   line:5,column:7,location_verified:true});
});
test('missing code, wrong file or line fails closed',()=>{
 for(const raw of [
  'src/main.ts:5:7 without code',
  'TS2322 but source path missing',
  'TS2322 src/other.ts:5:7',
  'TS2322 src/main.ts:9:7',
  'TS2322 src/main.ts:5:0',
 ])
  assert.throws(()=>inspectKnownSyntheticAngularError(raw,5),/unobserved/);
});
test('ANSI formatting cannot suppress a compiler event',()=>{
 const d=inspectKnownSyntheticAngularError(
  '\x1b[31mTS2322\x1b[0m\n\x1b[31msrc/main.ts:5:4\x1b[0m',5);
 assert.equal(d.column,4);
});
test('oversized output is rejected and never echoed',()=>{
 assert.throws(()=>inspectKnownSyntheticAngularError('SECRET='.repeat(10000),5),
  /invalid-output/);
});

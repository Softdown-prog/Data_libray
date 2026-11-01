import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RuleRegistry, execute } from '../../angular-core/src/index.mjs';
import { registerSACPRE001 } from '../src/register.mjs';
import { fixture, mutateJSON } from './fixtures.mjs';

const profile = ({ capabilities = ['angular', 'workspace'], mode = 'angular-only', version = '19.3.1', enforcement = 'observe', required = false } = {}) => ({
  schema_version: 1, profile_id: 'synthetic-preflight', angular_version: version,
  capabilities, mode, mount: '/', bundle_hints: null,
  rules: [{ rule_id: 'SAC-PRE001', version: '1.0.0', required, enforcement }]
});
const registry = () => registerSACPRE001(new RuleRegistry());

test('SAC-PRE001 registers externally as pre phase, observe does not activate promotion', async t => {
  const { workspace } = await fixture(t);
  const report = await execute({ registry: registry(), profile: profile(), resources: { workspace } });
  assert.equal(report.results[0].rule_id, 'SAC-PRE001');
  assert.equal(report.results[0].phase, 'pre');
  assert.equal(report.results[0].status, 'pass');
  assert.equal(report.promotion_allowed, false);
  assert.equal(report.coverage.passed, 0);
});
test('consumer can explicitly require proven preflight coverage', async t => {
  const { workspace } = await fixture(t);
  const report = await execute({ registry: registry(), profile: profile({ enforcement: 'blocking', required: true }), resources: { workspace } });
  assert.equal(report.status, 'pass'); assert.equal(report.promotion_allowed, true);
});
test('installed incompatibility remains visible in observe mode', async t => {
  const { workspace, packagePath } = await fixture(t);
  await mutateJSON(packagePath('@angular/compiler-cli'), p => { p.peerDependencies.typescript = '<5'; });
  const report = await execute({ registry: registry(), profile: profile(), resources: { workspace } });
  assert.equal(report.results[0].status, 'fail'); assert.equal(report.promotion_allowed, false);
});
test('missing workspace capability is not applicable and does not read resources', async () => {
  const report = await execute({ registry: registry(), profile: profile({ capabilities: ['angular'] }), resources: { workspace: '/should-not-read' } });
  assert.equal(report.results[0].status, 'not-applicable'); assert.equal(report.promotion_allowed, false);
});
test('non-Angular profile is explicitly not applicable', async () => {
  const report = await execute({ registry: registry(), profile: profile({ capabilities: [], mode: 'non-angular', version: null }) });
  assert.equal(report.results[0].status, 'not-applicable'); assert.equal(report.status, 'not-applicable');
  assert.equal(report.promotion_allowed, false);
});
test('missing required resource is unverified without executing rule', async () => {
  const report = await execute({ registry: registry(), profile: profile({ enforcement: 'blocking', required: true }) });
  assert.equal(report.results[0].status, 'unverified'); assert.equal(report.promotion_allowed, false);
});
test('profile version is a claim rather than proof', async t => {
  const { workspace } = await fixture(t);
  const report = await execute({ registry: registry(), profile: profile({ version: '99.0.0', enforcement: 'blocking', required: true }), resources: { workspace } });
  assert.equal(report.results[0].status, 'fail'); assert.equal(report.promotion_allowed, false);
});
test('precompiler execution modules have no network, process execution or writes', async () => {
  for (const file of ['../src/index.mjs', '../src/register.mjs']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls|dgram)|\b(?:fetch|eval|exec|spawn|writeFile|unlink|mkdir)\s*\(/);
    assert.doesNotMatch(source, /vps_daemon|batch_worker|git\s+(?:push|merge|checkout)|npm\s+(?:install|publish)/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { RuleRegistry, execute, validateProfile } from '../src/index.mjs';
import { dummy, profile, selection } from './helpers.mjs';

const run = (rule = dummy(), p = profile(), extras = {}) => execute({ registry: new RuleRegistry().register(rule), profile: p, ...extras });
test('external TEST-DUMMY needs no dispatcher edits; stable JSON and honest coverage', async () => {
  const a = await run(), b = await run();
  assert.equal(a.status, 'pass'); assert.equal(a.promotion_allowed, true);
  assert.deepEqual(a, b); assert.deepEqual(a.coverage, { required: 1, passed: 1 });
});
test('lexicographic topological order independent of registration and selection order', async () => {
  const rules = [dummy({ rule_id: 'C', dependencies: ['A'] }), dummy({ rule_id: 'B' }), dummy({ rule_id: 'A' })];
  const p = { ...profile(), rules: rules.map(r => selection(r.rule_id)) };
  const first = await execute({ registry: rules.reduce((r, v) => r.register(v), new RuleRegistry()), profile: p });
  const second = await execute({ registry: rules.reverse().reduce((r, v) => r.register(v), new RuleRegistry()), profile: { ...p, rules: p.rules.toReversed() } });
  assert.deepEqual(first.results.map(r => r.rule_id), ['A', 'B', 'C']); assert.deepEqual(first, second);
});
test('duplicate IDs rejected', () => assert.throws(() => new RuleRegistry().register(dummy()).register(dummy()), /Duplicate/));
for (const [name, rules, selected] of [
  ['missing dependency', [dummy({ dependencies: ['MISSING'] })], [selection()]],
  ['cycle', [dummy({ dependencies: ['B'] }), dummy({ rule_id: 'B', dependencies: ['TEST-DUMMY'] })], [selection(), selection('B')]],
  ['self cycle', [dummy({ dependencies: ['TEST-DUMMY'] })], [selection()]],
  ['unselected dependency', [dummy({ dependencies: ['B'] }), dummy({ rule_id: 'B' })], [selection()]],
  ['unknown rule', [], [selection()]],
  ['wrong version', [dummy()], [{ ...selection(), version: '2.0.0' }]]
]) test(name, async () => {
  const r = await execute({ registry: rules.reduce((r, v) => r.register(v), new RuleRegistry()), profile: { ...profile(), rules: selected } });
  assert.equal(r.status, 'fail'); assert.equal(r.promotion_allowed, false); assert.deepEqual(r.results, []);
});
for (const patch of [{ schema_version: 2 }, { command: 'curl secret' }, { capabilities: ['angular'] }, { mount: '/../' }, { mount: 'https://example.com/' }, { rules: [] }, { rules: [selection(), selection()] }, { angular_version: 'latest' }, { mode: 'other' }, { rules: [{ ...selection(), enforcement: 'off' }] }]) test('strict invalid profile fails closed', async () => {
  assert.throws(() => validateProfile({ ...profile(), ...patch }));
  assert.equal((await run(dummy(), { ...profile(), ...patch })).promotion_allowed, false);
});
for (const status of ['fail', 'unverified', 'infra-error', 'not-applicable']) test(`required ${status} blocks promotion`, async () => {
  const r = await run(dummy({ run: async () => ({ status, evidence: [{ assertion: 'checked', status, code: 'test-result' }] }) }));
  assert.equal(r.promotion_allowed, false); assert.equal(r.coverage.passed, 0);
});
test('not-applicable is not a passed test', async () => {
  const rule = dummy({ applies_when: { capabilities: ['browser'], modes: [], angular_majors: [] }, run: () => assert.fail('must not run') });
  const r = await run(rule); assert.equal(r.results[0].status, 'not-applicable'); assert.equal(r.status, 'unverified');
  const optional = await run(rule, { ...profile(), rules: [selection('TEST-DUMMY', false)] });
  assert.equal(optional.status, 'not-applicable'); assert.equal(optional.promotion_allowed, false);
});
test('version and mode applicability are declarative', async () => {
  const r = await run(dummy({ applies_when: { capabilities: [], modes: ['hybrid'], angular_majors: [22] } }));
  assert.equal(r.results[0].status, 'not-applicable');
});
for (const evidence of [[], [{ assertion: 'other', status: 'pass', code: 'missing' }], [{ assertion: 'checked', status: 'fail', code: 'contradiction' }]]) test('missing or contradictory pass evidence cannot approve', async () => {
  const r = await run(dummy({ run: () => ({ status: 'pass', evidence }) })); assert.equal(r.status, 'unverified');
});
test('unknown results and unsafe evidence fail without leaking plugin errors/logs', async () => {
  const r = await run(dummy({ run: () => { throw new Error('PRIVATE_TOKEN_VALUE'); } }));
  assert.equal(r.status, 'infra-error'); assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
  const invalid = await run(dummy({ run: () => ({ status: 'browser-pass', evidence: [], secret: 'PRIVATE_TOKEN_VALUE' }) }));
  assert.equal(invalid.status, 'infra-error'); assert.doesNotMatch(JSON.stringify(invalid), /PRIVATE/);
});
test('only safe bounded evidence fields are retained', async () => {
  const r = await run(dummy({ run: () => ({ status: 'pass', secret: 'SECRET', evidence: [{ assertion: 'checked', status: 'pass', code: 'checked', logs: 'SECRET' }] }) }));
  assert.equal(r.status, 'pass'); assert.doesNotMatch(JSON.stringify(r), /SECRET/);
});
test('dependency failure prevents dependent execution', async () => {
  const registry = new RuleRegistry().register(dummy({ rule_id: 'A', run: () => ({ status: 'fail', evidence: [{ assertion: 'checked', status: 'fail', code: 'defect' }] }) })).register(dummy({ dependencies: ['A'], run: () => assert.fail() }));
  const r = await execute({ registry, profile: { ...profile(), rules: [selection(), selection('A')] } });
  assert.equal(r.results[1].status, 'unverified');
});
test('observation never satisfies mandatory coverage', async () => {
  const r = await run(dummy(), { ...profile(), rules: [selection('TEST-DUMMY', true, 'observe')] });
  assert.equal(r.promotion_allowed, false); assert.equal(r.status, 'unverified'); assert.equal(r.coverage.passed, 0);
});
test('optional observation failure is visible without blocking covered rules', async () => {
  const registry = new RuleRegistry().register(dummy()).register(dummy({ rule_id: 'OBS', run: () => ({ status: 'fail', evidence: [{ assertion: 'checked', status: 'fail', code: 'observation' }] }) }));
  const r = await execute({ registry, profile: { ...profile(), rules: [selection(), selection('OBS', false, 'observe')] } });
  assert.equal(r.promotion_allowed, true); assert.equal(r.results[0].status, 'fail');
});
test('missing resources are unverified; analysis and resources are separated and frozen', async () => {
  assert.equal((await run(dummy({ inputs: ['dist'] }))).status, 'unverified');
  const r = await run(dummy({ inputs: ['dist'], run: ({ profile, resources, analysis }) => {
    assert.equal(resources.dist, '/synthetic'); assert.equal(analysis.parser, 'general');
    assert.ok(Object.isFrozen(profile)); assert.ok(Object.isFrozen(resources)); assert.ok(Object.isFrozen(analysis));
    return dummy().run();
  } }), profile(), { resources: { dist: '/synthetic' }, analysis: { parser: 'general' } }); assert.equal(r.status, 'pass');
});
test('rule timeout aborts cooperative operation and blocks promotion', async () => {
  let aborted = false;
  const r = await run(dummy({ run: ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(dummy().run()); })) }), profile(), { limits: { timeoutMs: 10 } });
  assert.equal(r.status, 'infra-error'); assert.equal(aborted, true);
});
test('sync overrun cannot pass', async () => {
  const r = await run(dummy({ run: () => { const start = performance.now(); while (performance.now() - start < 15) { /* intentional CPU-bound test */ } return dummy().run(); } }), profile(), { limits: { timeoutMs: 1 } });
  assert.equal(r.status, 'infra-error');
});
test('rule count and evidence budgets enforced', async () => {
  const registry = new RuleRegistry().register(dummy()).register(dummy({ rule_id: 'B' }));
  const r = await execute({ registry, profile: { ...profile(), rules: [selection(), selection('B')] }, limits: { maxRules: 1 } }); assert.equal(r.status, 'fail');
  await assert.rejects(() => run(dummy(), profile(), { limits: { timeoutMs: 999999 } }));
  const large = await run(dummy({ run: () => ({ status: 'pass', evidence: Array(3).fill({ assertion: 'checked', status: 'pass', code: 'checked' }) }) }), profile(), { limits: { maxEvidence: 2 } }); assert.equal(large.status, 'infra-error');
});
test('registry metadata errors fail before execution', () => {
  for (const patch of [{ run: 'eval()' }, { phase: 'shell' }, { assertions: [] }, { test_fixtures: [] }, { dependencies: ['x', 'x'] }, { applies_when: { capabilities: [], modes: [], angular_majors: [], command: 'shell' } }]) assert.throws(() => new RuleRegistry().register(dummy(patch)));
});
test('malformed evidence codes are rejected rather than coerced', async () => {
  for (const code of [undefined, null, 123, 'contains secret whitespace']) {
    const r = await run(dummy({ run: () => ({ status: 'pass', evidence: [{ assertion: 'checked', status: 'pass', code }] }) }));
    assert.equal(r.status, 'infra-error');
  }
});
test('total execution budget stops later rules without calling them', async () => {
  const registry = new RuleRegistry().register(dummy({ rule_id: 'A', run: () => new Promise(() => {}) })).register(dummy({ rule_id: 'B', run: () => assert.fail('total budget exceeded') }));
  const r = await execute({ registry, profile: { ...profile(), rules: [selection('A'), selection('B')] }, limits: { timeoutMs: 50, totalMs: 5 } });
  assert.equal(r.status, 'infra-error'); assert.ok(r.results.every(x => x.status === 'infra-error'));
});
test('Angular preflight profile requires no post-build hints without static-dist', async () => {
  const p = { ...profile(), mode: 'angular-only', angular_version: '24.1.0', capabilities: ['angular', 'workspace'] };
  assert.equal((await run(dummy(), p)).status, 'pass');
});

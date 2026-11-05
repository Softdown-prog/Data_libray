import Ajv from 'ajv';
import { assessRuleApplicability, describeSACCapabilities } from './capabilities.mjs';
import schema from '../schemas/profile.v1.json' with { type: 'json' };

const validate = new Ajv({ strict: true }).compile(schema);
const idPattern = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const versionPattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[A-Za-z0-9.-]{1,32})?$/;
const statuses = ['pass', 'fail', 'unverified', 'infra-error', 'not-applicable'];
const phases = ['pre', 'post', 'browser', 'deploy'];
const list = x => Array.isArray(x) && x.length <= 256 && new Set(x).size === x.length && x.every(v => typeof v === 'string' && idPattern.test(v));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export function validateProfile(profile) {
  if (!validate(profile)) throw new Error('Invalid profile v1');
  if (new Set(profile.rules.map(r => r.rule_id)).size !== profile.rules.length) throw new Error('Duplicate selected rule');
  // Angular-island HTML-only evidence must never be an optional shortcut around
  // runtime attestation. Preserve profile schema v1 and existing rule behavior.
  if (profile.rules.some(r => r.rule_id === 'SAC-P001-ISLAND-EXT' &&
      (r.required !== true || r.enforcement !== 'blocking')))
    throw new Error('Angular islands require an explicit blocking selection');
  if (profile.mode !== 'non-angular' && (!profile.angular_version || !profile.capabilities.includes('angular') || (profile.capabilities.includes('static-dist') && !profile.bundle_hints))) throw new Error('Incomplete Angular profile');
  if (profile.mode === 'non-angular' && (profile.angular_version !== null || profile.bundle_hints !== null || profile.capabilities.includes('angular'))) throw new Error('Conflicting non-Angular profile');
  if (profile.bundle_hints?.angular_entrypoints.some(p => profile.bundle_hints.legacy_react_entrypoints.includes(p))) throw new Error('Conflicting bundle hints');
  return freeze(structuredClone(profile));
}

export class RuleRegistry {
  #rules = new Map();
  register(rule) {
    const fields = ['rule_id', 'version', 'phase', 'description', 'applies_when', 'dependencies', 'inputs', 'assertions', 'severity', 'test_fixtures', 'source_incidents', 'run'];
    if (!rule || Object.keys(rule).some(k => !fields.includes(k)) || fields.some(k => !(k in rule)) ||
      !idPattern.test(rule.rule_id) || !versionPattern.test(rule.version) || !phases.includes(rule.phase) ||
      typeof rule.description !== 'string' || !rule.description.trim() || rule.description.length > 512 ||
      !['error', 'warning'].includes(rule.severity) || typeof rule.run !== 'function' ||
      !['dependencies', 'inputs', 'assertions', 'test_fixtures', 'source_incidents'].every(k => list(rule[k])) ||
      !rule.assertions.length || !rule.test_fixtures.length || !rule.applies_when ||
      Object.keys(rule.applies_when).some(k => !['capabilities', 'modes', 'angular_majors'].includes(k)) ||
      !list(rule.applies_when.capabilities) || !Array.isArray(rule.applies_when.modes) ||
      !rule.applies_when.modes.every(m => ['angular-only', 'hybrid', 'non-angular'].includes(m)) ||
      !Array.isArray(rule.applies_when.angular_majors) || !rule.applies_when.angular_majors.every(n => Number.isInteger(n) && n > 0 && n < 1000)) throw new Error('Invalid rule descriptor');
    if (this.#rules.has(rule.rule_id)) throw new Error('Duplicate rule ID');
    const { run, ...metadata } = rule;
    this.#rules.set(rule.rule_id, Object.freeze({ ...freeze(structuredClone(metadata)), run }));
    return this;
  }
  capabilities(profile) {
    // Only validated profiles and registered rule descriptors are considered.
    // This does NOT prove that capabilities are available at runtime.
    return describeSACCapabilities({
      profile:validateProfile(profile),
      registeredRules:[...this.#rules.values()]
    });
  }
  plan(selections) {
    const selected = new Map(selections.map(s => [s.rule_id, s]));
    const pending = new Map();
    for (const s of selections) {
      const rule = this.#rules.get(s.rule_id);
      if (!rule || rule.version !== s.version) throw new Error('Missing rule or incompatible version');
      if (rule.dependencies.some(dep => !selected.has(dep) || !this.#rules.has(dep))) throw new Error('Missing dependency');
      pending.set(rule.rule_id, rule);
    }
    const result = [], done = new Set();
    while (pending.size) {
      const ready = [...pending.values()].filter(r => r.dependencies.every(d => done.has(d))).sort((a, b) => compare(a.rule_id, b.rule_id));
      if (!ready.length) throw new Error('Dependency cycle');
      // Re-evaluate after each rule: tie breaks are globally lexicographic.
      const rule = ready[0]; result.push(rule); done.add(rule.rule_id); pending.delete(rule.rule_id);
    }
    return result;
  }
}

const evidence = (assertion, status, code) => ({ assertion, status, code });
function cleanOutput(output, rule, maxEvidence) {
  if (!output || !statuses.includes(output.status) || !Array.isArray(output.evidence) || output.evidence.length > maxEvidence) return { status: 'infra-error', evidence: [evidence('result', 'infra-error', 'invalid-result')] };
  // Report only bounded codes, never raw plugin objects, logs, messages or paths.
  const safe = output.evidence.map(e => {
    if (!e || typeof e.assertion !== 'string' || !idPattern.test(e.assertion) || !statuses.includes(e.status) || typeof e.code !== 'string' || !idPattern.test(e.code)) throw new Error('Invalid evidence');
    return evidence(e.assertion, e.status, e.code);
  });
  if (output.status === 'pass' && (!rule.assertions.every(a => safe.some(e => e.assertion === a && e.status === 'pass')) || safe.some(e => e.status !== 'pass'))) {
    return { status: 'unverified', evidence: [evidence('coverage', 'unverified', 'missing-evidence')] };
  }
  if (!safe.length) return { status: 'unverified', evidence: [evidence('coverage', 'unverified', 'missing-evidence')] };
  return { status: output.status, evidence: safe };
}

export async function execute({ registry, profile, resources = {}, analysis = {}, limits = {} }) {
  const bounded = { maxRules: 256, timeoutMs: 5000, totalMs: 30000, maxEvidence: 256, ...limits };
  if (Object.keys(bounded).some(k => !['maxRules', 'timeoutMs', 'totalMs', 'maxEvidence'].includes(k)) || Object.values(bounded).some(v => !Number.isInteger(v) || v < 1) || bounded.maxRules > 256 || bounded.timeoutMs > 30000 || bounded.totalMs > 60000 || bounded.maxEvidence > 1024) throw new Error('Invalid execution limits');
  let p, plan;
  try {
    p = validateProfile(profile);
    if (p.rules.length > bounded.maxRules) throw new Error('Rule budget exceeded');
    plan = registry.plan(p.rules);
  } catch {
    return { schema_version: 1, status: 'fail', promotion_allowed: false, coverage: { required: 0, passed: 0 }, results: [], diagnostics: ['invalid-profile-or-registry'] };
  }
  const results = [], completed = new Map();
  const start = performance.now();
  let totalExpired = false;
  // General analysis is provided by the trusted host; resources stay separate and
  // neither is serialized into the report. This is not a sandbox for plugin code.
  const general = freeze(structuredClone(analysis));
  const projectResources = Object.freeze({ ...resources });
  for (const rule of plan) {
    const selection = p.rules.find(s => s.rule_id === rule.rule_id);
    let result;
    if (!assessRuleApplicability(p,rule).matches) {
      result = { status: 'not-applicable', evidence: [evidence('applicability', 'not-applicable', 'profile-out-of-scope')] };
    } else if (rule.dependencies.some(d => completed.get(d).status !== 'pass')) {
      result = { status: 'unverified', evidence: [evidence('dependencies', 'unverified', 'dependency-not-passed')] };
    } else if (rule.inputs.some(input => !Object.hasOwn(projectResources, input))) {
      result = { status: 'unverified', evidence: [evidence('inputs', 'unverified', 'missing-resource')] };
    } else if (totalExpired || performance.now() - start >= bounded.totalMs) {
      result = { status: 'infra-error', evidence: [evidence('budget', 'infra-error', 'total-budget-exhausted')] };
    } else {
      const controller = new AbortController();
      const remaining = Math.min(bounded.timeoutMs, Math.max(1, bounded.totalMs - (performance.now() - start)));
      let timer;
      const ruleStart = performance.now();
      try {
        result = await Promise.race([
          Promise.resolve().then(() => rule.run({ profile: p, resources: projectResources, analysis: general, signal: controller.signal })),
          new Promise(resolve => { timer = setTimeout(() => { if (remaining < bounded.timeoutMs) totalExpired = true; controller.abort(); resolve({ status: 'infra-error', evidence: [evidence('budget', 'infra-error', 'rule-timeout')] }); }, remaining); })
        ]);
        // Detect synchronous overruns too, although they cannot be preempted.
        if (controller.signal.aborted || performance.now() - ruleStart > bounded.timeoutMs || performance.now() - start > bounded.totalMs) result = { status: 'infra-error', evidence: [evidence('budget', 'infra-error', 'execution-budget-exhausted')] };
        result = cleanOutput(result, rule, bounded.maxEvidence);
      } catch { result = { status: 'infra-error', evidence: [evidence('execution', 'infra-error', 'rule-exception')] }; }
      finally { clearTimeout(timer); controller.abort(); }
    }
    const entry = { rule_id: rule.rule_id, version: rule.version, phase: rule.phase, required: selection.required, enforcement: selection.enforcement, duration: null, ...result };
    results.push(entry); completed.set(rule.rule_id, entry);
  }
  const required = results.filter(r => r.required);
  const passed = required.filter(r => r.status === 'pass' && r.enforcement === 'blocking');
  const blocking = results.filter(r => r.required || r.enforcement === 'blocking');
  const status = ['infra-error', 'fail', 'unverified'].find(s => blocking.some(r => r.status === s)) ??
    (blocking.some(r => r.required && (r.status !== 'pass' || r.enforcement !== 'blocking')) ? 'unverified' :
      results.every(r => r.status === 'not-applicable') ? 'not-applicable' : results.some(r => r.status === 'pass' && r.enforcement === 'blocking') ? 'pass' : 'unverified');
  return { schema_version: 1, profile_id: p.profile_id, status, promotion_allowed: required.length > 0 && passed.length === required.length && status === 'pass', coverage: { required: required.length, passed: passed.length }, results, diagnostics: [] };
}

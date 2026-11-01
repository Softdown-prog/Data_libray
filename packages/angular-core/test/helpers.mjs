export const selection = (rule_id = 'TEST-DUMMY', required = true, enforcement = 'blocking') => ({ rule_id, version: '1.0.0', required, enforcement });
export const profile = () => ({ schema_version: 1, profile_id: 'synthetic', angular_version: null, capabilities: [], mode: 'non-angular', mount: '/', bundle_hints: null, rules: [selection()] });
// Externally registered test rule, absent from production registration/defaults.
export const dummy = (overrides = {}) => ({
  rule_id: 'TEST-DUMMY', version: '1.0.0', phase: 'pre', description: 'External test demonstration',
  applies_when: { capabilities: [], modes: [], angular_majors: [] }, dependencies: [], inputs: [], assertions: ['checked'],
  severity: 'warning', test_fixtures: ['positive', 'negative'], source_incidents: [],
  run: async () => ({ status: 'pass', evidence: [{ assertion: 'checked', status: 'pass', code: 'checked' }] }), ...overrides
});

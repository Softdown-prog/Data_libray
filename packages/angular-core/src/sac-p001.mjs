import { verify } from '../../angular-postcompiler/src/index.mjs';

// Opt-in adapter. Legacy verifier, contracts and CLI remain untouched.
export function registerSACP001(registry) {
  return registry.register({
    rule_id: 'SAC-P001', version: '1.0.0', phase: 'post',
    description: 'Static compiled HTML and declared entrypoint consistency',
    applies_when: { capabilities: ['angular', 'static-dist'], modes: ['angular-only', 'hybrid'], angular_majors: [] },
    dependencies: [], inputs: ['dist'], assertions: ['dist-entry-consistency'], severity: 'error',
    test_fixtures: ['root-spa', 'subpath-spa', 'hybrid-shell', 'non-angular'], source_incidents: ['SAC-002', 'SAC-004', 'SAC-005'],
    async run({ profile, resources }) {
      const legacy = await verify(resources.dist, { schema_version: 1, ...profile.bundle_hints, mode: profile.mode });
      const evidence = [{ assertion: 'dist-entry-consistency', status: legacy.status, code: 'legacy-static-result' }];
      // Check mount as an additional core contract assertion, without changing P001.
      const actual = legacy.evidence.find(e => e.assertion === 'html-resources' && e.status === 'pass');
      const mount = actual?.base_href.endsWith('/') ? actual.base_href : actual?.base_href.slice(0, actual.base_href.lastIndexOf('/') + 1);
      if (actual && mount !== profile.mount) {
        return { status: 'fail', evidence: [...evidence, { assertion: 'mount', status: 'fail', code: 'mount-mismatch' }] };
      }
      return { status: legacy.status, evidence: [...evidence, ...legacy.evidence.map(e => ({ assertion: e.assertion, status: e.status, code: 'legacy-static-check' }))] };
    }
  });
}

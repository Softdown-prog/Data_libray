import { verifyWorkspace, assertions } from './index.mjs';

export function registerSACPRE001(registry) {
  return registry.register({
    rule_id: 'SAC-PRE001', version: '1.0.0', phase: 'pre',
    description: 'Installed local Angular/TypeScript/Node toolchain compatibility',
    applies_when: { capabilities: ['angular', 'workspace'], modes: ['angular-only', 'hybrid'], angular_majors: [] },
    dependencies: [], inputs: ['workspace'], assertions: [...assertions], severity: 'error',
    test_fixtures: ['compatible', 'typescript-incompatible', 'angular-incompatible', 'isolated-apps', 'unsafe-paths'],
    source_incidents: ['SAC-001'],
    async run({ profile, resources, signal }) {
      const result = await verifyWorkspace({ workspace: resources.workspace, project: resources.project ?? '.', angularVersion: profile.angular_version, signal });
      return { status: result.status, evidence: result.evidence };
    }
  });
}

// CI host: inspect the existing isolated Angular fixture, before its official build.
// The verifier itself does not install packages, execute Angular or write reports.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { verifyWorkspace } from '../src/index.mjs';
import { registerSACPRE001 } from '../src/register.mjs';
import { RuleRegistry, execute } from '../../angular-core/src/index.mjs';

const workspace = fileURLToPath(new URL('../../angular-postcompiler/smoke/', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../../angular-postcompiler/smoke/package.json', import.meta.url), 'utf8'));
const angularVersion = manifest.dependencies['@angular/core'];
const inspection = await verifyWorkspace({ workspace, angularVersion });
assert.equal(inspection.status, 'pass', JSON.stringify(inspection.evidence));
const registry = registerSACPRE001(new RuleRegistry());
const core = await execute({ registry, profile: {
  schema_version: 1, profile_id: 'official-angular-preflight', angular_version: angularVersion,
  capabilities: ['angular', 'workspace'], mode: 'angular-only', mount: '/', bundle_hints: null,
  rules: [{ rule_id: 'SAC-PRE001', version: '1.0.0', required: false, enforcement: 'observe' }]
}, resources: { workspace } });
assert.equal(core.results[0].status, 'pass');
assert.equal(core.promotion_allowed, false);
process.stdout.write(JSON.stringify({ schema_version: 1, case: 'official-angular-installed', inspection, core }, null, 2) + '\n');

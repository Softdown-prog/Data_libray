// Isolated synthetic fixtures, never project source files or services.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { RuleRegistry, execute } from '../src/index.mjs';
import { registerSACP001 } from '../src/sac-p001.mjs';
const registry = registerSACP001(new RuleRegistry());
const matrix = [];
for (const [profile_id, host, mount, mode] of [ ['root', 'first-shell', '/', 'angular-only'], ['subpath', 'second-shell', '/tools/', 'angular-only'], ['hybrid', 'third-shell', '/mixed/', 'hybrid'] ]) {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'sac-matrix-'));
  const profile = { schema_version: 1, profile_id, angular_version: '22.0.0', capabilities: ['angular', 'static-dist'], mode, mount, bundle_hints: { index: 'index.html', angular_host: host, angular_entrypoints: ['main.js'], assets: [], legacy_react_entrypoints: ['legacy.js'] }, rules: [{ rule_id: 'SAC-P001', version: '1.0.0', required: true, enforcement: 'blocking' }] };
  try {
    const html = `<base href="${mount}"><${host}></${host}><script type="module" src="main.js"></script>${mode === 'hybrid' ? '<script src="legacy.js"></script>' : ''}`;
    await writeFile(path.join(dist, 'legacy.js'), '/* synthetic React entry */');
    for (const defect of ['none', 'missing-entry', 'wrong-root']) {
      await writeFile(path.join(dist, 'index.html'), defect === 'wrong-root' ? html.replaceAll(host, 'incorrect-shell') : html);
      await writeFile(path.join(dist, 'main.js'), '/* synthetic entry */');
      if (defect === 'missing-entry') await rm(path.join(dist, 'main.js'));
      const report = await execute({ registry, profile, resources: { dist } });
      assert.equal(report.status, defect === 'none' ? 'pass' : 'fail');
      matrix.push({ case: defect, report });
    }
  } finally { await rm(dist, { recursive: true, force: true }); }
}
const report = await execute({ registry, profile: { schema_version: 1, profile_id: 'static', angular_version: null, capabilities: [], mode: 'non-angular', mount: '/', bundle_hints: null, rules: [{ rule_id: 'SAC-P001', version: '1.0.0', required: false, enforcement: 'blocking' }] } });
assert.equal(report.status, 'not-applicable');
matrix.push({ case: 'not-applicable', report });
process.stdout.write(JSON.stringify({ schema_version: 1, matrix }, null, 2) + '\n');

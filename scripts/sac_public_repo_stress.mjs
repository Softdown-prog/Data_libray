// First-party SAC stress test; GitHub public trees/blobs are never executed.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {runPublicRepoStress} from '../packages/sac-multistack/src/public-repo-stress.mjs';

const report=await runPublicRepoStress({token:process.env.GITHUB_TOKEN});
const observed=report.repositories.filter(r=>r.metadata_status==='observed');
assert.equal(report.full_clone,false);
assert.equal(report.third_party_code_executed,false);
assert.equal(report.deployment_authorized,false);
assert.equal(report.repositories.length,5);
assert.ok(report.repositories.every(r=>r.overall_audit==='unverified'&&
 r.build==='not-run'&&r.tests==='not-run'&&r.browser==='not-run'));
const file=path.join(process.env.RUNNER_TEMP||os.tmpdir(),
 'sac-huge-public-repos.synthetic-report.json');
await writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
process.stdout.write(JSON.stringify(report)+'\n');
if(observed.length<3||
 !observed.some(r=>r.repository==='chromium/chromium'&&r.blob_files_verified>0))
 process.exitCode=1;

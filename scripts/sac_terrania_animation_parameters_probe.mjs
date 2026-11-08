/**
 * CI host adapter: only a pinned Terrania checkout, no execution of the game.
 * Git SHA verification here is independent of the AST inspector's claims.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {scanAnimationWorkspace} from '../packages/sac-multistack/src/animation-parameter-scan.mjs';

const expected='e116033578e1bab36c2c7080e10ae48b3070a54b';
const root=fileURLToPath(new URL('../.sac-snapshots/terrania-animation/',import.meta.url));
const sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{
 encoding:'utf8',timeout:5000
}).trim();
assert.equal(sha,expected,'unreviewed-terrania-source');
const fixture=fileURLToPath(new URL(
 '../packages/sac-multistack/fixtures/terrania/architecture/modules.json',import.meta.url));
const sourceIndex=await readFile(path.join(root,'architecture/modules.json'),'utf8');
assert.equal(sourceIndex,await readFile(fixture,'utf8'),
 'terrania-module-map-changed');
const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',
 import.meta.url));
const ts=require('typescript');
const observed=await scanAnimationWorkspace({workspace:root,typescript:ts});
assert.equal(observed.scan_completed,true,JSON.stringify(observed));
assert.ok(observed.source_files>=20,'expected actual renderer/actor/simulation/game sources');
assert.ok(observed.parameters_observed>=5,'expected game animation parameters');
assert.ok(observed.render_or_timer_calls>0,'expected real renderer/timing API usage');
assert.equal(observed.parse_error_files,0);
assert.equal(observed.status,'unverified');
assert.equal(observed.runtime_execution_verified,false);
assert.equal(observed.deployment_authorized,false);
const output={
 schema_version:1,kind:'sac-pinned-terrania-animation-parameter-observation',
 repository:'Softdown-prog/Terrania',source_commit:expected,
 source_git_revision_verified:true,
 module_manifest_sha256:observed.module_manifest_sha256,
 source_snapshot_sha256:observed.source_snapshot_sha256,
 scoped_modules:observed.modules,scoped_roots:observed.roots,
 source_files_checked:observed.source_files,
 candidate_parameters:observed.parameters_observed,
 dynamic_parameters:observed.dynamic_parameters,
 renderer_or_timer_calls:observed.render_or_timer_calls,
 findings:observed.candidate_findings.slice(0,12),
 inspected_source_paths:observed.candidate_paths.slice(0,12),
 observation_status:'unverified',runtime_test:'not-run',
 browser_test:'not-run',frame_rate_test_on_game:'not-run',
 deployment_authorized:false
};
assert.ok(JSON.stringify(output).length<16000);
process.stdout.write(JSON.stringify(output)+'\n');

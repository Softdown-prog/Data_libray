/**
 * Actual source-only game scan: pinned Lan House Simulator, no game execution.
 * The host installs ONLY the already-pinned TypeScript parser of the SAC.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {scanProceduralCanvasWorkspace} from '../packages/sac-multistack/src/procedural-canvas-stream.mjs';

const root=fileURLToPath(new URL('../.sac-snapshots/lhs-procedural/',import.meta.url));
const expected='6256f7cbbc835cc8cff4121dca51f5f855ea784e';
const actual=execFileSync('git',['-C',root,'rev-parse','HEAD'],{
 encoding:'utf8',timeout:5000
}).trim();
assert.equal(actual,expected,'unreviewed-game-revision');
const require=createRequire(new URL('../packages/angular-postcompiler/smoke/package.json',import.meta.url));
const ts=require('typescript');
const result=await scanProceduralCanvasWorkspace({
 workspace:root,sourceRoot:'games/lan_house_simulator',typescript:ts,
 maxFiles:20000,maxBytes:256*1024*1024,maxElapsedMs:180000
});
assert.equal(result.scan_completed,true,JSON.stringify(result.findings));
assert.ok(result.inventory.source_files>=300,'expected-real-game-source-coverage');
assert.match(result.snapshot_sha256,/^[a-f0-9]{64}$/);
assert.equal(result.status,'unverified');
assert.equal(result.runtime_verified,false);
assert.equal(result.deployment_authorized,false);
const output={
 schema_version:1,kind:'sac-pinned-lhs-procedural-canvas-source-observation',
 repository:'Softdown-prog/A7-forge-2D-',
 source_commit:expected,
 source_git_revision_verified:true,
 inventory:result.inventory,
 signals:result.signals,
 candidate_paths:result.candidate_paths,
 syntax_diagnostics_observed:result.inventory.parse_error_files,
 source_snapshot_sha256:result.snapshot_sha256,
 scan_completed:result.scan_completed,
 canvas_pixel_test_on_game:'not-run',
 procedural_runtime_test_on_game:'not-run',
 compile_and_build_on_game:'not-run',
 deployment_authorized:false
};
assert.ok(JSON.stringify(output).length<20000);
process.stdout.write(JSON.stringify(output)+'\n');

// SAC-008D: a real Angular official build happens only in a constrained Docker
// container. CI host reads the sources and signs the resulting dist (not build).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, symlink, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedAngularBuild } from './sac_sandbox_builder.mjs';
import { prepareBuild, sealBuild, auditPipeline } from '../packages/angular-pipeline/src/index.mjs';
import { verifyPipelineBrowserSandbox } from '../packages/angular-guardian/src/sandbox.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = path.join(root,'packages/angular-guardian/smoke');
const sourceSha = process.env.GITHUB_SHA ?? spawnSync('git',['rev-parse','HEAD'],
  { cwd:root, encoding:'utf8' }).stdout.trim();
const image = process.env.SAC_SANDBOX_IMAGE;
assert.match(sourceSha, /^[a-f0-9]{40}$/);
const key = randomBytes(32);
const profile = { schema_version:1, profile_id:'isolated-builder-ci', angular_version:'22.0.0',
  capabilities:['angular','workspace','static-dist'], mode:'angular-only', mount:'/',
  bundle_hints:{index:'index.html',angular_host:'sac-smoke',angular_entrypoints:['main.js'],
    assets:['styles.css'],legacy_react_entrypoints:[]},
  rules:['SAC-PRE001','SAC-P001'].map(rule_id=>({
    rule_id,version:'1.0.0',required:true,enforcement:'blocking'
  })) };
const resources = {workspace,dist:'dist/browser',
  sourceFiles:['package.json','package-lock.json','angular.json','tsconfig.json',
    'src/main.ts','src/mode.ts','src/index.html','src/styles.css']};
const guardian = {schema_version:1,timeout_ms:2000,cases:[{
  id:'click',path:'/',expect_visible:['h1'],actions:[{click:'button',expect_visible:'.done'}]
}]};
await writeFile(path.join(workspace,'src/mode.ts'),"export const mode: string = 'positive';\n");
await writeFile(path.join(workspace,'src/index.html'),
  '<html><head><base href="/"></head><body><sac-smoke></sac-smoke></body></html>');
await rm(path.join(workspace,'dist'),{recursive:true,force:true});
const setup = {profile,resources,key,sourceSha};
const {session,report:pre} = await prepareBuild(setup);
assert.ok(session,JSON.stringify(pre));

// Negative: untrusted project string must never become a shell/container command.
const denied = await isolatedAngularBuild({resources,projectName:'smoke;id',image});
assert.equal(denied.built,false);
assert.equal(denied.deployment_authorized,false);

const build = await isolatedAngularBuild({resources,projectName:'smoke',image,timeoutMs:120000});
assert.equal(build.status,'pass',JSON.stringify(build));
assert.equal(build.network,'none');
assert.equal(build.deployment_authorized,false);

const receipt = await sealBuild({...setup,session,buildStatus:'pass'});
const staticReport = await auditPipeline({...setup,receipt});
assert.equal(staticReport.static_pipeline_pass,true,JSON.stringify(staticReport));
const browser = await verifyPipelineBrowserSandbox({pipeline:{...setup,receipt},
  guardian,timeoutMs:60000,image});
assert.equal(browser.static_pipeline_pass,true,JSON.stringify(browser));
assert.equal(browser.browser_pass,true,JSON.stringify(browser));
assert.equal(browser.network_isolation,'container-network-none');
assert.equal(browser.deployment_authorized,false);
const altered = await auditPipeline({...setup,receipt:{...receipt,authentication:'0'.repeat(64)}});
assert.equal(altered.static_pipeline_pass,false);

// A pre-existing output cannot be replaced, even with a previously verified CI build.
const repeat = await isolatedAngularBuild({resources,projectName:'smoke',image});
assert.equal(repeat.status,'infra-error');
assert.equal(repeat.code,'dist-already-exists');

// A symlink destination parent cannot send output outside the workspace.
const temp = await mkdtemp(path.join(os.tmpdir(),'sac-builder-parent-'));
try {
  await symlink(temp,path.join(workspace,'linked-dist'));
  const bad = await isolatedAngularBuild({resources:{...resources,dist:'linked-dist/browser'},
    projectName:'smoke',image});
  assert.equal(bad.status,'infra-error');
  assert.equal(bad.code,'dist-parent-unsafe');
} finally {
  await rm(path.join(workspace,'linked-dist'),{force:true});
  await rm(temp,{force:true,recursive:true});
}
console.log('SAC-008D real Angular AOT isolated Docker build + authenticated SAC + Chromium PASS');

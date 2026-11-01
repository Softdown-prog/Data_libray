import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dockerBuildArgs, isolatedAngularBuild } from '../scripts/sac_sandbox_builder.mjs';

const image = 'mcr.microsoft.com/playwright@sha256:'+'a'.repeat(64);
const base = { image, work: '/tmp/build/work', dependencies: '/tmp/fixture/node_modules',
  name: 'sac-build-'+'b'.repeat(20), projectName: 'smoke', uid: 1001, gid: 1001 };

test('docker controls are fixed and no network or privileges', () => {
  const a = dockerBuildArgs(base);
  for (const value of ['--network','none','--read-only','--cap-drop','ALL','--pids-limit',
    '128','--memory','1024m','--memory-swap','1024m','--cpus','1','--pull','never',
    '--security-opt','no-new-privileges','--user','1001:1001']) assert.ok(a.includes(value), value);
  assert.ok(a.includes('node_modules/@angular/cli/bin/ng.js'));
  assert.deepEqual(a.slice(-4), [image, 'node', 'node_modules/@angular/cli/bin/ng.js', 'build'].slice(0,0).concat(
    [image,'node','node_modules/@angular/cli/bin/ng.js','build','smoke']).slice(-4));
  assert.ok(!a.includes('--privileged'));
  assert.ok(!a.includes('--cap-add'));
  assert.ok(!a.includes('--no-sandbox'));
  assert.ok(a.some(s => s.endsWith(',readonly')));
});

test('cannot choose Docker image by mutable tag or arbitrary commands', () => {
  for (const config of [
    { image: 'mcr.microsoft.com/playwright:latest' }, { image: 'busybox@sha256:'+'a'.repeat(64) },
    { projectName: '../../bin/bash' }, { projectName: 'smoke;id' },
    { work: 'relative' }, { dependencies: '/tmp/with,comma' },
    { name: 'evil' }, { uid: 0 }, { gid: 0 },
  ]) assert.throws(() => dockerBuildArgs({ ...base, ...config }));
});

test('invalid input and nonexistent workspace fail without starting build', async () => {
  const bad = await isolatedAngularBuild({ resources: {workspace:'/does-not-exist', dist:'dist/browser',
      sourceFiles: ['package.json']}, projectName:'smoke', image });
  assert.equal(bad.built, false);
  assert.equal(bad.deployment_authorized, false);
  const tag = await isolatedAngularBuild({ resources: {workspace:'/tmp', dist:'dist/browser',
      sourceFiles:['package.json']}, projectName:'smoke', image:'ng:latest' });
  assert.equal(tag.status, 'infra-error');
});

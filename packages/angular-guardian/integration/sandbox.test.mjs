import test from 'node:test';
import assert from 'node:assert/strict';
import { dockerArguments, runSandbox } from '../src/sandbox.mjs';
const image = 'mcr.microsoft.com/playwright@sha256:' + 'a'.repeat(64);
const fixture = { image, runtime: '/tmp/sac/runtime', dist: '/tmp/sac/dist',
  input: '/tmp/sac/input.json', containerName: 'sac-browser-fixture' };
test('Docker runner enforces a private network, limits and read-only mounts', () => {
  const args = dockerArguments(fixture).join(' ');
  for (const expected of ['--network none', '--read-only', '--user 1000:1000',
    '--cap-drop ALL', '--security-opt no-new-privileges', '--pids-limit 128',
    '--memory 768m', '--memory-swap 768m', '--cpus 1', 'seccomp=',
    'SAC_BROWSER_SANDBOX=required', 'readonly']) assert.ok(args.includes(expected), expected);
  assert.equal(args.includes('--privileged'), false);
  assert.equal(args.includes('/var/run/docker.sock'), false);
});
test('runner rejects mutable or untrusted images and dangerous mount syntax', () => {
  for (const value of ['mcr.microsoft.com/playwright:v1.64.1-noble', 'alpine@sha256:' + 'a'.repeat(64), image + ' && evil']) {
    assert.throws(() => dockerArguments({ ...fixture, image: value }));
  }
  assert.throws(() => dockerArguments({ ...fixture, runtime: '/tmp/a,ro' }));
});
test('missing trusted image is infra-error, never unisolated fallback', async () => {
  const r = await runSandbox({ timeoutMs: 5000 }, { image: '' });
  assert.equal(r.status, 'infra-error');
  assert.equal(r.executed, false);
});

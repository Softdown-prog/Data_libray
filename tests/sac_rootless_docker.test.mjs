import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dockerChildEnvironment } from '../packages/angular-guardian/src/docker-environment.mjs';

test('rootless endpoint propagates only when explicitly required', () => {
  const env = dockerChildEnvironment({PATH:'/usr/bin',SAC_ROOTLESS_REQUIRED:'1',
    DOCKER_HOST:'unix:///run/user/1002/docker.sock',DOCKER_CERT_PATH:'/secrets'});
  assert.equal(env.DOCKER_HOST, 'unix:///run/user/1002/docker.sock');
  assert.equal(env.DOCKER_CERT_PATH, undefined);
  assert.equal(env.SAC_ROOTLESS_REQUIRED, '1');
});
test('cannot fall back to rootful or TCP daemon with explicit gate', () => {
  for(const host of ['', 'unix:///var/run/docker.sock', 'tcp://127.0.0.1:2375',
    'unix:///run/user/0/docker.sock','unix:///run/user/1002/../docker.sock']){
    assert.throws(() => dockerChildEnvironment({SAC_ROOTLESS_REQUIRED:'1',DOCKER_HOST:host}));
  }
});
test('normal CI cannot inherit arbitrary Docker targets', () => {
  const env=dockerChildEnvironment({PATH:'/bin',DOCKER_HOST:'tcp://evil:2375'});
  assert.equal(env.DOCKER_HOST,undefined);
  assert.throws(() => dockerChildEnvironment({SAC_ROOTLESS_REQUIRED:'yes'}));
});

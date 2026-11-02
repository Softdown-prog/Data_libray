// Explicit rootless Docker routing for SAC-008F; no inherited arbitrary Docker settings.
// Legacy GitHub Actions CI continues using the runner's local disposable Docker.
import os from 'node:os';

const hostPattern = /^unix:\/\/\/run\/user\/[1-9][0-9]{0,9}\/docker\.sock$/;

export function dockerChildEnvironment(env = process.env) {
  const result = { PATH: env.PATH ?? '/usr/bin:/bin', HOME: os.tmpdir() };
  if (env.SAC_ROOTLESS_REQUIRED === '1') {
    if (typeof env.DOCKER_HOST !== 'string' || !hostPattern.test(env.DOCKER_HOST)) {
      throw new Error('rootless-docker-host-required');
    }
    result.DOCKER_HOST = env.DOCKER_HOST;
    result.SAC_ROOTLESS_REQUIRED = '1';
  } else if (env.SAC_ROOTLESS_REQUIRED !== undefined && env.SAC_ROOTLESS_REQUIRED !== '0') {
    throw new Error('invalid-rootless-requirement');
  }
  return result;
}

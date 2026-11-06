// SAC-008D. Host selected files and pinned image only; no shell or npm scripts.
// Angular build runs inside Docker, not on the One Worker host.
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { dockerChildEnvironment } from '../packages/angular-guardian/src/docker-environment.mjs';
import { collectAngularCompilerFailure } from './sac_compiler_evidence.mjs';
import { collectAngularCompilerWarnings } from './sac_angular_warning_evidence.mjs';

const pinned = /^mcr\.microsoft\.com\/playwright@sha256:[0-9a-f]{64}$/;
const angularName = /^[a-z][a-z0-9-]{0,63}$/;
const safe = value => typeof value === 'string' && value.length > 0 && value.length < 400 &&
  !/[\\%?:#\x00-\x20\x7f]/.test(value) && !value.startsWith('/') &&
  value.split('/').every(v => v.length && v !== '.' && v !== '..' &&
    v !== '.git' && v !== 'node_modules' && v !== '.env' && !v.startsWith('.env.'));
const within = (root, candidate) => candidate.startsWith(root + path.sep);
const issue = code => Object.assign(new Error(code), { code });

export function dockerBuildArgs({ image, work, dependencies, name, projectName, uid, gid }) {
  if (!pinned.test(image) || !path.isAbsolute(work) || !path.isAbsolute(dependencies) ||
    !/^sac-build-[0-9a-f]{20}$/.test(name) || !angularName.test(projectName) ||
    work.includes(',') || dependencies.includes(',') ||
    !Number.isInteger(uid) || !Number.isInteger(gid) || uid < 1 || gid < 1 ||
    uid > 1000000000 || gid > 1000000000) throw issue('invalid-build-config');
  return [
    'run', '--rm', '--init', '--pull', 'never', '--name', name,
    '--network', 'none', '--read-only', '--user', uid + ':' + gid,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '128', '--cpus', '1', '--memory', '1024m', '--memory-swap', '1024m',
    '--shm-size', '128m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m,mode=1777',
    '--workdir', '/opt/sac-work', '--env', 'HOME=/tmp',
    '--env', 'CI=true', '--env', 'NG_CLI_ANALYTICS=false',
    '--mount', 'type=bind,src=' + work + ',dst=/opt/sac-work',
    '--mount', 'type=bind,src=' + dependencies + ',dst=/opt/sac-work/node_modules,readonly',
    image, 'node', 'node_modules/@angular/cli/bin/ng.js', 'build', projectName,
  ];
}

async function noSymlink(root, relative) {
  let cursor = root;
  for (const p of relative.split('/')) {
    cursor = path.join(cursor, p);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) throw issue('source-symlink');
  }
  return cursor;
}

async function stageSelected(workspace, stage, files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 2048 ||
    files.some(f => !safe(f)) || new Set(files).size !== files.length ||
    !files.includes('package.json') || !files.includes('angular.json') ||
    !files.includes('package-lock.json')) throw issue('unsafe-source-list');
  let bytes = 0;
  for (const file of files) {
    const source = await noSymlink(workspace, file);
    const stat = await lstat(source);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024 ||
      (bytes += stat.size) > 64 * 1024 * 1024) throw issue('source-budget');
    const dest = path.join(stage, file);
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o755 });
    await copyFile(source, dest, constants.COPYFILE_EXCL);
    await chmod(dest, 0o644);
  }
}

// Reject symlinks, special files and oversized/unexpected generated output.
async function inspectDist(dir, depth = 0, budget = { files: 0, bytes: 0 }) {
  if (depth > 24) throw issue('dist-depth-limit');
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw issue('dist-symlink');
    if (entry.isDirectory()) await inspectDist(target, depth + 1, budget);
    else {
      const stat = await lstat(target);
      budget.files++;
      budget.bytes += stat.size;
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024 ||
        budget.files > 4096 || budget.bytes > 64 * 1024 * 1024) throw issue('dist-budget');
    }
  }
  return budget;
}

async function safeOutputParents(workspace, relative) {
  let current = workspace;
  const parts = relative.split('/');
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    try {
      const st = await lstat(current);
      if (!st.isDirectory() || st.isSymbolicLink()) throw issue('dist-parent-unsafe');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Later mkdir will create a directory under an already inspected parent.
    }
  }
}

async function publishTree(source, dest) {
  await mkdir(dest, { mode: 0o755 });
  for (const item of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, item.name);
    const to = path.join(dest, item.name);
    if (item.isDirectory()) await publishTree(from, to);
    else await copyFile(from, to, constants.COPYFILE_EXCL);
  }
}

export async function isolatedAngularBuild({ resources, projectName, image,
  timeoutMs = 120000, docker = 'docker' }) {
  const failure = code => ({ status: 'infra-error', code, built: false, network: 'none',
    deployment_authorized: false });
  if (typeof resources !== 'object' || !resources ||
    !path.isAbsolute(resources.workspace ?? '') || !safe(resources.dist) ||
    resources.dist.split('/').includes('node_modules') ||
    !pinned.test(image) || !angularName.test(projectName) ||
    !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000 ||
    docker !== 'docker') return failure('build-config-invalid');
  let stage;
  let name;
  try {
    const workspace = await realpath(resources.workspace);
    const dependencies = await noSymlink(workspace, 'node_modules');
    if (!(await lstat(dependencies)).isDirectory()) throw issue('dependencies-missing');
    const destination = path.join(workspace, resources.dist);
    if (!within(workspace, destination)) throw issue('dist-outside-workspace');
    await safeOutputParents(workspace, resources.dist);
    // Never overwrite a previous output, even after a failed attempt.
    try { await lstat(destination); throw issue('dist-already-exists'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 0;
    if (uid === 0 || gid === 0) throw issue('build-host-user-root');
    stage = await mkdtemp(path.join(os.tmpdir(), 'sac-build-'));
    const work = path.join(stage, 'work');
    await mkdir(work, { mode: 0o700 });
    await stageSelected(workspace, work, resources.sourceFiles);
    name = 'sac-build-' + randomUUID().replaceAll('-', '').slice(0, 20);
    const args = dockerBuildArgs({ image, work, dependencies, name, projectName, uid, gid });
    const result = spawnSync(docker, args, { shell: false, encoding: 'utf8',
      timeout: timeoutMs, maxBuffer: 16384,
      env: dockerChildEnvironment() });
    if (result.error?.code === 'ETIMEDOUT') return failure('build-timeout');
    if (result.error || result.signal) return failure('build-failed');
    if (result.status !== 0) {
      const evidence = collectAngularCompilerFailure({
        stdout:result.stdout,stderr:result.stderr,exitCode:result.status,
        sourceFiles:resources.sourceFiles
      });
      // Only explicitly recognized TypeScript diagnostics count as code failure.
      // An unknown Docker exit code remains an infrastructure error.
      return evidence ? {status:'fail',code:'angular-compiler-failed',built:false,
        network:'none',deployment_authorized:false,compiler_evidence:evidence}
        : failure('build-failed');
    }
    const output = path.join(work, resources.dist);
    await inspectDist(output);
    // Publish only to a previously empty output location.
    try { await lstat(destination); throw issue('dist-already-exists'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    await safeOutputParents(workspace, resources.dist);
    await mkdir(path.dirname(destination), { recursive: true });
    await publishTree(output, destination);
    // The official Angular CLI completed in Docker, but warning parsing alone
    // cannot authenticate compiler provenance or approve the deployment.
    const compiler_warnings = collectAngularCompilerWarnings({
      stdout:result.stdout,stderr:result.stderr,exitCode:result.status,
      sourceFiles:resources.sourceFiles
    });
    return { status: 'pass', code: 'isolated-angular-build', built: true,
      network: 'none', compiler_warnings, deployment_authorized: false };
  } catch (error) {
    return failure(['source-symlink', 'source-budget', 'unsafe-source-list',
      'dist-already-exists', 'dist-symlink', 'dist-budget', 'dist-depth-limit',
      'dependencies-missing', 'dist-parent-unsafe', 'build-host-user-root'].includes(error?.code) ? error.code : 'build-infra-error');
  } finally {
    if (name) spawnSync('docker', ['rm', '--force', name],
      { stdio: 'ignore', timeout: 10000,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.tmpdir() } });
    if (stage) await rm(stage, { force: true, recursive: true });
  }
}

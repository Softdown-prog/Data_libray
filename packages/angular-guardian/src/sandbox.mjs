import { cp, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { verifyPipelineBrowser } from './pipeline.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const seccomp = fileURLToPath(new URL('../sandbox/seccomp_profile.json', import.meta.url));
const imagePattern = /^mcr\.microsoft\.com\/playwright@sha256:[0-9a-f]{64}$/;
const failure = code => ({ status: 'infra-error', executed: false, code, cases: [] });

/** Fixed docker options: contracts cannot select commands, paths, networks or privileges. */
export function dockerArguments({ image, runtime, dist, input, containerName }) {
  if (!imagePattern.test(image) || !/^[a-z][a-z0-9-]{1,58}$/.test(containerName) ||
      ![runtime, dist, input].every(p => path.isAbsolute(p) && !p.includes(','))) {
    throw new Error('Invalid trusted sandbox arguments');
  }
  return [
    'run', '--rm', '--init', '--name', containerName, '--pull', 'never',
    '--network', 'none', '--read-only', '--user', '1000:1000',
    '--cap-drop', 'ALL', '--cap-add', 'SYS_CHROOT', '--security-opt', 'no-new-privileges',
    '--security-opt', 'seccomp=' + seccomp,
    '--pids-limit', '128', '--memory', '768m', '--memory-swap', '768m',
    '--cpus', '1', '--shm-size', '256m',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m,mode=1777',
    '--mount', 'type=bind,src=' + runtime + ',dst=/opt/sac-runtime,readonly',
    '--mount', 'type=bind,src=' + dist + ',dst=/opt/sac-dist,readonly',
    '--mount', 'type=bind,src=' + input + ',dst=/opt/sac-input.json,readonly',
    '--env', 'HOME=/tmp', '--env', 'SAC_BROWSER_SANDBOX=required',
    ...(process.env.SAC_SANDBOX_DIAGNOSTICS === '1' ? ['--env', 'SAC_BROWSER_DIAGNOSTICS=1'] : []),
    '--env', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    image, 'node', '/opt/sac-runtime/src/sandbox-entry.mjs'
  ];
}

function parseReport(output, contract) {
  if (typeof output !== 'string' || output.length > 131072) return failure('sandbox-output-limit');
  const lines = output.trim().split('\n').filter(s => s.startsWith('SAC_BROWSER_REPORT '));
  if (lines.length !== 1) return failure('sandbox-report-missing');
  let raw;
  try { raw = JSON.parse(lines[0].slice('SAC_BROWSER_REPORT '.length)); }
  catch { return failure('sandbox-report-invalid'); }
  if (!raw || !['pass', 'fail', 'infra-error'].includes(raw.status) ||
      typeof raw.executed !== 'boolean' || !Array.isArray(raw.cases) ||
      raw.cases.length > contract.cases.length ||
      raw.cases.some((c, i) => !c || c.id !== contract.cases[i].id ||
        !['pass', 'fail'].includes(c.status) || !Array.isArray(c.codes) || c.codes.length > 32 ||
        c.codes.some(code => typeof code !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(code))) ||
      (raw.status === 'pass' && (!raw.executed || raw.cases.length !== contract.cases.length || raw.cases.some(c => c.status !== 'pass'))) ||
      (raw.status === 'fail' && (raw.cases.length !== contract.cases.length || raw.cases.every(c => c.status === 'pass')))) return failure('sandbox-report-invalid');
  return { status: raw.status, executed: raw.executed, code: raw.status === 'pass' ? 'isolated-chromium-pass' : (raw.status === 'infra-error' && /^[a-z][a-z0-9-]{0,63}$/.test(raw.code) ? raw.code : 'isolated-chromium-result'),
    cases: raw.cases.map(c => ({ id: c.id, status: c.status, codes: c.codes })), sandbox: 'docker-network-none' };
}

/** Docker never receives the authenticated CI receipt, workspace, HMAC key or secrets. */
export async function runSandbox({ contract, binding, dist, mount, host, timeoutMs }, { image = process.env.SAC_SANDBOX_IMAGE } = {}) {
  if (!imagePattern.test(image) || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) return failure('sandbox-config-invalid');
  const stage = await mkdtemp(path.join(os.tmpdir(), 'sac-sandbox-'));
  const runtime = path.join(stage, 'runtime'), snapshot = path.join(stage, 'dist'), input = path.join(stage, 'input.json');
  const name = 'sac-browser-' + randomUUID().replaceAll('-', '').slice(0, 22);
  try {
    await mkdir(path.join(runtime, 'src'), { recursive: true });
    await mkdir(path.join(runtime, 'node_modules'), { recursive: true });
    for (const f of ['browser-worker.mjs', 'browser-contract.mjs', 'artifact-server.mjs', 'sandbox-entry.mjs']) {
      await cp(path.join(root, 'src', f), path.join(runtime, 'src', f));
    }
    for (const m of ['playwright', 'playwright-core']) {
      await cp(path.join(root, 'node_modules', m), path.join(runtime, 'node_modules', m), { recursive: true, dereference: false });
    }
    await cp(dist, snapshot, { recursive: true, dereference: false, force: false, errorOnExist: true });
    await writeFile(input, JSON.stringify({ contract, digest: binding.artifact_digest, dist: '/opt/sac-dist', mount, host,
      routes: contract.cases.map(c => c.path) }), { mode: 0o644 });
    await chmod(stage, 0o755);
    await chmod(runtime, 0o755);
    await chmod(path.join(runtime, 'src'), 0o755);
    await chmod(path.join(runtime, 'node_modules'), 0o755);
    await chmod(snapshot, 0o755);
    const args = dockerArguments({ image, runtime, dist: snapshot, input, containerName: name });
    const proc = spawnSync('docker', args, { encoding: 'utf8', shell: false, timeout: timeoutMs,
      maxBuffer: 131072, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.tmpdir() } });
    if (process.env.SAC_SANDBOX_DIAGNOSTICS === '1') process.stderr.write('SAC_SANDBOX_DIAGNOSTICS ' + String(proc.stderr ?? '').slice(-2400) + '\n');
    if (proc.error?.code === 'ETIMEDOUT') return failure('sandbox-timeout');
    if (proc.error || proc.status !== 0 || proc.signal) return failure('sandbox-runtime-error');
    return parseReport(proc.stdout, contract);
  } catch {
    return failure('sandbox-preparation-error');
  } finally {
    // Cleanup named container even when the CLI times out or fails mid-run.
    spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore', timeout: 10000,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.tmpdir() } });
    await rm(stage, { recursive: true, force: true });
  }
}

/** Explicitly selected by a trusted host; never chosen by a JSON contract. */
export async function verifyPipelineBrowserSandbox({ pipeline, guardian, timeoutMs = 60000, image } = {}) {
  const report = await verifyPipelineBrowser({ pipeline, guardian, timeoutMs,
    runBrowser: params => runSandbox(params, { image }) });
  if (report.browser?.sandbox === 'docker-network-none') {
    report.network_isolation = 'container-network-none';
    report.sandbox_controls = { network: 'none', root_filesystem: 'read-only', mounts: 'runtime-snapshot-only',
      uid: 1000, capabilities: 'only-SYS_CHROOT', no_new_privileges: true,
      cpu_limit: '1', memory_limit: '768m', pid_limit: 128,
      chromium_sandbox: 'required', container: 'ephemeral' };
  }
  return report;
}

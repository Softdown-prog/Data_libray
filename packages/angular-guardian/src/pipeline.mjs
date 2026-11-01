import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { auditPipeline } from '../../angular-pipeline/src/index.mjs';
import { browserContract } from './browser-contract.mjs';

export async function verifyPipelineBrowser({ pipeline, guardian, timeoutMs = 60000 }) {
  const staticResult = await auditPipeline(pipeline);
  const output = { schema_version: 1, static_pipeline_pass: staticResult.static_pipeline_pass, browser_pass: false, deployment_authorized: false, status: staticResult.status, static_result: staticResult, browser: { status: 'unverified', executed: false, code: 'not-executed' }, deploy: { status: 'unverified', executed: false }, network_isolation: 'application-routing-external-sandbox-required' };
  if (!staticResult.static_pipeline_pass) { if (staticResult.status === 'not-applicable') output.browser.status = 'not-applicable'; return output; }
  output.status = 'unverified';
  if (!guardian) { output.browser.code = 'contract-missing'; return output; }
  let contract;
  try { contract = browserContract(guardian); if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error(); }
  catch { output.status = 'fail'; output.browser = { status: 'fail', executed: false, code: 'invalid-browser-contract' }; return output; }
  const binding = { profile_digest: staticResult.profile_digest, source_sha_claim: staticResult.source_sha_claim, artifact_digest: staticResult.phases.build.artifact_digest };
  output.binding = { ...binding, guardian_digest: createHash('sha256').update(JSON.stringify(contract)).digest('hex') };
  let child;
  try { child = fork(new URL('./browser-worker.mjs', import.meta.url), [], { execArgv: ['--max-old-space-size=256'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), '.cache', 'ms-playwright') } }); }
  catch { output.status = 'infra-error'; output.browser = { status: 'infra-error', executed: false, code: 'worker-unavailable' }; return output; }
  output.browser = await new Promise(resolve => {
    let done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); const kill = setTimeout(() => child.kill('SIGKILL'), 1000); kill.unref(); finish({ status: 'infra-error', executed: false, code: 'browser-timeout' }); }, timeoutMs);
    child.once('error', () => finish({ status: 'infra-error', executed: false, code: 'worker-unavailable' }));
    child.once('exit', () => finish({ status: 'infra-error', executed: false, code: 'worker-exited' }));
    child.once('message', value => {
      if (!value || !['pass', 'fail', 'infra-error'].includes(value.status) || !Array.isArray(value.cases) || (value.status === 'pass' && (value.cases.length !== contract.cases.length || value.cases.some((c, i) => c.id !== contract.cases[i].id || c.status !== 'pass')))) finish({ status: 'unverified', executed: false, code: 'worker-evidence-incomplete' });
      else finish(value);
    });
    try { child.send({ contract, digest: binding.artifact_digest, dist: path.resolve(pipeline.resources.workspace, pipeline.resources.dist), mount: pipeline.profile.mount, host: pipeline.profile.bundle_hints.angular_host, routes: contract.cases.map(c => c.path) }, error => { if (error) finish({ status: 'infra-error', executed: false, code: 'worker-ipc-error' }); }); }
    catch { finish({ status: 'infra-error', executed: false, code: 'worker-ipc-error' }); }
  });
  const after = await auditPipeline(pipeline);
  if (!after.static_pipeline_pass || after.profile_digest !== binding.profile_digest || after.phases.build.artifact_digest !== binding.artifact_digest) output.browser = { status: 'fail', executed: output.browser.executed, code: 'artifact-mutated-during-browser' };
  output.status = output.browser.status;
  output.browser_pass = output.browser.status === 'pass' && output.browser.executed === true;
  return output;
}

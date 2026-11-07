import { constants } from 'node:fs';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { realpath, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { RuleRegistry, execute, validateProfile } from '../../angular-core/src/index.mjs';
import { registerSACPRE001 } from '../../angular-precompiler/src/register.mjs';
import { registerSACP001 } from '../../angular-core/src/sac-p001.mjs';

const hex = /^[a-f0-9]{64}$/;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const relative = value => typeof value === 'string' && value.length <= 512 && value && !value.startsWith('/') && !/[\\%?:#\x00-\x20\x7f]/.test(value) && value.split('/').every(v => v && v !== '.' && v !== '..');
class Stop extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const stop = (status, code) => { throw new Stop(status, code); };
const registry = () => registerSACP001(registerSACPRE001(new RuleRegistry()));
const pending = () => ({ status: 'unverified', executed: false, code: 'not-executed' });
function initial() {
  return { schema_version: 1, status: 'unverified', static_pipeline_pass: false, deployment_authorized: false, phases: { pre: pending(), build: pending(), post: pending(), browser: pending(), deploy: pending() } };
}
function validate(p) {
  const profile = validateProfile(p);
  if (profile.mode === 'non-angular') return profile;
  if (profile.rules.length !== 2 || !['SAC-PRE001', 'SAC-P001'].every(id => profile.rules.some(r => r.rule_id === id && r.version === '1.0.0'))) stop('fail', 'pipeline-rule-selection-invalid');
  return profile;
}
async function snapshots(resources) {
  if (!resources || typeof resources.workspace !== 'string' || resources.workspace.split(/[\\/]/).includes('..') || !relative(resources.dist) || (resources.project !== undefined && resources.project !== '.' && !relative(resources.project)) || !Array.isArray(resources.sourceFiles) || !resources.sourceFiles.length || resources.sourceFiles.length > 2048 || resources.sourceFiles.some(p => !relative(p)) || new Set(resources.sourceFiles).size !== resources.sourceFiles.length) stop('fail', 'invalid-host-resources');
  const root = await realpath(resources.workspace);
  const project = resources.project === undefined || resources.project === '.' ? '' : resources.project;
  const app = path.join(root, project);
  if (!inside(root, await realpath(app))) stop('fail', 'project-escape');
  const dist = path.join(root, resources.dist);
  if (dist === root || inside(dist, app)) stop('fail', 'dist-overlaps-project');
  let count = 0, bytes = 0;
  const read = async file => {
    if (++count > 4096) stop('unverified', 'file-count-limit');
    const resolved = await realpath(file);
    if (!inside(root, resolved)) stop('fail', 'symlink-escape');
    const fd = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await fd.stat();
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || bytes + stat.size > 64 * 1024 * 1024) stop('unverified', 'file-budget-exceeded');
      bytes += stat.size;
      const buffer = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < buffer.length) { const r = await fd.read(buffer, offset, buffer.length - offset, null); if (!r.bytesRead) break; offset += r.bytesRead; }
      if (offset !== stat.size) stop('unverified', 'snapshot-changed');
      return hash(buffer.subarray(0, offset));
    } finally { await fd.close(); }
  };
  const source = async () => {
    const records = [];
    // Manifest is explicit host input, never a recursive workspace/secret scan.
    const required = [path.posix.join(project, 'package.json')];
    if (!required.every(p => resources.sourceFiles.includes(p))) stop('unverified', 'source-manifest-incomplete');
    for (const p of [...resources.sourceFiles].sort()) {
      const file = path.join(root, p);
      if (inside(dist, file) || p.split('/').some(v => ['node_modules', '.git'].includes(v)) || path.basename(p).startsWith('.env')) stop('fail', 'unsafe-source-selection');
      records.push([p, await read(file)]);
    }
    return hash(canonical(records));
  };
  const artifact = async () => {
    const records = [];
    const walk = async (directory, depth) => {
      if (++count > 4096) stop('unverified', 'file-count-limit');
      if (depth > 24) stop('unverified', 'artifact-depth-limit');
      const resolved = await realpath(directory);
      if (!inside(dist, resolved)) stop('fail', 'artifact-symlink-escape');
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.length + count > 4096) stop('unverified', 'file-count-limit');
      for (const e of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const file = path.join(directory, e.name);
        if (e.isSymbolicLink()) stop('fail', 'artifact-symlink-unsupported');
        if (e.isDirectory()) await walk(file, depth + 1);
        else { const digest = await read(file); records.push([path.relative(dist, file).split(path.sep).join('/'), digest]); }
      }
    };
    await walk(dist, 0);
    if (!records.length) stop('unverified', 'artifact-empty');
    return hash(canonical(records));
  };
  return { source, artifact, binding: hash(canonical({ project, dist: resources.dist, sourceFiles: [...resources.sourceFiles].sort() })) };
}
const sign = (data, key) => {
  if (!Buffer.isBuffer(key) || key.length < 32) stop('fail', 'host-key-invalid');
  return createHmac('sha256', key).update(canonical(data)).digest('hex');
};
const errorPhase = error => ({ status: error instanceof Stop ? error.status : ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'unverified' : 'infra-error', executed: false, code: error instanceof Stop ? error.code : ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'resource-missing' : 'host-io-error' });
async function preflight(profile, resources, limits) {
  return execute({ registry: registry(), profile: { ...profile, rules: profile.rules.filter(r => r.rule_id === 'SAC-PRE001') }, resources, limits });
}

// Trusted CI calls prepare before its existing official build. No process launch here.
export async function prepareBuild({ profile, resources, sourceSha, limits }) {
  const report = initial();
  try {
    const p = validate(profile);
    report.profile_id = p.profile_id;
    report.profile_schema_version = p.schema_version;
    if (p.mode === 'non-angular') { report.status = 'not-applicable'; report.phases.pre = { status: 'not-applicable', executed: false, code: 'non-angular' }; return { report, session: null }; }
    if (typeof sourceSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceSha)) stop('fail', 'source-sha-claim-invalid');
    report.phases.pre = { ...await preflight(p, resources, limits), executed: true };
    if (!report.phases.pre.promotion_allowed) { report.status = report.phases.pre.status === 'pass' ? 'unverified' : report.phases.pre.status; return { report, session: null }; }
    const snapshot = await snapshots(resources);
    const session = { schema_version: 1, profile_digest: hash(canonical(p)), resource_binding: snapshot.binding, source_digest: await snapshot.source(), source_sha_claim: sourceSha, preflight: 'pass' };
    return { report, session };
  } catch (e) {
    // The preflight may have passed before the trusted source snapshot failed.
    // Preserve the true preflight result and attribute that later failure to
    // build preparation (not to the Angular dependency checks).
    const phase = report.phases.pre.status === 'pass' ? 'build' : 'pre';
    report.phases[phase] = errorPhase(e);
    report.status = report.phases[phase].status;
    return { report, session: null };
  }
}

// Only the trusted host holding key can assert build status/sequence. HMAC is
// authentication of that host statement, not proof of the compiler's provenance.
export async function sealBuild({ session, profile, resources, key, buildStatus }) {
  if (!session || session.preflight !== 'pass' || session.profile_digest !== hash(canonical(validate(profile))) || !['pass', 'fail'].includes(buildStatus)) stop('fail', 'invalid-build-session');
  const snapshot = await snapshots(resources);
  if (snapshot.binding !== session.resource_binding || await snapshot.source() !== session.source_digest) stop('fail', 'sources-changed-during-build');
  const data = { ...session, build_status: buildStatus, artifact_digest: buildStatus === 'pass' ? await snapshot.artifact() : null };
  return { data, authentication: sign(data, key) };
}

/**
 * Verify THREE independently signed host build statements for the same
 * Angular profile/project binding: A baseline, B warm and B clean.
 * No raw build logs, user-supplied commands or source content are returned.
 * A valid HMAC authenticates the host statement, NOT the Angular invocation,
 * the claimed commit's Git provenance or a physical cache miss.
 */
export function compareAuthenticatedIncrementalReceipts({ baseline, warm, clean, key } = {}) {
  const report=(status,code)=>Object.freeze({
    schema_version:1,kind:'authenticated-angular-incremental-receipts',
    status,code,receipts_authenticated:status==='pass'||
      ['incremental-clean-artifact-divergence',
       'incremental-clean-source-mismatch','source-claim-mismatch',
       'source-not-changed','profile-or-project-mismatch'].includes(code),
    compiler_invocation_verified:false,clean_workspace_independent_verified:false,
    cache_hit_verified:false,production_aot_verified:false,
    browser_verified:false,root_cause_verified:false,deployment_authorized:false
  });
  const shape=['schema_version','profile_digest','resource_binding',
    'source_digest','source_sha_claim','preflight','build_status','artifact_digest'];
  if(!Buffer.isBuffer(key)||key.length<32)
    return report('unverified','host-key-unavailable');
  for(const receipt of [baseline,warm,clean]){
    if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||
       !receipt.data||typeof receipt.data!=='object'||Array.isArray(receipt.data)||
       Object.keys(receipt.data).sort().join(',')!==shape.slice().sort().join(',')||
       receipt.data.schema_version!==1||receipt.data.preflight!=='pass'||
       receipt.data.build_status!=='pass'||
       !hex.test(receipt.data.profile_digest)||!hex.test(receipt.data.resource_binding)||
       !hex.test(receipt.data.source_digest)||!hex.test(receipt.data.artifact_digest)||
       !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(receipt.data.source_sha_claim??'')||
       !hex.test(receipt.authentication??''))
      return report('unverified','incremental-receipt-shape-invalid');
    let expected;
    try { expected=sign(receipt.data,key); }
    catch { return report('unverified','receipt-authentication-unavailable'); }
    if(!timingSafeEqual(Buffer.from(expected,'hex'),
                        Buffer.from(receipt.authentication,'hex')))
      return report('fail','incremental-receipt-authentication-failed');
  }
  const a=baseline.data,b=warm.data,c=clean.data;
  if(a.profile_digest!==b.profile_digest||b.profile_digest!==c.profile_digest||
     a.resource_binding!==b.resource_binding||b.resource_binding!==c.resource_binding)
    return report('fail','profile-or-project-mismatch');
  if(a.source_sha_claim===b.source_sha_claim||
     b.source_sha_claim!==c.source_sha_claim)
    return report('unverified','source-claim-mismatch');
  if(a.source_digest===b.source_digest)
    return report('unverified','source-not-changed');
  if(b.source_digest!==c.source_digest)
    return report('fail','incremental-clean-source-mismatch');
  // Dist hashes can legitimately stay identical after comments/dead-code
  // changes. Without a verified runtime/output marker, this is suspicious
  // but NOT proof of stale compilation. Block the optional audit as unverified.
  if(a.artifact_digest===b.artifact_digest)
    return report('unverified','unchanged-artifact-after-source-change');
  if(b.artifact_digest!==c.artifact_digest)
    return report('fail','incremental-clean-artifact-divergence');
  return report('pass','authenticated-incremental-artifacts-concordant');
}

export async function auditPipeline({ profile, resources, receipt, key, sourceSha, limits, incremental }) {
  const { report, session } = await prepareBuild({ profile, resources, sourceSha, limits });
  if (!session) return report;
  try {
    if (!receipt || !receipt.data || !hex.test(receipt.authentication ?? '')) stop('unverified', 'build-evidence-missing');
    const expected = sign(receipt.data, key);
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(receipt.authentication, 'hex'))) stop('fail', 'build-evidence-unauthenticated');
    for (const field of Object.keys(session)) if (receipt.data[field] !== session[field]) stop('fail', 'build-evidence-binding-mismatch');
    report.source_sha_claim = session.source_sha_claim;
    report.profile_digest = session.profile_digest;
    if (receipt.data.build_status === 'fail') stop('fail', 'official-build-failed');
    if (receipt.data.build_status !== 'pass' || !hex.test(receipt.data.artifact_digest ?? '')) stop('unverified', 'build-not-proven');
    const snapshot = await snapshots(resources);
    if (await snapshot.artifact() !== receipt.data.artifact_digest) stop('fail', 'artifact-mismatch');
    report.phases.build = { status: 'pass', executed: false, code: 'authenticated-ci-build', artifact_digest: receipt.data.artifact_digest };
    if(incremental !== undefined){
      report.incremental=compareAuthenticatedIncrementalReceipts({
        baseline:incremental?.baseline,warm:receipt,
        clean:incremental?.clean,key
      });
      if(report.incremental.status!=='pass'){
        report.status=report.incremental.status;
        report.static_pipeline_pass=false;
        return report;
      }
    }
    const p = validate(profile);
    report.phases.post = { ...await execute({ registry: registry(), profile: { ...p, rules: p.rules.filter(r => r.rule_id === 'SAC-P001') }, resources: { dist: path.join(resources.workspace, resources.dist) }, limits }), executed: true };
    // Detect mutation during postflight as well.
    const final = await snapshots(resources);
    if (await final.artifact() !== receipt.data.artifact_digest || await final.source() !== session.source_digest) stop('fail', 'inputs-changed-during-audit');
    report.static_pipeline_pass = report.phases.post.promotion_allowed;
    report.status = report.static_pipeline_pass ? 'pass' : report.phases.post.status === 'pass' ? 'unverified' : report.phases.post.status;
    return report;
  } catch (e) { report.phases.build = errorPhase(e); report.status = report.phases.build.status; report.static_pipeline_pass = false; return report; }
}

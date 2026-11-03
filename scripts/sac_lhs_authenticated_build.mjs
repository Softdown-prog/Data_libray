/**
 * Same-job trusted host bridge for pinned LHS only. The CI key is created
 * AFTER the untrusted build and Chromium probes, kept only in process memory,
 * and never exported. No deployment or writes to the source repository.
 *
 * prepare: run mandatory SAC preflight BEFORE the LHS official build.
 * verify: seal the build from that session and immediately authenticate the
 * full dist through auditPipeline before reconciling observational evidence.
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,lstat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareBuild,sealBuild} from '../packages/angular-pipeline/src/index.mjs';
import {makeAuthenticatedLhsObservation} from '../packages/angular-core/src/lhs-authenticated-observation.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const snapshot=path.join(root,'.sac-snapshots','lhs');
const game=path.join(snapshot,'games/lan_house_simulator');
const pinned='db639a117024b2e14c4af844bfb69b90bef5da20';
const temp=process.env.RUNNER_TEMP;
if(!temp||!path.isAbsolute(temp)||!['prepare','verify'].includes(process.argv[2])||
    process.argv.length!==3)
  throw new Error('sac-lhs-host-invocation-invalid');
const prefix=path.resolve(temp);
const sessionFile=path.join(prefix,'sac-lhs-auth-session.json');
const sources=[
  'package.json','package-lock.json',
  'scripts/build.mjs','scripts/build_clean_angular_site.mjs',
  'scripts/clean_angular_site_assets.mjs',
  'account-config.json','online-config.json',
  'frontend-angular/package.json','frontend-angular/package-lock.json',
  'frontend-angular/angular.json','frontend-angular/tsconfig.app.json',
  'frontend-angular/tsconfig.site-rewrite.json','frontend-angular/src/main.ts',
  'frontend-angular/src/site-rewrite/index.html',
  'frontend-angular/src/site-rewrite/main.ts',
  'frontend-angular/src/site-rewrite/account.ts',
  'frontend-angular/src/site-rewrite/page-metadata.json'
];
const profile={
  schema_version:1,profile_id:'lhs-pinned-receipt-observation',
  angular_version:'22.2.0',capabilities:['angular','workspace'],
  mode:'angular-only',mount:'/',bundle_hints:null,
  rules:['SAC-PRE001','SAC-P001'].map(rule_id=>({
    rule_id,version:'1.0.0',required:true,enforcement:'blocking'
  }))
};
const resources={workspace:game,project:'frontend-angular',
  dist:'out/site-clean-angular',sourceFiles:sources};
function git(...args){
  return execFileSync('git',['-C',snapshot,...args],{
    encoding:'utf8',timeout:12000,stdio:['ignore','pipe','pipe']
  }).trim();
}
assert.equal(git('rev-parse','HEAD'),pinned,'sac-lhs-host-snapshot-drift');
async function json(name,max=65536){
  const p=path.join(prefix,name);
  const s=await lstat(p);
  assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size>=16&&s.size<=max,
    'sac-lhs-host-invalid-input-file');
  return JSON.parse(await readFile(p,'utf8'));
}
async function trackedInputsUnchanged(){
  for(const src of sources){
    const relative='games/lan_house_simulator/'+src;
    const expected=git('rev-parse',pinned+':'+relative);
    const actual=git('hash-object',relative);
    assert.equal(actual,expected,'sac-lhs-host-input-drift');
  }
}
if(process.argv[2]==='prepare'){
  const prepared=await prepareBuild({profile,resources,sourceSha:pinned});
  assert.ok(prepared.session&&prepared.report?.phases?.pre?.status==='pass',
    'sac-lhs-host-preflight-not-approved');
  assert.equal(prepared.session.source_sha_claim,pinned);
  await writeFile(sessionFile,JSON.stringify(prepared.session),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({phase:'pre',status:'pass',
    source_commit:pinned,deployment_authorized:false}));
}else{
  // Reject modified tracked source inputs; untracked/dist files are not
  // automatically trusted as build sources and are captured by dist digest.
  await trackedInputsUnchanged();
  const session=await json('sac-lhs-auth-session.json',16384);
  const artifacts=await json('sac-lhs-dynamic-evidence.json');
  const browser=await json('sac-lhs-browser-evidence.json');
  const key=randomBytes(32); // generated after build; never saved to disk
  try {
    const receipt=await sealBuild({
      session,profile,resources,key,buildStatus:'pass'
    });
    const report=await makeAuthenticatedLhsObservation({
      sourceCommit:pinned,artifactEvidence:artifacts,
      browserEvidence:browser,profile,resources,receipt,key
    });
    assert.equal(report.provenance.official_build_receipt_verified,true);
    assert.equal(report.provenance.runner_attestation_verified,false);
    assert.equal(report.promotion_allowed,false);
    assert.equal(report.deployment_authorized,false);
    console.log(JSON.stringify(report,null,2));
  }finally{
    key.fill(0);
    await unlink(sessionFile).catch(()=>{});
  }
}

/**
 * Trusted-host bridge between the pinned LHS observational report and SAC-004.
 * The only proof of authenticity is auditPipeline() with the private CI key
 * and actual dist; assertions from uploaded JSON alone are never trusted.
 */
import {auditPipeline} from '../../angular-pipeline/src/index.mjs';
import {makeLhsObservationReport} from './lhs-observation-report.mjs';
const hex=/^[0-9a-f]{64}$/;
const stop=()=>{throw new Error('sac-lhs-authenticated-build-binding-invalid');};

export async function makeAuthenticatedLhsObservation({
  sourceCommit,artifactEvidence,browserEvidence,profile,resources,receipt,key
}={}){
  // Render and validate existing independent facts first. This never confers
  // promotion or deployment authorization.
  const base=makeLhsObservationReport({sourceCommit,artifactEvidence,browserEvidence});
  if(base.checks.build.observation!=='observed'||!receipt?.data||!Buffer.isBuffer(key))
    stop();
  // Recompute preflight, authenticated HMAC and the FULL dist digest inside
  // SAC-004. Never accept receipt.data or a claimed summary as verification.
  const audited=await auditPipeline({profile,resources,receipt,key,sourceSha:sourceCommit});
  const build=audited.phases?.build;
  if(build?.status!=='pass'||build.code!=='authenticated-ci-build'||
     audited.phases?.pre?.status!=='pass'||
     audited.source_sha_claim!==sourceCommit||
     receipt.data.source_sha_claim!==sourceCommit||
     receipt.data.build_status!=='pass'||
     !hex.test(build.artifact_digest??'')||
     receipt.data.artifact_digest!==build.artifact_digest||
     audited.deployment_authorized!==false)stop();
  // The published hash binds the entire dist, while the two asset hashes
  // remain independently tied to the browser response hashes.
  const report={
    ...base,
    checks:{
      ...base.checks,
      build:{...base.checks.build,
        detail:'authenticated-sac004-host-build-and-full-dist-verified'}
    },
    provenance:{
      ...base.provenance,
      official_build_receipt_verified:true,
      full_dist_digest:build.artifact_digest,
      source_manifest_exhaustive_verified:false
    }
  };
  if(report.observation_status!=='unverified'||report.promotion_allowed!==false||
     report.deployment_authorized!==false||
     Object.values(report.checks).some(x=>x.approval!=='unverified')||
     JSON.stringify(report).length>4096)stop();
  return report;
}

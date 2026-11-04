/**
 * Trusted-host bridge between the pinned LHS observational report and SAC-004.
 * The only proof of authenticity is auditPipeline() with the private CI key
 * and actual dist; assertions from uploaded JSON alone are never trusted.
 */
import {auditPipeline} from '../../angular-pipeline/src/index.mjs';
import {makeLhsObservationReport} from './lhs-observation-report.mjs';
import path from 'node:path';
import {verifyLhsAngularScopes} from '../../angular-postcompiler/src/lhs-scoped-postflight.mjs';
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
  // The Core SAC-P001 rule covers the site custom-element root. The game
  // uses DIV-mounted islands; validate it separately and never label its
  // structural checks as a universal SAC-P001 pass.
  const scopedPostflight=await verifyLhsAngularScopes(
    path.join(resources.workspace,resources.dist),
    browserEvidence.island_runtime_evidence,sourceCommit,
    browserEvidence.island_interaction_evidence
  );
  if(scopedPostflight.site.status!=='pass'||scopedPostflight.site.rule_id!=='SAC-P001'||
     scopedPostflight.game.status!=='pass'||
     scopedPostflight.game.rule_id!=='SAC-P001-ISLAND-EXT'||
     scopedPostflight.game.browser_dom_and_reactivity_observed!==true||
     scopedPostflight.game.component_event_interactions_observed!==true||
     scopedPostflight.root_p001_game_status!=='not-applicable'||
     scopedPostflight.complete_sac_pipeline_approved!==false||
     scopedPostflight.deployment_authorized!==false)stop();
  // The published hash binds the entire dist, while the two asset hashes
  // remain independently tied to the browser response hashes.
  const report={
    ...base,
    checks:{
      ...base.checks,
      build:{...base.checks.build,
        detail:'authenticated-sac004-host-build-and-full-dist-verified'},
      site_postcompile:{observation:'observed',approval:'unverified',
        detail:'sac-p001-v1-site-custom-element-static-pass'},
      game_islands_postcompile:{observation:'observed',approval:'unverified',
        detail:'bounded-island-static-check-not-p001-v1'},
      game_islands_browser:{observation:'observed',approval:'unverified',
        detail:'pinned-chromium-rendered-13-hosts-and-reactive-calendar-event'},
      component_interactions:{observation:'observed',approval:'unverified',
        detail:'chromium-notice-inbox-and-finance-summary-dom-events'},
      admin_navigation:{observation:'observed',approval:'unverified',
        detail:'chromium-angular-native-finance-stock-page-synchronization'}
    },
    provenance:{
      ...base.provenance,
      official_build_receipt_verified:true,
      full_dist_digest:build.artifact_digest,
      source_manifest_exhaustive_verified:false,
      site_p001_static_verified:true,game_island_static_verified:true,
      game_island_dom_reactivity_observed:true,
      component_event_interactions_observed:true,
      admin_navigation_observed:true,universal_runtime_attested:false,
      complete_sac_p001_coverage_verified:false
    }
  };
  if(report.observation_status!=='unverified'||report.promotion_allowed!==false||
     report.deployment_authorized!==false||
     Object.values(report.checks).some(x=>x.approval!=='unverified')||
     JSON.stringify(report).length>4096)stop();
  return report;
}

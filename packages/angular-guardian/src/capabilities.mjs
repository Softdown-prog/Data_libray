/**
 * SAC capability evidence: the trusted adapter RE-RUNS the existing pipeline
 * and Guardian before classifying their bounded results.
 *
 * This is not a generic report reader, attestation authority or deploy gate.
 * A host-authenticated build receipt does NOT prove that Angular CLI ran.
 */
import {RuleRegistry} from '../../angular-core/src/index.mjs';
import {registerSACPRE001} from '../../angular-precompiler/src/register.mjs';
import {registerSACP001} from '../../angular-core/src/sac-p001.mjs';
import {verifyPipelineBrowser} from './pipeline.mjs';

const state=(ok,failed)=>ok?'observed-pass':failed?'observed-nonpass':'unverified';
const intactDigest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const expectedSource=v=>typeof v==='string'&&/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(v);

/**
 * The host must hold the pipeline HMAC key, trusted workspace and receipt.
 * The browser runs only after static_pipeline_pass=true; absent or invalid
 * inputs leave all observations unverified. No command is taken from a profile.
 */
export async function observeSACCapabilityEvidence({pipeline,guardian,timeoutMs,runBrowser}={}){
  let declarations;
  try{
    declarations=registerSACP001(registerSACPRE001(new RuleRegistry()))
      .capabilities(pipeline?.profile);
  }catch{
    return {capabilities:{
      schema_version:1,kind:'sac-capability-evidence',
      scope:'invalid-or-unsupported-profile',
      status:'unverified',declared_capabilities:[],selected_rules:[],
      observations:{preflight:'unverified',authenticated_build_claim:'unverified',
        postflight:'unverified',guardian_contract:'unverified'},
      browser_runner:'not-invoked',angular_toolchain_metadata_verified:false,
      tool_installation_verified:false,
      angular_cli_execution_verified:false,official_aot_verified:false,
      full_runtime_verified:false,deployment_authorized:false
    },result:null};
  }
  const isInjected=runBrowser!==undefined;
  const result=await verifyPipelineBrowser({pipeline,guardian,timeoutMs,runBrowser});
  const staticResult=result.static_result;
  const phases=staticResult?.phases;
  const prePass=phases?.pre?.status==='pass'&&
    phases.pre.executed===true&&phases.pre.promotion_allowed===true;
  const preFailed=phases?.pre?.executed===true&&
    ['fail','infra-error','unverified'].includes(phases.pre.status);
  const buildClaim=prePass&&phases?.build?.status==='pass'&&
    phases.build.code==='authenticated-ci-build'&&
    phases.build.executed===false&&intactDigest(phases.build.artifact_digest)&&
    intactDigest(staticResult.profile_digest)&&expectedSource(staticResult.source_sha_claim);
  const postPass=buildClaim&&phases?.post?.executed===true&&
    phases.post.status==='pass'&&phases.post.promotion_allowed===true&&
    staticResult.static_pipeline_pass===true&&result.static_pipeline_pass===true;
  const browserClaim=postPass&&result.browser_pass===true&&
    result.browser?.executed===true&&result.browser.status==='pass'&&
    result.status==='pass'&&result.binding?.artifact_digest===phases.build.artifact_digest;
  const integrityIssue=result.browser?.code==='artifact-mutated-during-browser';
  const browserPass=browserClaim&&!isInjected&&!integrityIssue;
  const browserStatus=browserPass?'observed-contract-pass':
    browserClaim&&isInjected?'caller-runner-claimed-pass':
    state(false,result.browser?.executed===true&&result.browser?.status==='fail');
  const observations={
    preflight:state(prePass,preFailed),
    authenticated_build_claim:buildClaim?'authenticated-host-claim':
      state(false,phases?.build?.status==='fail'),
    postflight:state(postPass,phases?.post?.executed===true&&phases.post.status==='fail'),
    guardian_contract:browserStatus
  };
  const capabilities={
    schema_version:1,kind:'sac-capability-evidence',
    scope:'profile-and-current-adapter-invocation-only',
    status:'unverified',declared_capabilities:declarations.declared_capabilities,
    selected_rules:declarations.selected_rules,
    observations,
    browser_runner:isInjected?'caller-supplied-runner':'built-in-guardian-worker',
    // A forged in-memory report or host-controlled buildStatus is NOT proof of
    // ngc/ng invocation. A real browser pass covers only the selected contract.
    // Preflight verifies installed npm metadata/peers, not all host tools.
    angular_toolchain_metadata_verified:prePass,
    tool_installation_verified:false,
    angular_cli_execution_verified:false,
    official_aot_verified:false,
    full_runtime_verified:false,
    deployment_authorized:false
  };
  return {capabilities,result};
}

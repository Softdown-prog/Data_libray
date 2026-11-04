/**
 * Versioned, opt-in SAC Core adapter for static Angular islands.
 * A static PASS is evidence, not a verified Angular runtime mount; this
 * mandatory gate stays UNVERIFIED even when all HTML checks succeed.
 * SAC-P001 v1, the Angular compiler and all deploy gates are unchanged.
 */
import {verifyAngularIslands} from '../../angular-postcompiler/src/angular-islands.mjs';
import {verifyIslandRuntimeEvidence} from './sac-island-runtime-evidence.mjs';

const evidence=(assertion,status,code)=>({assertion,status,code});
const allowedFailures=new Set([
  'contract-invalid','resource-url-invalid','resource-url-outside-contract',
  'resource-not-allowed','resource-budget-exceeded','resource-missing',
  'resource-outside-dist','resource-budget-or-type-invalid',
  'resource-changed-during-read','duplicate-dom-id','host-id-coverage-invalid',
  'required-element-missing','forbidden-tag','base-href-invalid',
  'inline-or-missing-resource','script-type-unsupported','resource-type-invalid',
  'entrypoint-or-resource-coverage-invalid'
]);

export function registerSACAngularIslands(registry){
  return registry.register({
    rule_id:'SAC-P001-ISLAND-EXT',version:'1.0.0',phase:'post',
    description:'Opt-in static Angular island hosts and local resources; runtime remains unverified',
    applies_when:{
      capabilities:['angular','angular-islands'],
      modes:['angular-only','hybrid'],angular_majors:[]
    },
    dependencies:[],inputs:['dist','islandContract'],
    assertions:['islands-static','runtime-mount'],severity:'error',
    test_fixtures:['dashboard-islands','lhs-game-islands','tampered-islands'],
    source_incidents:['SAC-P001','SAC-004'],
    async run({profile,resources}){
      // Keep a profile-bound mount even when a caller supplies an independent
      // contract. Resources are trusted-host inputs, not a project command.
      if(!resources.islandContract||profile.mount!==resources.islandContract.mount)
        return {status:'fail',evidence:[
          evidence('islands-static','fail','mount-mismatch')
        ]};
      const checked=await verifyAngularIslands(resources.dist,resources.islandContract);
      if(checked.status==='pass'){
        const staticObserved=evidence('islands-static','pass','static-hosts-verified');
        // An interaction assertion without the baseline runtime proof is an
        // invalid partial claim, not a reason to silently skip the check.
        if((resources.islandInteractionEvidence!==undefined||
            resources.islandInteractionExpectation!==undefined)&&
           (resources.islandRuntimeEvidence===undefined||
            resources.islandRuntimeExpectation===undefined)){
          return {status:'fail',evidence:[staticObserved,
            evidence('component-events','fail','interaction-baseline-missing')]};
        }
        // Runtime evidence is optional, but when provided it must be bound
        // to an independent host expectation and the actual compiled module.
        if(resources.islandRuntimeEvidence!==undefined||
           resources.islandRuntimeExpectation!==undefined){
          const runtime=await verifyIslandRuntimeEvidence(
            resources.dist,resources.islandContract,
            resources.islandRuntimeEvidence,resources.islandRuntimeExpectation
          );
          if(!runtime.observed){
            return {status:'fail',evidence:[
              staticObserved,evidence('browser-dom','fail',runtime.code)
            ]};
          }
          // Never promote a static + sampled-browser observation to the
          // universally attested runtime mount of every Angular component.
          return {status:'unverified',evidence:[
            staticObserved,
            evidence('browser-dom','pass','chromium-dom-event-observed'),
            evidence('runtime-mount','unverified','full-runtime-not-verified')
          ]};
        }
        return {status:'unverified',evidence:[
          staticObserved,evidence('runtime-mount','unverified','runtime-not-verified')
        ]};
      }
      if(checked.status==='fail'){
        return {status:'fail',evidence:[
          evidence('islands-static','fail',
            allowedFailures.has(checked.code)?checked.code:'static-contract-failed')
        ]};
      }
      return {status:'infra-error',evidence:[
        evidence('islands-static','infra-error','island-inspection-error')
      ]};
    }
  });
}

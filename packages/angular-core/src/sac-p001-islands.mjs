/**
 * Versioned, opt-in SAC Core adapter for static Angular islands.
 * A static PASS is evidence, not a verified Angular runtime mount; this
 * mandatory gate stays UNVERIFIED even when all HTML checks succeed.
 * SAC-P001 v1, the Angular compiler and all deploy gates are unchanged.
 */
import {verifyAngularIslands} from '../../angular-postcompiler/src/angular-islands.mjs';

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
        return {status:'unverified',evidence:[
          evidence('islands-static','pass','static-hosts-verified'),
          evidence('runtime-mount','unverified','runtime-not-verified')
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

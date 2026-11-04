/**
 * Bounded bridge for an isolated Playwright/Chromium DOM + event observation.
 * The caller must supply independent trusted expectations. Browser JSON is
 * never a runner attestation or evidence of full Angular/gameplay coverage.
 */
import path from 'node:path';
import {createHash} from 'node:crypto';
import {realpath,lstat,readFile} from 'node:fs/promises';

const sha=/^[0-9a-f]{64}$/;
const commit=/^[0-9a-f]{40}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,a)=>plain(x)&&Object.keys(x).sort().join(',')===a.slice().sort().join(',');
const limitedStr=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(x);
const fail=code=>({observed:false,code});

export async function verifyIslandRuntimeEvidence(dist,contract,proof,expected){
  if(!keys(expected,['source_commit','entrypoint','viewports','phases','reactive_host_id','event_name'])||
     !commit.test(expected.source_commit)||!limitedStr(expected.reactive_host_id)||
     typeof expected.event_name!=='string'||!/^[a-z][a-z0-9-]{1,50}:[a-z0-9-]{1,60}$/.test(expected.event_name)||
     !Array.isArray(expected.viewports)||expected.viewports.length<1||expected.viewports.length>4||
     !expected.viewports.every(v=>Number.isInteger(v)&&v>=240&&v<=2000)||
     new Set(expected.viewports).size!==expected.viewports.length||
     !Array.isArray(expected.phases)||expected.phases.length<1||expected.phases.length>4||
     !expected.phases.every(limitedStr)||new Set(expected.phases).size!==expected.phases.length||
     !Array.isArray(contract?.host_ids)||!contract.host_ids.includes(expected.reactive_host_id)||
     !Array.isArray(contract.entrypoint_scripts)||!contract.entrypoint_scripts.includes(expected.entrypoint))
    return fail('runtime-expectation-invalid');

  if(!keys(proof,['schema_version','source_commit','browser','scope','mount',
      'entrypoint','entrypoint_sha256','host_ids','reactive_host_id',
      'event_name','cycles'])||
     proof.schema_version!==1||proof.source_commit!==expected.source_commit||
     proof.browser!=='chromium'||proof.scope!=='isolated-loopback-dom-events'||
     proof.mount!==contract.mount||proof.entrypoint!==expected.entrypoint||
     !sha.test(proof.entrypoint_sha256??'')||
     proof.reactive_host_id!==expected.reactive_host_id||
     proof.event_name!==expected.event_name||
     !Array.isArray(proof.host_ids)||proof.host_ids.length!==contract.host_ids.length||
     proof.host_ids.some((id,i)=>id!==contract.host_ids[i])||
     !Array.isArray(proof.cycles)||proof.cycles.length!==expected.viewports.length*expected.phases.length)
    return fail('runtime-proof-invalid');

  let index=0;
  for(const width of expected.viewports){
    for(const phase of expected.phases){
      const cycle=proof.cycles[index++];
      if(!keys(cycle,['viewport_width','phase','host_count','rendered','reactive_dom_updated','no_page_errors'])||
         cycle.viewport_width!==width||cycle.phase!==phase||
         cycle.host_count!==contract.host_ids.length||
         cycle.rendered!==true||cycle.reactive_dom_updated!==true||
         cycle.no_page_errors!==true)
        return fail('runtime-cycle-invalid');
    }
  }
  // Binds the browser's module response digest to an actual file in the
  // authenticated dist. The host must independently audit the full dist.
  try{
    const root=await realpath(dist);
    const target=path.join(root,expected.entrypoint);
    const real=await realpath(target);
    const st=await lstat(target);
    if(!real.startsWith(root+path.sep)||!st.isFile()||st.isSymbolicLink()||
       st.size<16||st.size>16*1024*1024)return fail('runtime-entry-unsafe');
    const body=await readFile(target);
    const digest=createHash('sha256').update(body).digest('hex');
    if(body.length!==st.size||digest!==proof.entrypoint_sha256)
      return fail('runtime-entry-digest-mismatch');
  }catch{return fail('runtime-entry-unavailable');}
  return {observed:true,code:'chromium-dom-event-observed'};
}

/**
 * Versioned, bounded component-event observations from isolated Chromium.
 * Positive results are observations of DOM responses only, not complete
 * component ownership, semantic correctness, or CI runner attestation.
 */
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,names)=>plain(v)&&Object.keys(v).sort().join(',')===names.slice().sort().join(',');
const commit=/^[a-f0-9]{40}$/;
const id=/^[a-z][a-z0-9-]{0,63}$/;
const event=/^[a-z][a-z0-9-]{1,50}:[a-z][a-z0-9-]{0,63}$/;
const error=code=>({observed:false,code});
const probes=(arr,hostIds)=>{
  if(!Array.isArray(arr)||arr.length<1||arr.length>8)return false;
  const seen=new Set();
  for(const p of arr){
    if(!exact(p,['id','host_id','event_name'])||!id.test(p.id)||
       !hostIds.includes(p.host_id)||!event.test(p.event_name)||
       seen.has(p.id))return false;
    seen.add(p.id);
  }
  return true;
};
export function verifyIslandComponentInteractions(contract,baseline,proof,expected){
  if(!Array.isArray(contract?.host_ids)||!exact(expected,[
    'source_commit','entrypoint','viewports','phases','probes'
  ])||!commit.test(expected.source_commit)||
     !Array.isArray(expected.viewports)||expected.viewports.length<1||expected.viewports.length>4||
     expected.viewports.some(x=>!Number.isInteger(x)||x<240||x>2000)||
     new Set(expected.viewports).size!==expected.viewports.length||
     !Array.isArray(expected.phases)||expected.phases.length<1||expected.phases.length>4||
     expected.phases.some(x=>typeof x!=='string'||!id.test(x))||
     new Set(expected.phases).size!==expected.phases.length||
     !probes(expected.probes,contract.host_ids)||
     !Array.isArray(contract.entrypoint_scripts)||
     !contract.entrypoint_scripts.includes(expected.entrypoint))
    return error('interaction-expectation-invalid');
  if(!exact(baseline,[
    'schema_version','source_commit','browser','scope','mount','entrypoint',
    'entrypoint_sha256','host_ids','reactive_host_id','event_name','cycles'
  ])||baseline.schema_version!==1||
     baseline.source_commit!==expected.source_commit||
     baseline.entrypoint!==expected.entrypoint||
     baseline.mount!==contract.mount||
     baseline.browser!=='chromium')
    return error('interaction-baseline-invalid');
  if(!exact(proof,[
    'schema_version','source_commit','browser','scope','mount','entrypoint',
    'entrypoint_sha256','probes','cycles'
  ])||proof.schema_version!==1||
     proof.browser!=='chromium'||
     proof.scope!=='isolated-loopback-component-events'||
     proof.source_commit!==baseline.source_commit||
     proof.mount!==baseline.mount||proof.entrypoint!==baseline.entrypoint||
     proof.entrypoint_sha256!==baseline.entrypoint_sha256||
     !Array.isArray(proof.probes)||proof.probes.length!==expected.probes.length||
     proof.probes.some((p,i)=>!exact(p,['id','host_id','event_name'])||
       p.id!==expected.probes[i].id||
       p.host_id!==expected.probes[i].host_id||
       p.event_name!==expected.probes[i].event_name)||
     !Array.isArray(proof.cycles)||
     proof.cycles.length!==expected.viewports.length*expected.phases.length||
     baseline.cycles.length!==proof.cycles.length)
    return error('interaction-proof-invalid');
  let index=0;
  for(const width of expected.viewports){
    for(const phase of expected.phases){
      const c=proof.cycles[index],b=baseline.cycles[index];
      index++;
      if(!exact(c,['viewport_width','phase','probes'])||
         c.viewport_width!==width||c.phase!==phase||
         b.viewport_width!==width||b.phase!==phase||
         !Array.isArray(c.probes)||c.probes.length!==expected.probes.length||
         c.probes.some((p,i)=>!exact(p,['id','dom_updated'])||
           p.id!==expected.probes[i].id||p.dom_updated!==true))
        return error('interaction-cycle-invalid');
    }
  }
  return {observed:true,code:'chromium-component-events-observed'};
}

/**
 * Bounded evidence for the pinned LHS administrative keyboard navigation.
 * Trusted host must check SAC-004 full dist and the Chromium island baseline
 * separately. A passing observation is not a screen-reader accessibility
 * certification, runner attestation or deployment authorization.
 */
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,n)=>isObj(x)&&Object.keys(x).sort().join(',')===n.slice().sort().join(',');
const digest=/^[0-9a-f]{64}$/,commit=/^[0-9a-f]{40}$/;
const bad=code=>({observed:false,code});
const checks=[
  'keyboard_home_end_arrows','focus_follows_keyboard','roving_tabindex',
  'aria_controls_connected','native_angular_sync','responsive_selector_synced'
];
const cycleFields=['viewport_width','phase',...checks];
const proofFields=['schema_version','source_commit','browser','scope','mount',
  'entrypoint','entrypoint_sha256','host_id','cycles'];
const baseFields=['schema_version','source_commit','browser','scope','mount',
  'entrypoint','entrypoint_sha256','host_ids','reactive_host_id','event_name','cycles'];
/**
 * Expected facts are supplied by the trusted host, not from browser JSON.
 * Evidence is only accepted for the 360/414px, initial/reload LHS scenario.
 */
export function verifyLhsAdminAccessibilityEvidence(baseline,proof,expected){
  if(!exact(expected,['source_commit','entrypoint','mount','host_id'])||
     !commit.test(expected.source_commit)||expected.entrypoint!=='__angular/main.js'||
     expected.mount!=='/game/'||expected.host_id!=='angular-admin-area-navigation')
    return bad('accessibility-expectation-invalid');
  if(!exact(baseline,baseFields)||baseline.schema_version!==1||
     baseline.browser!=='chromium'||baseline.source_commit!==expected.source_commit||
     baseline.mount!==expected.mount||baseline.entrypoint!==expected.entrypoint||
     !digest.test(baseline.entrypoint_sha256??'')||
     !Array.isArray(baseline.cycles)||baseline.cycles.length!==4||
     !Array.isArray(baseline.host_ids))
    return bad('accessibility-baseline-invalid');
  if(!exact(proof,proofFields)||proof.schema_version!==1||
     proof.browser!=='chromium'||proof.scope!=='isolated-loopback-admin-keyboard'||
     proof.source_commit!==baseline.source_commit||
     proof.mount!==baseline.mount||proof.entrypoint!==baseline.entrypoint||
     proof.entrypoint_sha256!==baseline.entrypoint_sha256||
     proof.host_id!==expected.host_id||!Array.isArray(proof.cycles)||
     proof.cycles.length!==4)
    return bad('accessibility-proof-invalid');
  const expectedCycles=[[360,'initial'],[360,'reload'],[414,'initial'],[414,'reload']];
  for(let i=0;i<4;i++){
    const c=proof.cycles[i],b=baseline.cycles[i],pair=expectedCycles[i];
    if(!exact(c,cycleFields)||!isObj(b)||
       c.viewport_width!==pair[0]||c.phase!==pair[1]||
       b.viewport_width!==pair[0]||b.phase!==pair[1]||
       checks.some(k=>c[k]!==true))
      return bad('accessibility-cycle-invalid');
  }
  return {observed:true,code:'chromium-admin-keyboard-observed'};
}

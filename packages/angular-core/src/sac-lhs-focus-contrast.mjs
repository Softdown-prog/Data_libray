/**
 * Isolated Chromium visual-focus and locked-navigation evidence for pinned LHS.
 * Color sampling is limited to opaque computed RGB and CSS outline properties.
 * This is a contrast diagnostic, not a WCAG audit or certified image-pixel scan.
 */
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const same=(x,fields)=>obj(x)&&Object.keys(x).sort().join(',')===fields.slice().sort().join(',');
const sha=/^[a-f0-9]{40}$/, hash=/^[a-f0-9]{64}$/;
const fields=[
  'viewport_width','phase','focus_visible','outline_width_px','outline_style',
  'focus_outline_rgb','adjacent_nav_rgb','selected_text_rgb',
  'selected_background_rgb','inactive_text_rgb','inactive_background_rgb',
  'locked_disabled','locked_native_disabled','locked_unfocusable','locked_pane_hidden'
];
const proofFields=[
  'schema_version','source_commit','browser','scope','mount',
  'entrypoint','entrypoint_sha256','host_id','cycles'
];
const baselineFields=[
  'schema_version','source_commit','browser','scope','mount','entrypoint',
  'entrypoint_sha256','host_ids','reactive_host_id','event_name','cycles'
];
const keyboardFields=[
  'schema_version','source_commit','browser','scope','mount',
  'entrypoint','entrypoint_sha256','host_id','cycles'
];
const fail=code=>({observed:false,code});
const rgb=c=>Array.isArray(c)&&c.length===3&&
  c.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
const luminance=color=>{
  const s=color.map(v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;});
  return s[0]*0.2126+s[1]*0.7152+s[2]*0.0722;
};
export function rgbContrast(a,b){
  if(!rgb(a)||!rgb(b))return null;
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
export function verifyLhsFocusContrastEvidence(baseline,keyboard,proof,expected){
  if(!same(expected,['source_commit','entrypoint','mount','host_id'])||
     !sha.test(expected.source_commit)||
     expected.entrypoint!=='__angular/main.js'||expected.mount!=='/game/'||
     expected.host_id!=='angular-admin-area-navigation')
    return fail('visual-expectation-invalid');
  if(!same(baseline,baselineFields)||baseline.schema_version!==1||
     baseline.browser!=='chromium'||baseline.source_commit!==expected.source_commit||
     baseline.mount!==expected.mount||baseline.entrypoint!==expected.entrypoint||
     !hash.test(baseline.entrypoint_sha256??'')||
     !Array.isArray(baseline.cycles)||baseline.cycles.length!==4)
    return fail('visual-baseline-invalid');
  if(!same(keyboard,keyboardFields)||keyboard.schema_version!==1||
     keyboard.browser!=='chromium'||keyboard.source_commit!==baseline.source_commit||
     keyboard.mount!==baseline.mount||keyboard.entrypoint!==baseline.entrypoint||
     keyboard.entrypoint_sha256!==baseline.entrypoint_sha256||
     keyboard.host_id!==expected.host_id||
     !Array.isArray(keyboard.cycles)||keyboard.cycles.length!==4)
    return fail('visual-keyboard-baseline-invalid');
  if(!same(proof,proofFields)||proof.schema_version!==1||
     proof.browser!=='chromium'||proof.scope!=='isolated-loopback-focus-and-contrast'||
     proof.source_commit!==baseline.source_commit||proof.mount!==baseline.mount||
     proof.entrypoint!==baseline.entrypoint||
     proof.entrypoint_sha256!==baseline.entrypoint_sha256||
     proof.host_id!==expected.host_id||!Array.isArray(proof.cycles)||
     proof.cycles.length!==4)
    return fail('visual-proof-invalid');
  let lowFocus=false, lowText=false;
  for(let i=0;i<4;i++){
    const [width,phase]=[[360,'initial'],[360,'reload'],[414,'initial'],[414,'reload']][i];
    const c=proof.cycles[i],b=baseline.cycles[i],k=keyboard.cycles[i];
    if(!same(c,fields)||c.viewport_width!==width||c.phase!==phase||
       !obj(b)||b.viewport_width!==width||b.phase!==phase||
       !obj(k)||k.viewport_width!==width||k.phase!==phase||
       k.focus_follows_keyboard!==true||k.roving_tabindex!==true||
       ![c.focus_outline_rgb,c.adjacent_nav_rgb,c.selected_text_rgb,
         c.selected_background_rgb,c.inactive_text_rgb,c.inactive_background_rgb].every(rgb)||
       !Number.isFinite(c.outline_width_px)||c.outline_width_px<0||
       c.outline_width_px>20||typeof c.outline_style!=='string'||
       !['solid','dashed','double'].includes(c.outline_style))
      return fail('visual-cycle-invalid');
    if(c.focus_visible!==true||c.outline_width_px<2||
       c.locked_disabled!==true||c.locked_native_disabled!==true||
       c.locked_unfocusable!==true||c.locked_pane_hidden!==true)
      return fail('visual-focus-or-lock-invalid');
    // A diagnostic proxy: CSS outline color vs the solid nav background.
    // This does not assert contrast against every neighboring rendered pixel.
    lowFocus ||= rgbContrast(c.focus_outline_rgb,c.adjacent_nav_rgb)<3;
    lowText ||= rgbContrast(c.selected_text_rgb,c.selected_background_rgb)<4.5||
      rgbContrast(c.inactive_text_rgb,c.inactive_background_rgb)<4.5;
  }
  return {observed:true,code:'chromium-focus-contrast-sampled',
    focus_outline_contrast_finding:lowFocus,
    text_contrast_finding:lowText,
    universal_accessibility_attested:false,
    deployment_authorized:false};
}

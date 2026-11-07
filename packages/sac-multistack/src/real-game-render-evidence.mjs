// Strict host receipt for real LHS/Terrania renderer pixels from pinned source.
const SHA=/^[a-f0-9]{64}$/;
const CODES=new Set(['request-outside-sandbox','websocket-blocked',
 'popup-blocked','javascript-exception','artifact-http-failure',
 'seed-sample-nondeterministic','different-seed-sample-identical',
 'same-scene-pixels-differ','changed-scene-pixels-identical',
 'render-size-unexpected','render-empty','blank-negative-not-detected',
 'terrania-chunk-cache-unbounded','render-assertion-failed']);
const props=['schema_version','game','artifact_digest','status','executed',
 'dpr_variants_checked','samples','codes','runtime_scope',
 'gameplay_verified','multiplayer_verified','deployment_authorized'];
const sampleFields=['dpr','base_sha256','changed_sha256',
 'seed_sample_sha256','painted_pixels'];
const exact=(obj,fields)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join(',')===fields.slice().sort().join(',');
export function validateRealGameRenderReport(v,game,digest){
 if(!['lhs','terrania'].includes(game)||!SHA.test(digest)||
    !exact(v,props)||v.schema_version!==1||v.game!==game||
    v.artifact_digest!==digest||
    !['pass','fail','infra-error'].includes(v.status)||
    typeof v.executed!=='boolean'||!Number.isInteger(v.dpr_variants_checked)||
    v.dpr_variants_checked<0||v.dpr_variants_checked>2||
    !Array.isArray(v.samples)||v.samples.length!==v.dpr_variants_checked||
    !v.samples.every((s,i)=>exact(s,sampleFields)&&
      s.dpr===i+1&&SHA.test(s.base_sha256)&&
      SHA.test(s.changed_sha256)&&SHA.test(s.seed_sample_sha256)&&
      Number.isInteger(s.painted_pixels)&&s.painted_pixels>=0&&
      s.painted_pixels<=1000*610)||
    !Array.isArray(v.codes)||v.codes.length>14||
    v.codes.some(x=>!CODES.has(x))||
    v.runtime_scope!=='isolated-renderer-only'||
    v.gameplay_verified!==false||v.multiplayer_verified!==false||
    v.deployment_authorized!==false||
    (v.status==='pass'&&(!v.executed||v.dpr_variants_checked!==2||
      v.codes.length!==0||
      v.samples.some(s=>s.base_sha256===s.changed_sha256||
        s.painted_pixels<5000)))||
    (v.status==='fail'&&(!v.executed||v.codes.length===0))||
    (v.status==='infra-error'&&(v.executed||v.codes.length)))
  throw Error('real-game-render-evidence-unverified');
 return Object.freeze({...v,samples:Object.freeze(v.samples.map(s=>Object.freeze({...s}))),
  codes:Object.freeze([...v.codes])});
}
export function decodeRealGameRenderOutput(text,game,digest){
 if(typeof text!=='string'||text.length>32768)
  throw Error('real-game-render-output-unverified');
 const lines=text.split('\n').filter(x=>
  x.startsWith('SAC_REAL_GAME_RENDER_REPORT '));
 if(lines.length!==1)throw Error('real-game-render-output-unverified');
 let record;
 try{record=JSON.parse(lines[0].slice('SAC_REAL_GAME_RENDER_REPORT '.length));}
 catch{throw Error('real-game-render-output-unverified');}
 return validateRealGameRenderReport(record,game,digest);
}

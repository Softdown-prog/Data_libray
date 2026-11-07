// Strictly bounded, artifact-bound Canvas2D Chromium report validation.
const SHA=/^[a-f0-9]{64}$/;
const CODES=new Set(['external-request-blocked','popup-blocked','page-error',
 'dpr-backing-size-mismatch','drawn-frame-empty',
 'same-seed-pixels-differ','different-seed-pixels-identical',
 'blank-frame-negative-missed','canvas-browser-assertion-failed']);
const KEYS=['schema_version','scenario','artifact_digest','status',
 'executed','dpr_variants_verified','same_seed_repeated',
 'different_seed_checked','blank_frame_negative_checked',
 'codes','deployment_authorized'];
export function validateCanvasBrowserReport(report,digest){
 if(!report||typeof report!=='object'||Array.isArray(report)||
    Object.keys(report).sort().join(',')!==KEYS.slice().sort().join(',')||
    !SHA.test(digest)||report.artifact_digest!==digest||
    report.schema_version!==1||report.scenario!=='canvas-seeded-2d'||
    !['pass','fail','infra-error'].includes(report.status)||
    typeof report.executed!=='boolean'||
    !Number.isInteger(report.dpr_variants_verified)||
    report.dpr_variants_verified<0||report.dpr_variants_verified>2||
    !Array.isArray(report.codes)||report.codes.length>9||
    report.codes.some(x=>!CODES.has(x))||
    report.same_seed_repeated!==true||
    report.different_seed_checked!==true||
    report.blank_frame_negative_checked!==true||
    report.deployment_authorized!==false||
    (report.status==='pass'&&(!report.executed||
     report.dpr_variants_verified!==2||report.codes.length!==0))||
    (report.status==='fail'&&(!report.executed||report.codes.length===0))||
    (report.status==='infra-error'&&(report.executed||report.codes.length!==0)))
   throw Error('invalid-canvas-browser-evidence');
 return Object.freeze({...report,codes:Object.freeze([...report.codes])});
}
export function decodeCanvasBrowserOutput(text,digest){
 if(typeof text!=='string'||text.length>32768)
  throw Error('canvas-browser-output-unverified');
 const found=text.split('\n').filter(line=>
  line.startsWith('SAC_CANVAS_BROWSER_REPORT '));
 if(found.length!==1)throw Error('canvas-browser-output-unverified');
 let report;
 try{report=JSON.parse(found[0].slice('SAC_CANVAS_BROWSER_REPORT '.length));}
 catch{throw Error('canvas-browser-output-unverified');}
 return validateCanvasBrowserReport(report,digest);
}

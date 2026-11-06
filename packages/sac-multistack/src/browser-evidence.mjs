// SAC multistack browser result: synthetic, bounded, verified fields only.
const VALID_CASES=new Set(['vue-click','react-click']);
const VALID_CODES=new Set(['no-observable-transition','required-assertion-failed',
'application-pageerror','application-console-error','http-error',
'request-failed','network-policy-blocked','websocket-blocked',
'popup-blocked','unexpected-navigation']);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
export function validateSyntheticBrowserReport(raw,expected,digest){
 if(!VALID_CASES.has(expected)||!/^[a-f0-9]{64}$/.test(digest)||
   !exact(raw,['schema_version','scenario','artifact_digest','status',
     'executed','codes','deployment_authorized'])||
   raw.schema_version!==1||raw.scenario!==expected||
   raw.artifact_digest!==digest||raw.deployment_authorized!==false||
   !['pass','fail','infra-error'].includes(raw.status)||
   typeof raw.executed!=='boolean'||!Array.isArray(raw.codes)||
   raw.codes.length>8||raw.codes.some(c=>!VALID_CODES.has(c))||
   (raw.status==='pass'&&(!raw.executed||raw.codes.length))||
   (raw.status==='fail'&&(!raw.executed||!raw.codes.length))||
   (raw.status==='infra-error'&&(raw.executed||raw.codes.length)))
   throw Error('invalid-synthetic-browser-evidence');
 return Object.freeze({...raw,codes:Object.freeze([...raw.codes])});
}
export function decodeSyntheticBrowserOutput(output,expected,digest){
 if(typeof output!=='string'||output.length>32768)
   throw Error('browser-output-unverified');
 const lines=output.split('\n').filter(x=>x.startsWith('SAC_MULTISTACK_BROWSER_REPORT '));
 if(lines.length!==1)throw Error('browser-output-unverified');
 let raw;
 try{raw=JSON.parse(lines[0].slice('SAC_MULTISTACK_BROWSER_REPORT '.length));}
 catch{throw Error('browser-output-unverified');}
 return validateSyntheticBrowserReport(raw,expected,digest);
}

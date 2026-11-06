/**
 * Read-only, bounded Angular CLI [WARNING] diagnostic observation.
 * Complements (does not change) the existing error-only collector.
 * Compiler text and source content never leave this function.
 */
const HEADER=/^[ \t]*(?:▲[ \t]*)?\[WARNING\][ \t]+((?:TS|NG)[0-9]{4,5}):[^\r\n]*/gm;
const LOCATION=/^[ \t]*(\.?\/?[a-zA-Z0-9_.\/-]+\.(?:tsx?|html)):(\d{1,7}):(\d{1,5}):/gm;
const PATH=/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:ts|tsx|html)$/;
const safe=x=>typeof x==='string'&&x.length<=200&&PATH.test(x)&&
 !x.split('/').some(y=>y==='.'||y==='..'||y==='.git'||y==='node_modules'||y==='.env'||y.startsWith('.env.'));
export function collectAngularCompilerWarnings({stdout,stderr,exitCode,sourceFiles}={}){
 if(!Number.isInteger(exitCode)||exitCode<0||exitCode>255||
    !Array.isArray(sourceFiles)||sourceFiles.length>2048||
    new Set(sourceFiles).size!==sourceFiles.length||sourceFiles.some(x=>!safe(x))||
    typeof stdout!=='string'||typeof stderr!=='string'||
    stdout.length+stderr.length>32768)return null;
 const allowed=new Set(sourceFiles);
 const text=(stdout+'\n'+stderr).replace(/\x1b\[[0-9;]*m/g,'');
 const matches=[...text.matchAll(HEADER)],findings=[];
 for(let i=0;i<Math.min(matches.length,8);i++){
  const header=matches[i],code=header[1],angular=code.startsWith('NG');
  const chunk=text.slice(header.index+header[0].length,
   Math.min(matches[i+1]?.index??text.length,header.index+header[0].length+1200));
  let file=null,line=null,column=null;
  for(const m of chunk.matchAll(LOCATION)){
   const candidate=m[1].replace(/^\.\//,'');
   const ln=Number(m[2]),col=Number(m[3]);
   if(safe(candidate)&&allowed.has(candidate)&&
    (angular||/\.tsx?$/.test(candidate))&&Number.isSafeInteger(ln)&&
    ln>=1&&ln<=1000000&&Number.isSafeInteger(col)&&col>=1&&col<=10000){
    file=candidate;line=ln;column=col;break;
   }
  }
  findings.push({tool:angular?'angular':'typescript',severity:'warning',
   code,file,line,column,location_verified:file!==null});
 }
 return {schema_version:1,kind:'angular-cli-warning-observation',phase:'build',
  build_exit_code:exitCode,
  build_outcome:exitCode===0?'process-success':'process-failure',
  observed_warning_count:matches.length,findings,truncated:matches.length>8,
  location_verified:findings.length>0&&findings.every(x=>x.location_verified),
  compiler_invocation_verified:false,source_sha_verified:false,
  post_status:'not-run',browser_status:'not-run',
  root_cause_verified:false,deployment_authorized:false};
}

/**
 * Bounded, factual observation of Angular compiler TS errors.
 * NEVER returns raw stdout/stderr, arbitrary message text, source content or secrets.
 */
const HEADER=/^[ \t]*(?:✘[ \t]*)?\[ERROR\][ \t]+(TS[0-9]{4,5}):[^\r\n]*/gm;
const LOCATION=/^[ \t]*(\.?\/?[a-zA-Z0-9_.\/-]+\.tsx?):(\d{1,7}):(\d{1,5}):/gm;
const DESCRIPTIONS=Object.freeze({
 TS2322:'O compilador TypeScript registrou atribuição entre tipos incompatíveis.',
 TS2307:'O compilador TypeScript registrou que não encontrou um módulo.',
 TS2304:'O compilador TypeScript registrou um identificador não encontrado.',
 TS2339:'O compilador TypeScript registrou uma propriedade não reconhecida.'
});
const relative=s=>typeof s==='string'&&s.length<=200&&
 /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/.test(s)&&
 !s.split('/').some(x=>x==='.'||x==='..'||x==='.git'||x==='node_modules'||x==='.env'||x.startsWith('.env.'));
export function collectAngularCompilerFailure({stdout,stderr,exitCode,sourceFiles}){
 if(!Number.isInteger(exitCode)||exitCode<=0||!Array.isArray(sourceFiles)||
   sourceFiles.length>2048||sourceFiles.some(x=>!relative(x))||
   typeof stdout!=='string'||typeof stderr!=='string'||
   stdout.length+stderr.length>32768) return null;
 const allowed=new Set(sourceFiles);
 const text=(stdout+'\n'+stderr).replace(/\x1b\[[0-9;]*m/g,'');
 const matches=[...text.matchAll(HEADER)];
 if(!matches.length)return null;
 const findings=[];
 for(let i=0;i<Math.min(matches.length,4);i++){
  const header=matches[i],code=header[1];
  const chunk=text.slice(header.index+header[0].length,
    Math.min(matches[i+1]?.index??text.length,header.index+header[0].length+1200));
  let file=null,line=null,column=null;
  for(const m of chunk.matchAll(LOCATION)){
   const candidate=m[1].replace(/^\.\//,'');
   const ln=Number(m[2]),col=Number(m[3]);
   if(relative(candidate)&&allowed.has(candidate)&&
      Number.isSafeInteger(ln)&&ln>=1&&ln<=1000000&&
      Number.isSafeInteger(col)&&col>=1&&col<=10000){
    file=candidate;line=ln;column=col;break;
   }
  }
  findings.push({tool:'typescript',code,file,line,column,
   message:DESCRIPTIONS[code]??'O compilador Angular registrou um erro TypeScript.',
   location_verified:file!==null});
 }
 return {
  schema_version:2,source:'angular-cli-compiler-output',
  phase:'build',status:'fail',exit_code:exitCode,
  findings,truncated:matches.length>4,
  location_verified:findings.length>0&&findings.every(f=>f.location_verified),
  post_status:'not-run',browser_status:'not-run',
  root_cause_verified:false,deployment_authorized:false
 };
}

/**
 * SAC-041 v2: factual text writer for isolated Angular build failure.
 * Does not investigate causes, correct code, query knowledge or execute commands.
 * Only trusted compiler evidence, bound to the authenticated job, is accepted.
 */
const CODES=/^TS[0-9]{4,5}$/;
const ID=/^[a-z][a-z0-9-]{0,63}$/;
const JOB=/^gha-[0-9]{1,15}-[1-9][0-9]{0,3}$/;
const SHA=/^[0-9a-f]{40}$/;
const FILE=/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.tsx?$/;
const DESCRIPTIONS=Object.freeze({
 TS2322:'O compilador TypeScript registrou atribuição entre tipos incompatíveis.',
 TS2307:'O compilador TypeScript registrou que não encontrou um módulo.',
 TS2304:'O compilador TypeScript registrou um identificador não encontrado.',
 TS2339:'O compilador TypeScript registrou uma propriedade não reconhecida.'
});
const GENERIC='O compilador Angular registrou um erro TypeScript.';
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,n)=>obj(x)&&Object.keys(x).sort().join(',')===n.slice().sort().join(',');
const err=()=>{throw Error('invalid-factual-build-evidence');};
const SAFE_FILE=f=>typeof f==='string'&&f.length<=200&&FILE.test(f)&&
 !f.split('/').some(s=>s==='.'||s==='..'||s==='.git'||s==='node_modules'||
 s==='.env'||s.startsWith('.env.'));
export function validateTechnicalReport(report){
 if(!exact(report,['schema_version','job_id','project_id','profile_id','source_sha',
  'status','phase','exit_code','findings','truncated','post_status','browser_status',
  'root_cause_verified','deployment_authorized','text'])||
  report.schema_version!==2||!JOB.test(report.job_id)||!ID.test(report.project_id)||
  !ID.test(report.profile_id)||!SHA.test(report.source_sha)||
  report.status!=='fail'||report.phase!=='build'||!Number.isInteger(report.exit_code)||
  report.exit_code<1||report.exit_code>255||!Array.isArray(report.findings)||
  report.findings.length<1||report.findings.length>4||
  typeof report.truncated!=='boolean'||report.post_status!=='not-run'||
  report.browser_status!=='not-run'||report.root_cause_verified!==false||
  report.deployment_authorized!==false||typeof report.text!=='string')err();
 for(const f of report.findings){
  if(!exact(f,['tool','code','file','line','column','message','location_verified'])||
   f.tool!=='typescript'||typeof f.code!=='string'||!CODES.test(f.code)||
   f.message!==(DESCRIPTIONS[f.code]??GENERIC)||
   typeof f.location_verified!=='boolean')err();
  if(f.location_verified){
   if(!SAFE_FILE(f.file)||!Number.isInteger(f.line)||f.line<1||f.line>1000000||
    !Number.isInteger(f.column)||f.column<1||f.column>10000)err();
  }else if(f.file!==null||f.line!==null||f.column!==null)err();
 }
 const text=buildText(report);
 if(report.text!==text||JSON.stringify(report).length>4096)err();
 return report;
}
function buildText(report){
 const lines=[
  'Projeto '+report.project_id+', commit '+report.source_sha+'.',
  'A compilação Angular não foi concluída. Código de saída: '+report.exit_code+'.'
 ];
 for(const f of report.findings){
  const where=f.location_verified
   ?' no arquivo '+f.file+', linha '+f.line+', coluna '+f.column
   :' (arquivo e posição não confirmados)';
  lines.push('Erro '+f.code+where+'. '+f.message);
 }
 if(report.truncated)lines.push('Existem outras ocorrências omitidas pelo limite do coletor.');
 lines.push('Pré-compilação: aprovada. Pós-compilação e Guardian: não executados porque o build falhou.');
 lines.push('Este relatório registra eventos observados e não determina a causa raiz.');
 return lines.join('\n');
}
export function makeBuildTechnicalReport(job,evidence){
 if(!exact(job,['schema_version','job_id','project_id','profile_id','source_sha','kind'])||
   job.schema_version!==1||job.kind!=='angular-validate')err();
 if(!exact(evidence,['schema_version','source','phase','status','exit_code','findings',
  'truncated','location_verified','post_status','browser_status',
  'root_cause_verified','deployment_authorized'])||
  evidence.schema_version!==2||evidence.source!=='angular-cli-compiler-output'||
  evidence.phase!=='build'||evidence.status!=='fail'||!Array.isArray(evidence.findings)||
  evidence.findings.length<1||evidence.findings.length>4||
  evidence.location_verified!==evidence.findings.every(f=>f.location_verified)||
  evidence.root_cause_verified!==false||evidence.deployment_authorized!==false)err();
 const report={
  schema_version:2,job_id:job.job_id,project_id:job.project_id,
  profile_id:job.profile_id,source_sha:job.source_sha,status:'fail',
  phase:'build',exit_code:evidence.exit_code,
  findings:evidence.findings.map(f=>({...f})),truncated:evidence.truncated,
  post_status:evidence.post_status,browser_status:evidence.browser_status,
  root_cause_verified:false,deployment_authorized:false,text:''
 };
 report.text=buildText(report);
 return validateTechnicalReport(report);
}

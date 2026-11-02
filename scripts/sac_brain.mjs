/**
 * SAC Brain v1: local, bounded, deterministic knowledge lookup.
 * No model, API, network, dynamic code, shell, source execution or learning writes.
 * Input is the existing sanitized SAC diagnostic schema (or its containing result).
 * We NEVER include raw diagnostics/messages, arbitrary file paths or claimed line
 * numbers. Exact-code matching classifies evidence; it does not prove root cause.
 */
import {readFileSync} from 'node:fs';

const KNOWLEDGE_URL=new URL('../knowledge/sac-brain-v1.json',import.meta.url);
const CODE=/^[a-z][a-z0-9-]{0,63}$/;
const ASSERTION=/^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const PHASES=['pre','build','post','browser'];
const STATES=['pass','fail','unverified','infra-error'];
const UNKNOWN_CAUSE='Causa não identificada com a evidência estruturada disponível.';
const UNKNOWN_ACTION='Consulte a etapa SAC correspondente e acrescente uma regra revisada após confirmar a causa.';
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const safeString=(s,re)=>typeof s==='string'&&re.test(s);
const fail=()=>{throw Error('sac-brain-invalid-diagnostic');};

export function loadKnowledge(raw=JSON.parse(readFileSync(KNOWLEDGE_URL,'utf8'))){
 if(!exact(raw,['schema_version','locale','rules'])||raw.schema_version!==1||
  raw.locale!=='pt-BR'||!Array.isArray(raw.rules)||raw.rules.length>64)throw Error('sac-brain-invalid-knowledge');
 const index=new Map();
 for(const item of raw.rules){
  if(!exact(item,['code','phase','category','cause','action'])||
   !safeString(item.code,CODE)||!PHASES.includes(item.phase)||
   !safeString(item.category,CODE)||index.has(item.code)||index.size>=64||
   typeof item.cause!=='string'||!/^.{15,200}$/u.test(item.cause)||
   typeof item.action!=='string'||!/^.{15,200}$/u.test(item.action))
   throw Error('sac-brain-invalid-knowledge');
  index.set(item.code,Object.freeze({...item}));
 }
 return index;
}
const KNOWLEDGE=loadKnowledge();

function validated(input){
 // The trusted worker returns {diagnostic}; standalone SAC returns that directly.
 const d=object(input)&&own(input,'diagnostic')?input.diagnostic:input;
 if(!exact(d,['schema_version','status','checks','findings','truncated',
               'location_verified','deployment_authorized'])||
  d.schema_version!==1||!STATES.includes(d.status)||
  d.truncated!==false&&d.truncated!==true||
  d.location_verified!==false||d.deployment_authorized!==false||
  !object(d.checks)||Object.keys(d.checks).sort().join(',')!==PHASES.slice().sort().join(',')||
  PHASES.some(p=>!STATES.includes(d.checks[p]))||
  !Array.isArray(d.findings)||d.findings.length>8||
  JSON.stringify(d).length>4096)fail();
 for(const finding of d.findings){
  if(!exact(finding,['phase','status','code','assertion','title','next_step'])||
   !PHASES.includes(finding.phase)||!STATES.includes(finding.status)||
   !safeString(finding.code,CODE)||
   finding.assertion!==null&&!safeString(finding.assertion,ASSERTION)||
   typeof finding.title!=='string'||typeof finding.next_step!=='string')fail();
 }
 if(d.status==='pass'&&(d.findings.length!==0||
  PHASES.some(p=>d.checks[p]!=='pass')))fail();
 return d;
}

/** Analyze a sanitized SAC diagnostic without granting permission to deploy. */
export function analyzeSacDiagnostic(input,{knowledge=KNOWLEDGE}={}){
 const d=validated(input);
 if(!(knowledge instanceof Map))throw Error('sac-brain-invalid-knowledge');
 const findings=d.findings.map(f=>{
  const rule=knowledge.get(f.code);
  const matched=rule?.phase===f.phase;
  return {
   phase:f.phase,status:f.status,code:f.code,assertion:f.assertion,
   classification:matched?'known-pattern':'insufficient-evidence',
   category:matched?rule.category:'unknown',
   cause:matched?rule.cause:UNKNOWN_CAUSE,
   recommended_action:matched?rule.action:UNKNOWN_ACTION,
   evidence:'sac-code-only',
   file_verified:false,
   root_cause_verified:false
  };
 });
 const known=findings.filter(f=>f.classification==='known-pattern').length;
 const report={
  schema_version:1,engine:'sac-brain-v1',status:d.status,
  evidence_scope:'sanitized-sac-diagnostic',known,unknown:findings.length-known,
  checks:{...d.checks},findings,truncated:d.truncated,
  file_location_verified:false,root_cause_verified:false,
  deployment_authorized:false
 };
 if(JSON.stringify(report).length>8192)throw Error('sac-brain-output-too-large');
 return report;
}

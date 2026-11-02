/**
 * SAC Brain text v1: deterministic pt-BR explanations of sanitized diagnoses.
 * No LLM, Ollama, network, shell, external API, timestamps or raw input text.
 * Produces a separate operator-facing narrative; the worker report stays intact.
 */
import {analyzeSacDiagnostic} from './sac_brain.mjs';
import {interpretWorkerReply} from './sac_brain_worker_reply.mjs';

const PHASE=Object.freeze({
 pre:'pré-compilação',build:'compilação',post:'pós-compilação',browser:'navegador'
});
const CHECK=Object.freeze({
 pass:'aprovada',fail:'falhou',
 unverified:'não foi comprovada','infra-error':'encontrou erro de infraestrutura'
});
const HEADER=Object.freeze({
 pass:'As quatro etapas do diagnóstico SAC foram aprovadas. Isso não autoriza a publicação.',
 fail:'O diagnóstico SAC registrou uma falha. As possíveis causas abaixo não foram comprovadas.',
 unverified:'O diagnóstico SAC está incompleto ou não foi comprovado. Não há aprovação.',
 'infra-error':'A auditoria SAC registrou um erro de infraestrutura. O resultado do código não foi comprovado.'
});
const WORKER_UNVERIFIED=Object.freeze({
 'worker-query-not-completed':'A consulta ao Worker não foi concluída. Nenhum diagnóstico de projeto foi confirmado.',
 'job-not-recorded':'O Worker não encontrou um resultado gravado para esse job. Não há aprovação.',
 'worker-diagnostic-not-recorded':'O Worker retornou metadados do job, mas não um diagnóstico estruturado. Não há aprovação.'
});
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

export function renderSacNarrative(input){
 // All worker responses are first passed through their existing strict reader.
 // Do not trust caller-provided "cause", "message" or "summary" fields.
 const isWorker=isObj(input)&&Object.hasOwn(input,'exitCode');
 const analysis=isWorker?interpretWorkerReply(input):analyzeSacDiagnostic(input);
 const status=analysis.status;
 if(!Object.hasOwn(HEADER,status))throw Error('sac-brain-text-invalid-status');
 const source=isWorker?'panel-sac-worker-job':'sanitized-sac-diagnostic';
 const summary=isWorker&&Object.hasOwn(WORKER_UNVERIFIED,analysis.code)?
  WORKER_UNVERIFIED[analysis.code]:HEADER[status];
 const entries=[];
 if(isObj(analysis.checks)){
  for(const [phase,title] of Object.entries(PHASE)){
   const value=analysis.checks[phase];
   if(!Object.hasOwn(CHECK,value))throw Error('sac-brain-text-invalid-check');
   if(value!=='pass')entries.push('Etapa de '+title+': '+CHECK[value]+'.');
  }
 }
 if(!Array.isArray(analysis.findings)||analysis.findings.length>8)
  throw Error('sac-brain-text-invalid-findings');
 for(const item of analysis.findings){
  if(!isObj(item)||!Object.hasOwn(PHASE,item.phase))
   throw Error('sac-brain-text-invalid-finding');
  const phase=PHASE[item.phase];
  if(item.classification==='known-pattern'){
   entries.push('Na etapa de '+phase+', o SAC registrou o código '+
    item.code+'. Hipótese do catálogo: '+item.cause+
    ' Próxima verificação: '+item.recommended_action+
    ' A causa raiz não foi comprovada.');
  }else if(item.classification==='insufficient-evidence'){
   entries.push('Na etapa de '+phase+', o código '+item.code+
    ' não tem explicação validada para essa fase. Consulte a evidência do SAC; não há causa raiz comprovada.');
  }else throw Error('sac-brain-text-invalid-classification');
 }
 if(analysis.truncated===true)
  entries.push('O diagnóstico original foi truncado; podem existir outras ocorrências não listadas.');
 const output={
  schema_version:1,engine:'sac-brain-text-v1',locale:'pt-BR',source,status,
  summary,entries,known:analysis.known??0,unknown:analysis.unknown??0,
  truncated:analysis.truncated===true,
  origin_verified:false,root_cause_verified:false,
  deployment_authorized:false,read_only:true
 };
 if(JSON.stringify(output).length>8192)throw Error('sac-brain-text-output-too-large');
 return output;
}

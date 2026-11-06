// Actionable Angular diagnostics: fixed guidance only, never raw error text.
const statuses = new Set(['pass','fail','unverified','infra-error']);
const id = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const codes = /^[a-z][a-z0-9-]{0,63}$/;
const guidance = {
 'typescript-peer-incompatible':['TypeScript e Angular incompatíveis','Compare peerDependencies do Angular com a versão TypeScript instalada.'],
 'angular-peer-incompatible':['Pacotes Angular incompatíveis','Confira versões dos pacotes Angular e dependências peer.'],
 'node-engine-incompatible':['Node incompatível','Confira a versão Node suportada pelos pacotes instalados.'],
 'profile-installed-angular-mismatch':['Perfil Angular divergente','Alinhe o perfil SAC à versão Angular instalada.'],
 'installed-package-missing':['Dependência ausente','Confira a instalação e o lockfile Angular.'],
 'build-prerequisites-unverified':['Preparação do build não comprovada','A etapa de compilação não foi executada; consulte o pré-compilador e as fontes declaradas.'],
 'build-prerequisites-failed':['Preparação do build reprovada','Verifique a seleção de fontes e o contrato do snapshot antes de executar o Angular CLI.'],
 'build-prerequisites-infra-error':['Falha na preparação do snapshot','Confira permissões e disponibilidade dos arquivos no runner confiável.'],
 'preflight-unverified':['Pré-compilação não verificada','A execução do build foi bloqueada pelo estado do pré-compilador.'],
 'preflight-failed':['Pré-compilação reprovada','A execução do build foi bloqueada por falha na etapa anterior.'],
 'preflight-infra-error':['Infraestrutura do pré-compilador','O pré-compilador não conseguiu comprovar as verificações.'],
 'source-manifest-incomplete':['Fontes não comprovadas','Inclua fontes relevantes no manifesto do CI confiável.'],
 'official-build-failed':['Compilação Angular falhou','Examine a etapa oficial de build no GitHub Actions.'],
 'build-evidence-missing':['Recibo de build ausente','Forneça recibo assinado pelo host CI confiável.'],
 'build-evidence-unauthenticated':['Recibo de build inválido','Confira a assinatura e a chave no CI confiável.'],
 'artifact-mismatch':['Dist alterado','Refaça o build e gere um recibo novo sem alterar os arquivos.'],
 'mount-mismatch':['Caminho base divergente','Compare o mount esperado com o base href do HTML.'],
 'legacy-static-check':['Inconsistência estática do Angular','Confira a evidência específica no pós-compilador.'],
 'angular-bootstrap-unverified':['Bootstrap Angular não confirmado','Confira o componente raiz e o ng-version renderizado.'],
 'application-pageerror':['Exceção durante execução Angular','Investigue o erro de execução no cenário Playwright.'],
 'application-console-error':['Erro no console','Investigue o console do cenário de navegador.'],
 'required-assertion-failed':['Elemento ou ação não comprovada','Confira seletor, evento e visibilidade no cenário.'],
 'no-observable-transition':['Clique sem mudança visível','Verifique evento, estado Angular e renderização após o clique.'],
 'http-error':['Recurso HTTP falhou','Confira os assets compilados e o base href.'],
 'request-failed':['Requisição falhou','Verifique os assets locais referenciados no build.'],
 'network-policy-blocked':['Recurso externo bloqueado','Confira se o cenário depende de rede externa.'],
 'websocket-blocked':['WebSocket bloqueado','Separe funcionalidade online dos testes offline.'],
 'popup-blocked':['Nova janela bloqueada','Confira a navegação que abriu outra janela.'],
 'unexpected-navigation':['Navegação inesperada','Confira as rotas e o destino da interação.'],
 'browser-timeout':['Navegador excedeu o tempo','Verifique carga inicial e tempos do Playwright.'],
 'contract-missing':['Contrato Playwright ausente','Defina cenários de interface verificáveis.'],
 'artifact-mutated-during-browser':['Dist modificado durante teste','Evite modificações ao dist durante o Guardian.'],
 'browser-isolation-unverified':['Isolamento não confirmado','Execute Guardian no container isolado sem rede.'],
 'audit-infrastructure-error':['Auditoria incompleta','Consulte o estado do runner no GitHub Actions.']
};
const fallback = {
 pre:['Pré-compilação não aprovada','Confira compatibilidade Angular, TypeScript, Node e lockfile.'],
 build:['Build não comprovado','Confira compilação oficial e recibo do CI.'],
 post:['Pós-compilação não aprovada','Confira HTML, bootstrap, assets e caminho base.'],
 browser:['Teste de navegador não aprovado','Confira o cenário Playwright e a renderização.']
};
const state = x => statuses.has(x) ? x : 'unverified';
const safeId = x => typeof x === 'string' && id.test(x) ? x : null;
const safeCode = x => typeof x === 'string' && codes.test(x) ? x : 'diagnostic-unclassified';

export function makeDiagnosticReport(result) {
 const phases = result?.static_result?.phases ?? {};
 const checks = {pre:state(phases.pre?.status),build:state(phases.build?.status),
   post:state(phases.post?.status),browser:state(result?.browser?.status)};
 const findings = [];
 let truncated = false;
 const add = (phase,status,code,assertion) => {
   const c = safeCode(code);
   const a = safeId(assertion);
   if (findings.some(f => f.phase === phase && f.code === c && f.assertion === a)) return;
   if (findings.length >= 8) {truncated=true;return;}
   const [title,next_step] = guidance[c] ?? fallback[phase];
   findings.push({phase,status:state(status),code:c,assertion:a,title,next_step});
 };
 for (const phase of ['pre','build','post']) {
   const entry=phases[phase];
   if (!entry || entry.status === 'pass' || entry.status === 'not-applicable') continue;
   let seen=false;
   for (const rule of Array.isArray(entry.results) ? entry.results.slice(0,32) : []) {
     for (const ev of Array.isArray(rule.evidence) ? rule.evidence.slice(0,32) : []) {
       if (!statuses.has(ev?.status) || ev.status === 'pass') continue;
       add(phase,ev.status,ev.code,ev.assertion);
       seen=true;
     }
   }
   if (!seen && entry.code !== 'not-executed') add(phase,entry.status,entry.code,null);
 }
 const browser=result?.browser;
 if (browser && browser.status !== 'pass' && browser.status !== 'not-applicable') {
   let seen=false;
   for (const scenario of Array.isArray(browser.cases) ? browser.cases.slice(0,32) : []) {
     if (scenario.status === 'pass') continue;
     const reasons=Array.isArray(scenario.codes) && scenario.codes.length ?
       scenario.codes.slice(0,16) : ['required-assertion-failed'];
     for (const reason of reasons) add('browser',scenario.status,reason,scenario.id);
     seen=true;
   }
   if (!seen && browser.code !== 'not-executed') add('browser',browser.status,browser.code,null);
 }
 const secure=result?.static_pipeline_pass===true && result?.browser_pass===true &&
   result?.deployment_authorized===false && result?.network_isolation==='container-network-none' &&
   result?.browser?.sandbox==='docker-network-none';
 if (!secure && result?.browser_pass===true) add('browser','unverified','browser-isolation-unverified',null);
 const overall=secure?'pass':
   result?.status==='fail'||browser?.status==='fail'?'fail':
   result?.status==='infra-error'||browser?.status==='infra-error'?'infra-error':'unverified';
 const browserIntentionallySkipped = result?.static_pipeline_pass === true &&
   browser?.status === 'unverified' && browser?.executed === false && browser?.code === 'not-executed';
 if (!secure && !findings.length && !browserIntentionallySkipped) {
   add('browser',overall,'audit-infrastructure-error',null);
 }
 return {schema_version:1,status:overall,checks,findings,truncated,
   location_verified:false,deployment_authorized:false};
}

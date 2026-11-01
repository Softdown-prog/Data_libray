# Angular Guardian — base experimental

Pacote NPM **privado** (ainda não publicado) para fiscalizar a interface de um frontend compilado antes de promover o deploy. Este é um **primeiro módulo isolado**; ele não altera o One Worker, não executa comandos do GitHub e não instala nada na VPS.

## Política inicial

- Só conecta via HTTP a `localhost`, `127.0.0.1` ou `::1`. O frontend precisa ser compilado e servido localmente antes de rodar o Guardian.
- O contrato JSON declara somente rotas, seletores visíveis e cliques com resultado esperado. Não aceita shell, expressões JavaScript ou código remoto.
- Cada cenário usa uma página nova. Erros de JavaScript (`pageerror`), erros de console e HTTP 5xx detectados durante o cenário reprovam a avaliação. Falha ao iniciar Chromium produz `infra-error` e nunca `pass`.
- Ausência de casos ou de asserções é inválida. Sem uma especificação verificável, o Guardian não afirma que o frontend está correto.
- `pass` significa **somente** que o contrato executado passou, não que todo o app está sem bugs.

## Rodar com um aplicativo já compilado

Node.js 22+ e o Chromium do Playwright são necessários:

```bash
cd packages/angular-guardian
npm install
npx playwright install chromium
node bin/guardian.mjs verify \
  --url http://127.0.0.1:4783 \
  --config test/fixture-contract.json \
  --report /tmp/guardian-report.json
```

O endereço de exemplo usa o servidor de demonstração `node test/fixture-server.mjs`, que deve ser iniciado em outro terminal. **Não é um teste do Lan House Simulator.** Para testar um projeto Angular real, substitua o servidor e forneça um contrato próprio contendo seletores estáveis, preferencialmente `data-testid`.

Exit codes: `0=pass`, `1=fail`, `2=infra-error/contrato inválido`. O JSON é adequado a uma futura integração com o supervisor e com uma verificação obrigatória no GitHub.

## Separação de responsabilidades

- Biblioteca guarda e testa o pacote Guardian.
- One Worker da VPS (`scripts/vps_daemon.py`) continua cuidando dos exemplos do catálogo e **ainda não invoca este pacote**.
- Uma fase posterior adicionará tarefas `angular-app` aprovadas explicitamente, execução em container temporário com limites, armazenamento de evidências, transmissão de resultados autenticados e bloqueio real do deploy por `required status check`.

O mecanismo não faz rollback, correção autônoma nem escreve na `main` na v0.1.

## SAC-005 — adaptador integrado (opt-in)

`src/pipeline.mjs` exporta `verifyPipelineBrowser({ pipeline, guardian, timeoutMs })`.
`pipeline` contém os mesmos argumentos confiáveis de auditPipeline SAC-004
(profile/resources/receipt/key/sourceSha). O adaptador **reaudita** SAC-004, não
aceita um objeto static-pass arbitrário. A API/CLI verify v0.1 acima fica intacta;
sua aceitação de baseUrl não é usada como prova de artefato nesta integração.

```js
import { verifyPipelineBrowser } from './packages/angular-guardian/src/pipeline.mjs';
const guardian = {
  schema_version: 1, timeout_ms: 3000,
  cases: [{ id: 'state-change', path: '/', expect_visible: ['h1'],
    actions: [{ click: 'button', expect_visible: '.completed' }] }]
};
const result = await verifyPipelineBrowser({ pipeline, guardian, timeoutMs: 60000 });
```

O contrato integrado é estrito e declarativo: versão 1, até 10 casos, timeout por
operação de 100–10000 ms, até 10 seletores e 10 ações por caso, strings até 200
caracteres. Cada caso precisa de ação obrigatória; seu resultado deve estar
**ausente/invisível antes** e visível depois. Isso impede aprovar clique sem
mudança observável. Seletores/textos são do consumidor, não regras globais.
Cada rota é path local relativo ao mount do perfil, como / ou /settings/;
URLs, eval, módulos, shell e campos desconhecidos são rejeitados.
Sem contrato, browser é unverified; sem perfil Angular, not-applicable.
O host Angular do perfil precisa aparecer com ng-version, além das asserções.
Isso é evidência de bootstrap para estes casos, não prova universal do framework.

Somente após static_pipeline_pass=true é iniciado um worker Node temporário, com
heap JS de 256 MiB e ambiente mínimo (sem herdar credenciais/proxies do host).
A chave/receipt/source inputs ficam no pai; o worker recebe apenas dist,
digest autenticada, mount, host e contrato. Timeout total padrão60s/máximo120s
cancela o worker; SIGTERM pede fechamento de Chromium/servidor e há SIGKILL de
fallback após1s. Heap Node não limita a memória de Chromium; o host precisa de
limites de CPU/RAM/processos por cgroup/container/runner e limpeza da árvore em
falhas graves. Não há navegador persistente ou execução concorrente por instância.

O worker carrega somente o dist para memória, até64MiB/4096 entradas/24 níveis,
confere o mesmo manifesto SHA256 do SAC-004 e serve esses bytes num servidor
HTTP próprio, ligado exclusivamente a127.0.0.1, porta0 (efêmera). Rejeita symlinks,
traversal/encoding, Host diferente, métodos fora GET/HEAD e paths fora do mount.
Somente rotas declaradas recebem fallback para index.html; demais paths precisam
existir no artefato. Não há parâmetro baseUrl ou porta escolhida pelo contrato.
O host deve usar snapshot imutável: realpath/open ainda têm limite TOCTOU.
O dist em disco é revalidado ao terminar; mutação implica browser fail, mantendo
static_result original disponível e intacto. Conteúdo servido é o snapshot
verificado em memória, não uma URL/servidor externo fornecido pelo consumidor.

Chromium usa contexto novo por caso, sem permissões, downloads ou ServiceWorkers.
Routing permite somente a origem/porta/mount próprios e GET/HEAD, rejeita redirects
ou navegações inesperadas, bloqueia WebSocket e fecha popups. DNS fora do loopback
é desabilitado nos argumentos do Chromium e background networking é reduzido.
Pageerror, console.error, respostas HTTP>=400 e requestfailed geram códigos
estáveis, sem URLs, texto de console, stacks, screenshots ou dados privados.
Uma janela limitada de100ms drena erros assíncronos após as asserções; erros após
o fim do cenário não são observados. Contratos precisam aguardar estados relevantes.

**Fronteira de isolamento:** routing/flags são defesa da aplicação, não firewall
nem sandbox completa de Chromium. Não se promete isolamento de todos os protocolos,
processos do navegador, WebRTC/WebTransport ou código hostil. Antes de qualquer
uso em produção, **exigir runner/container descartável sem credenciais e com egress
restrito por firewall (somente loopback efêmero), sem redes internas/metadata,
e limites externos de CPU/RAM/PIDs**. O workflow desta etapa usa GitHub Actions
isolado e permissões contents:read; não constitui prova de um firewall externo.
O relatório declara network_isolation=application-routing-external-sandbox-required.
Nenhuma autorização de produção é emitida nesta etapa.

Saída v1 distingue static_pipeline_pass, browser_pass e deployment_authorized
(sempre false). static_result é o relatório SAC-004 original; binding contém
profile_digest/source_sha_claim/artifact_digest e digest do contrato Guardian.
Browser inclui status, executed e evidências por caso; ausência/incompletude
nunca vira pass. Deploy permanece unverified/executed=false. static pass pode
continuar true enquanto browser falha ou é infra-error; o status integrado reflete
browser. Casos Chromium indisponível/timeout são infra-error, separados de defeitos
DOM/eventos/rede que retornam fail. Sem prometer publicação ou backend reais.

O workflow `SAC Angular Guardian Browser` reutiliza apenas o **toolchain travado**
da fixture oficial P001 numa fixture independente em smoke/. Compila Angular AOT
real com componente standalone/signal. Prova raiz, subpath e coexistência híbrida,
handler que compila mas não atualiza DOM, erro runtime, recurso externo, redirect,
popup e WebSocket, timeout, Chromium indisponível e mutação do dist. JSONs ficam em
smoke/reports/browser.json e são anexados como sac-guardian-browser-evidence.
A coexistência híbrida usa entry legado sintético; não afirma testar React real.
Os 231 testes estáticos e smoke anterior permanecem nos workflows existentes.

# SAC-PRE002 — grafo AST de dependências Angular/TypeScript

Microetapa opt-in, inspirada nos limites de módulos DEPS do Chromium. Não está conectada ao SAC Core, One Worker, VPS, deploy ou outros projetos. A análise é somente leitura.

## Contrato

A função analyzeImportGraph({files, policy, typescript, tsconfig, jsonAssets, generatedFiles}) está em packages/angular-precompiler/src/dependency-graph.mjs. Recebe uma lista já enumerada pelo operador de arquivos .ts/.tsx, incluindo seus conteúdos, e uma instância confiável do compilador TypeScript, também fornecida pelo operador.

A função não lê o filesystem, não instala dependências, não executa builds ou código analisado, não acessa a rede e não corrige arquivos. O parâmetro `typescript` sempre vem do operador confiável, nunca do workspace analisado.

Exemplo de política:

- layers: [{name: 'ui', prefix: 'src/ui/'}, {name: 'domain', prefix: 'src/domain/'}]
- allowImports: {ui: ['ui', 'domain'], domain: ['domain']}
- external: ['@angular/', 'rxjs']

A saída determinística contém schema_version=1, rule_id=SAC-PRE002, status, scope=enumerated-typescript-sources-only, nodes, edges, findings, truncated, root_cause_verified=false e deployment_authorized=false.

## Estados

- pass: nenhum ciclo de import runtime nem violação de camada detectado nas fontes fornecidas, e todos os imports observados foram resolvidos ou explicitamente classificados como externos. Não comprova correção do projeto inteiro.
- fail: import proibido entre camadas ou ciclo runtime comprovado entre arquivos enumerados.
- unverified: arquivo ausente do conjunto, alias não classificado, import dinâmico sem string literal, parsing inconclusivo ou camada desconhecida. Não promover para pass.

Imports type-only contam como arestas de dependência mas não entram na detecção de ciclos runtime. Reexports, imports laterais e import('./mod') literais entram no grafo runtime. Sem `tsconfig`, aliases como `@app/foo` permanecem `unverified` e os imports relativos seguem a resolução estática original. Com `tsconfig`, o resolvedor oficial TypeScript interpreta `baseUrl`, `paths`, `moduleResolution` e `module` usando exclusivamente os arquivos enumerados em um host virtual em memória. Mapeamentos de alias incompletos são `unverified`, inclusive quando coincidem com um prefixo permitido em `policy.external`. Não há consulta a `node_modules`, URLs ou ao workspace no disco.

O `tsconfig` opcional tem formato `{path:'tsconfig.json',text:'<JSONC>'}` (até 16 KiB) e é parseado como dado pelo próprio TypeScript. Aceita aliases exatos e com até um `*` (máximo de 32 aliases e 8 destinos por alias), com `baseUrl` opcional; caminhos absolutos/traversal são rejeitados. Herança local `extends` (por exemplo, `tsconfig.app.json` → `./tsconfig.json`) funciona quando o operador fornece explicitamente `tsconfig:{path:'tsconfig.app.json',text:'...',parents:[{path:'tsconfig.json',text:'...'}]}`. São aceitos até quatro arquivos de configuração com nomes `tsconfig*.json`, todos no mesmo diretório virtual. Herança não enumerada, cíclica, fora desse diretório ou referências a projetos (`references`) continuam `unverified`. Opções de resolução não cobertas e tsconfig inválido também retornam `unverified`.

Imports JSON só podem ser classificados se `resolveJsonModule:true` estiver presente no tsconfig efetivo e o operador fornecer o JSON real em `jsonAssets:[{path:'src/data.json',source:'{...}'}]`. O auditor valida o conteúdo como JSON, resolve via TypeScript no host virtual e registra `asset_edges` separadamente, sem incluir JSON nos ciclos TypeScript. Ausência ou conteúdo incorreto não vira aprovação. Limites: até 32 JSONs, 32 KiB por item e 256 KiB no total.

Saídas geradas não são executadas nem inventadas: `generatedFiles:[{path:'src/app/runtime-config.ts',generator:'scripts/write-runtime-config.mjs'}]` apenas substitui a ocorrência genérica por `generated-source-not-captured`, mantendo `unverified` até o operador fornecer o arquivo gerado real. Imports profundos de pacote como `phaser/dist/phaser.esm.js` só são classificados como externos quando a política inclui explicitamente `phaser/`, e isso não comprova que o pacote esteja instalado. Todos esses limites existem para evitar falsos `pass`.

Limites conservadores: até 128 arquivos TypeScript, 512 KiB por arquivo, 2 MiB totais, 2048 imports e 256 findings. Caminhos POSIX relativos; nunca reproduz mensagens de compilador, código-fonte ou logs brutos. Erros de contrato lançam um erro fixo.

## Validação

O workflow SAC-PRE002 Angular import graph (isolated) instala a fixture TypeScript existente em packages/angular-postcompiler/smoke, executa node --test tests/sac_angular_dependency_graph.test.mjs e preserva os testes anteriores do precompiler. Os testes usam arquivos sintéticos e verificam casos positivos e negativos, ciclos, imports type-only, aliases, `baseUrl`, JSONC, imports dinâmicos literais, herança `extends` explicitamente enumerada, JSON real, arquivos gerados ausentes, imports profundos de bibliotecas, configurações inválidas, limites e ausência de vazamento do código-fonte.

Próxima etapa: comparar os novos diagnósticos com os snapshots autorizados e, somente após confirmar ausência de falsos positivos relevantes, considerar registro observacional no SAC Core. Nenhum merge ou deploy automático.

## Teste em snapshots reais fixados (somente leitura)

O workflow `sac-architecture-real-snapshots.yml` examina checkouts GitHub fixados por SHA dos repositórios públicos **Painel**, **Lan House Simulator** e **Terrania**, sem modificar seus arquivos nem executar código-fonte dos projetos. São exatamente 26, 38 e 48 arquivos TypeScript, respectivamente, sob as respectivas pastas `src/` (112 arquivos no total). O teste depende apenas do TypeScript instalado pela fixture confiável da Data Library.

A ferramenta `scripts/sac_architecture_real_snapshot.mjs` verifica limites de arquivos, bytes e symlinks, testa reprodutibilidade com ordem invertida e produz um artefato JSON sanitizado. A configuração principal de cada projeto é lida como dados; os `tsconfig.app.json` e variantes herdadas presentes no Painel/LHS agora são processados com o `tsconfig.json` original explicitamente fornecido; seus relatórios registram `pass`, `fail` ou `unverified` conforme as importações observadas, não conforme presunção de falha. O JSON real `src/site-rewrite/page-metadata.json` é incluído no LHS e o manifesto explícito de geração de `src/app/runtime-config.ts` é informado no Terrania, sem executar o gerador.

O resultado do CI pode ser verde mesmo quando o relatório do projeto estiver `fail` ou `unverified`: o CI atesta que o **auditor executou corretamente** e reportou a evidência, não que o projeto seja livre de problemas. Sem políticas arquiteturais revisadas por projeto, a prova real foca o grafo de imports/ciclos e não julga violações de camadas. `pass` aplica-se apenas às fontes TS enumeradas, não ao HTML, templates, backend, testes end-to-end ou publicação.

Os SHA dos snapshots são constantes versionadas; atualizar projetos exige uma microetapa explícita, não um fetch automático da `main` durante cada teste. Nenhuma alteração é feita em `main`, serviços, VPS ou projetos externos.

## Evidência do build Angular real — Terrania (experimento isolado)

O workflow `sac-terrania-build-evidence.yml` é separado do auditor estático. Somente ele executa uma cópia descartável de um commit **fixado** do Terrania (`6ce58c1687ad21c1d3e01dc87061751ca07a09f1`) no GitHub Actions, sem segredos, sem tokens persistentes no checkout e sem qualquer deploy ou uso da VPS. O código do SAC Core, o Worker e a `main` dos demais projetos não são alterados.

Antes de executar o gerador, o workflow confere o SHA do commit e o Git blob de `scripts/write-runtime-config.mjs` (`036b8e812fb0d7c423d270c64c7fcca284fb04a8`), verifica a ausência de `.env`/`.env.local` e instala dependências com `npm ci --ignore-scripts`. As variáveis públicas `VITE_MULTIPLAYER_URL` e `VITE_PRESENCE_URL` são passadas vazias. Em seguida executa `npm run typecheck` e `npm run build`, ambos na área temporária do runner, não no repositório de origem. A evidência só é gerada se o compilador e o build terminarem com código 0.

O script `scripts/sac_terrania_generated_build_evidence.mjs` lê a saída **efetivamente gerada** `src/app/runtime-config.ts`, verifica conteúdo reproduzível vazio, revisões e limites de arquivos, e executa o mesmo analisador SAC-PRE002 de duas formas: com o arquivo omitido (48 arquivos TS, duas dependências `generated-source-not-captured`) e incluído (49 arquivos TS, arestas para o módulo efetivo). A comparação é determinística e não interpreta o arquivo gerado como certificado de deploy ou de execução do jogo.

O artefato JSON publicado contém somente hashes, os caminhos fixados, status e contagens; nenhum conteúdo de variáveis, código-fonte, arquivos `.env` ou artefatos compilados é incluído no relatório. O próprio log do job contém a evidência da compilação e do build reais. A segurança do ambiente depende da revisão e fixação do código executado; não se afirma que executar um build de terceiros é seguro em qualquer contexto.

**Limite:** essa evidência cobre exclusivamente a geração de `runtime-config.ts` nesse snapshot do Terrania. Os dois imports dinâmicos do LHS continuam `unverified` até existir evidência de bundling verificável e vinculada ao commit exato, sem executar o jogo ou o sistema de pagamentos. O fluxo observacional não é integrado ao Worker e não autoriza deploy.

## Evidência de imports dinâmicos externos — LHS (ensaio isolado)

Dois imports não literais do Lan House Simulator permanecem intencionalmente fora do grafo TypeScript compilado: `src/main.ts` carrega `./js/main.js` via `gameUrl.href`, e `src/site-rewrite/account.ts` carrega `/game/js/sim/saveTransfer.js` via `modulePath`. A opção `@vite-ignore` não resolve o módulo em tempo de compilação. Uma compilação Angular aprovada, portanto, não comprova o carregamento pelo navegador.

O workflow `sac-lhs-dynamic-evidence.yml` usa somente o SHA fixado `c5139c2cc5088adc3bbf0bf85d2952e64e2fc5ac`, verifica os Git blobs de ambos os arquivos, instala dependências sem scripts de lifecycle, executa os sete testes sintéticos e constrói a saída estática limpa via `npm run build:site:clean` em runner descartável. Não publica o site, não acessa contas externas, não executa a simulação, não usa a VPS e não modifica repositórios externos.

O inspetor puro `runtime-external-evidence.mjs` recebe como strings os arquivos de origem, chunks JavaScript Angular e o resultado compilado do jogo. Verifica expressões `import()` não literais na AST de origem, indícios da URL e do import nos chunks emitidos, a presença dos alvos `game/js/main.js` e `game/js/sim/saveTransfer.js` no artefato e a inicialização Angular. Regras de caminho/tamanho e testes negativos evitam aprovações se faltar algum elemento. O relatório em `scripts/sac_lhs_dynamic_build_evidence.mjs` contém somente status, hashes, caminhos fixos, indicadores booleanos e contagens; não exporta código compilado nem conteúdos de contas.

**Importante:** o estado é intencionalmente `unverified` mesmo com artefatos consistentes. Isso comprova apenas presença e coerência das referências no build fixado, não que a URL responda HTTP 200, tenha MIME correto, obedeça CSP, carregue no navegador, nem que a validação de saves funcione. Para concluir o runtime são necessários testes controlados de navegador e de servidor estático, separados, antes de qualquer autorização de deploy.

### Prova complementar: imports dinâmicos no Chromium local

O script `scripts/sac_lhs_dynamic_browser_probe.mjs` usa os mesmos artefatos do snapshot LHS fixado por SHA, após o build de `out/site-clean-angular`, e inicia um servidor temporário em `127.0.0.1` com MIME de módulos JavaScript e a política CSP `Content-Security-Policy` extraída do arquivo `_headers` efetivamente construído. O servidor rejeita caminhos fora do diretório de saída, arquivos especiais, symlinks e extensões desconhecidas. O ambiente Chromium usa Playwright da dependência versionada `packages/angular-guardian`, sem conexão de navegador a hosts externos.

Verificações positivas: HTTP 200, MIME JavaScript, CSP e SHA-256 dos dois módulos nativos; navegação para `/game/` com Angular inicializado e requisição efetiva do Canvas JS; import real do módulo `/game/js/sim/saveTransfer.js` num documento de prova isolado (somente carregamento e verificação de `parseImportedSave`, **nunca** invocando a validação de um save). O teste não acessa os formulários de conta, login, doação ou pagamentos e não envia dados pessoais.

Verificações negativas: um 404, uma resposta com MIME `text/plain` e uma CSP `script-src 'none'` devem causar rejeição de `import()` no navegador. Sem essas rejeições, o workflow falha. O relatório JSON sanitizado expõe apenas SHA e status fixos, contagens e resultados booleanos. O jogo pode inicializar seu motor no contexto de teste, mas não recebe comandos de gameplay; isso não equivale a validação funcional nem aprovação de deploy.

**Escopo de evidência:** resultados positivos provam o carregamento dos módulos no Chromium com um servidor estático local representativo. Não provam Cloudflare Pages em produção, conectividade externa, login, pagamento, funcionamento do validador com um arquivo real ou todas as interações do jogo. O estado global de conformidade não é automaticamente elevado a `pass`; `deployment_authorized=false` permanece obrigatório.

### Recarregamento em viewport Android (360 e 414 px)

O mesmo script de teste Chromium agora executa, além da prova desktop e das três negativas, dois contextos móveis independentes (`isMobile`, `hasTouch`, `deviceScaleFactor=2`) de 360×800 e 414×896 pixels. Em cada contexto, `/game/` abre e recarrega uma vez, exigindo HTTP 200, novo carregamento de `game/js/main.js` com MIME JavaScript e SHA-256 fixado, inicialização do Angular e nenhum `pageerror`. O teste verifica `window.innerWidth` e o touch emulado; `horizontal_overflow_px` é apenas uma medida diagnóstica e não é certificação de responsividade.

Em documento local de prova separado, o módulo `game/js/sim/saveTransfer.js` também é importado antes e depois de um reload usando URLs de consulta distintas para evitar reutilizar a cache de módulos. O teste valida somente exportação, HTTP, MIME e hash; não executa o validador em salvamentos reais, não clica em botões de conta ou de pagamento e não testa interações do jogo. Os resultados para as quatro navegações de jogo e quatro imports do validador constam do JSON `mobile_reload_evidence` no relatório do Actions.

Esta é uma emulação mobile no Chromium desktop, não um teste físico no Android; pull-to-refresh do sistema, gestos reais, desempenho e Cloudflare em produção permanecem fora do escopo. A autorização de deploy permanece `false`.

### Toque real em controles do jogo após recarregar (microetapa isolada)

O probe de Chromium emula viewport com toque de 360 e 414 px e, para cada tamanho, executa **abertura e reload** do `/game/`. Após confirmar o bootstrap Angular, espera `data-game-ready=true`, toca em duas abas informativas Angular do menu (e exige `aria-selected` e conteúdo atualizado) e abre/fecha as opções nativas (e exige visibilidade + `aria-expanded`).

Num contexto de browser temporário e sem dados de usuário, o probe inicia somente uma nova campanha local de teste. Após o recarregamento, exige a opção **Continuar partida** e reabre o jogo. Em ambos os ciclos toca nos controles de zoom +, zoom − e **Ver tudo**, verificando que a porcentagem realmente mudou. Em seguida toca em **Menu** e verifica que a tela de início voltou. A execução não toca em compra, depósito, estoque, preços, conta, doação, importação/exportação ou reset destrutivo.

Erros JavaScript causados pelos toques falham o CI; o resultado sanitizado por viewport fica em `mobile_reload_evidence[].touch_controls`. Os toques são efetivamente sintetizados pelo Playwright com `hasTouch=true`, não são chamadas diretas a `.click()` ou despacho artificial de evento DOM. Não se afirma teste em dispositivo Android real, acesso a armazenamento externo, economia, cloud ou multiplayer. `deployment_authorized=false` permanece obrigatório.

### Swipe do Canvas e prevenção de clique acidental — mobile Chromium

O probe `scripts/sac_lhs_dynamic_browser_probe.mjs` executa também um gesto real de toque horizontal em `#scene-viewport` através do protocolo Chrome DevTools (`Input.dispatchTouchEvent`). Em **360 e 414 px**, antes e depois de `page.reload`, exige espaço horizontal rolável, deslocamento de `scrollLeft` superior a 15 px, zero eventos `click` no Canvas e manutenção dos painéis de administração, loja e posicionamento fechados. Caso o gesto não arraste o Canvas ou gere seleção/clique, o workflow falha.

Uma prova negativa complementar dispara `pointerdown`/`pointermove` com distância superior ao limiar e, em seguida, um `click` sintético cancelável no Canvas: o controlador em fase de captura do `scene-viewport` deve bloquear a chegada do clique ao elemento de jogo e marcar `defaultPrevented`. Esta prova sintética verifica a guarda do DOM, mas **não** substitui o gesto real medido separadamente. Após ambos os testes, os controles seguros de zoom, ajuste do enquadramento e retorno ao menu continuam sendo verificados.

O relatório publica apenas deslocamentos e estados booleanos, sem capturar jogabilidade, screenshots, contas, saves, pagamentos ou dados de usuário. É um teste do snapshot fixado do LHS em Chromium emulado; não é validação de um Android físico, de compra/posicionamento reais nem autorização de deploy.

### SAC Core — relatório consolidado, somente observacional

O workflow isolado do LHS agora executa `scripts/sac_lhs_core_observation.mjs` **após** as auditorias de artefatos e Chromium, produzindo o terceiro arquivo `sac-lhs-core-observation.json` na mesma coleção de artefatos de CI. O código puro em `packages/angular-core/src/lhs-observation-report.mjs` é um adaptador restrito à amostra LHS e não altera o `RuleRegistry`, os perfis, o fluxo SAC-P001, o recibo autenticado de build nem o critério de promoção do SAC.

O relatório liga os dois JSON pelo mesmo commit fixado e pelos hashes SHA-256 de `game/js/main.js` e `game/js/sim/saveTransfer.js`, exige evidência de módulos HTTP/MIME/CSP, cenário Chromium negativo, dois viewports (360 e 414 px), abertura e reload, toques, zoom, retorno ao menu e swipe sem clique acidental. Todos os resultados são apresentados em quatro categorias **independentes**: build/artefatos, carregamento de módulos, interface, jogabilidade. Uma categoria pode ter observação `observed`, enquanto sua aprovação SAC permanece `unverified`. Falha de uma categoria não apaga a evidência factual da outra.

**Limites obrigatórios:** o snapshot é fixado, o build não tem recibo SAC autenticado, a execução do navegador usa roteamento de rede no aplicativo (não o contêiner `network:none` do Guardian), a jogabilidade e o aparelho físico não foram testados. Assim `observation_status=unverified`, `runner_attestation_verified=false`, `official_build_receipt_verified=false`, `promotion_allowed=false` e `deployment_authorized=false` para qualquer saída. Não existe promoção tácita para `pass`. A saída é limitada a aproximadamente 4 KB e não contém código do LHS, dados de conta nem logs livres. O CI falha em caso de divergência de SHA, nomes de módulos, falsas alegações de pagamento/jogabilidade ou esquema incompatível.

### Vínculo com o recibo SAC-004 autenticado pelo host

Antes do build `npm run build:site:clean`, o workflow usa `prepareBuild()` do pipeline SAC-004 para executar o `SAC-PRE001` e capturar hashes de uma lista explícita de fontes do snapshot imutável LHS. O pré-flight deve passar em modo **blocking**. Depois do build e das provas reais de Chromium, um script do host verifica que os arquivos-fonte selecionados permanecem iguais aos blobs do commit fixado, e usa `sealBuild()` e `auditPipeline()` para autenticar via HMAC-SHA256 o estado do build, o compromisso das fontes, o perfil e o hash do **diretório de saída completo**. A chave efêmera é gerada **depois** da execução dos scripts de build, mantida apenas em memória no processo do host e nunca gravada, impressa ou publicada.

O novo `makeAuthenticatedLhsObservation()` só reconhece `official_build_receipt_verified=true` quando `auditPipeline()` confirma o recibo HMAC, o hash do `dist` real e o mesmo SHA de origem. O relatório preserva em separado os hashes de dois módulos nativos de import dinâmico e os testes de navegação, toque, reload e swipe. É uma prova vinculada ao **mesmo job**: não é atestado de execução assinado pelo GitHub, não certifica a completude do manifesto de fontes, nem prova que o compilador em si seja confiável. O build é um comando fixo do workflow, não comandado pelo perfil nem pelo relatório.

Este perfil usa `angular` e `workspace` para validar pré-flight + recibo de build; **não** marca o pós-compilador SAC-P001 obrigatório como concluído, pois o bundle final combina site institucional Angular e jogo em subdiretórios. A aprovação final do pipeline, jogabilidade real, teste em Android físico e deploy permanecem `unverified`; `promotion_allowed=false` e `deployment_authorized=false` nunca são derivados de um recibo isolado. O workflow executa também o conjunto de regressões de HMAC do SAC-004 com casos de chave errada, SHA divergente, build adulterado e output modificado.

### SAC-P001 — pós-compilação com escopos separados: site e jogo LHS

O build fixado `db639a1` produz `out/site-clean-angular/` com um site Angular em `/` e jogo isométrico em `/game/`. O site tem host semântico `<lhs-site>` e pode usar diretamente o **SAC-P001 v1** registrado no Core, com contrato de recursos derivados do manifesto emitido (`angular-site-assets.json`): `main-<hash>.js`, `styles-<hash>.css`, montagem `/` e bloqueio de scripts React legados. O P001 confere arquivos reais e referências HTML; o manifesto passa por limites de quantidade, nome e hash antes de definir o contrato.

**O jogo não possui um host Angular custom-element**. Em vez disso, seu arquivo HTML monta 13 ilhas Angular em `div` identificadas por IDs fixos; o Canvas e a simulação seguem nativos. Para evitar aprovação falsa, o validador separado `SAC-P001-ISLAND-EXT` em `packages/angular-postcompiler/src/lhs-scoped-postflight.mjs` confere a existência única dos 13 hosts, Canvas, scripts `__angular/main.js` e `js/privacyConsent.js`, estilos e recursos locais permitidos, ausência de React, caminhos de `/game/` e arquivos estáticos regulares. Ele usa DOM parseado (não regex de presença pura) e recusa traversal, URLs externas e JS inline. **Essa extensão NÃO é um passe do SAC-P001 v1 para o jogo.**

A prova é executada após a autenticação de `dist` e seu resultado é anexado ao relatório consolidado como `site_postcompile` e `game_islands_postcompile`, ambos com observação independente e aprovação global `unverified`. Os marcadores `site_p001_static_verified=true`, `game_island_static_verified=true` e `complete_sac_p001_coverage_verified=false` impedem confundir cobertura de subescopo com liberação do SAC. Os testes negativos cobrem HTML sem raiz, bundles ausentes, ilhas faltando/duplicadas ou dentro de `<template>`, reintrodução de React, ausência do Canvas, URLs externas/traversal, manifesto malformado e script inline. O snapshot, o site e o jogo são testados somente em CI isolado: a cadeia não prova funcionamento completo, dispositivo Android real nem publicação em produção.


### SAC-P001-ISLAND-EXT — extração reutilizável (Angular montado em DOM existente)

A lógica de validação estática das ilhas foi extraída para `packages/angular-postcompiler/src/angular-islands.mjs`, com contrato independente de projeto: versão 1, mount, lista explícita de hosts, elementos nativos obrigatórios, scripts Angular, recursos permitidos/necessários, arquivos presentes e política estrita de revisão de URL. O adaptador LHS mantém a lista de 13 hosts e seus recursos locais, delegando a verificação de DOM/recursos ao verificador genérico. O SAC-P001 v1 não foi alterado, e `SAC-P001-ISLAND-EXT` continua sendo uma extensão separada sem autorização de produção. Novos testes exercitam um dashboard fictício com hosts `div`/`section` para provar reutilização fora do LHS, além dos testes de regressão do LHS e do Chromium.

### SAC-P001-ISLAND-EXT v1 — registro por perfil no SAC Core

O adaptador `packages/angular-core/src/sac-p001-islands.mjs` registra a regra `SAC-P001-ISLAND-EXT@1.0.0` (fase `post`) no `RuleRegistry`, sem modificar a regra original `SAC-P001`. Projetos com ilhas Angular em elementos HTML existentes selecionam explicitamente a regra no perfil v1, com `capabilities: ['angular','angular-islands']` e `{rule_id:'SAC-P001-ISLAND-EXT',version:'1.0.0',required:true,enforcement:'blocking'}`. O host fornece `resources.dist` e `resources.islandContract`, e os valores de `profile.mount` e `islandContract.mount` devem coincidir.

**Política fail-closed:** a evidência `islands-static` pode ser `pass`, mas a regra Core retorna `status:'unverified'`, com `runtime-mount:unverified` e `promotion_allowed:false`. Seleção opcional ou `observe` é recusada no perfil, mesmo se outra regra passar. Defeito estático produz `fail`; ausência de recurso, versão incompatível e perfil inválido não promovem. Códigos de erro têm allowlist e não expõem HTML, URLs, dados ou caminhos livres.

O adaptador do LHS agora invoca a regra Core para `/game/` e só reconhece verificação estática com a prova positiva e o marcador de runtime não verificado. O site institucional continua com SAC-P001 original em `/`. O relatório geral mantém promoção e deploy `false`, mesmo com recibo de build autenticado e testes de HTML passando. Testes do Core cobrem versão, seleção bloqueante, mount divergente, host duplicado, arquivo ausente, URL remota, recursos faltantes e perfil incompatível; o Chromium continua como etapa separada.

### SAC-P001-ISLAND-EXT — observação de runtime via Chromium vinculada ao artefato

O SAC Core pode receber opcionalmente `resources.islandRuntimeEvidence` e `resources.islandRuntimeExpectation`. O primeiro é produzido por um teste real no Chromium; o segundo deve vir do host confiável, nunca do JSON do navegador. `verifyIslandRuntimeEvidence()` confronta SHA do commit, mount, lista integral de hosts, hash SHA-256 do entrypoint com o **arquivo no dist real**, event-name esperado e cobertura ordenada dos ciclos de viewport/abertura/reload. Evidência ausente mantém `runtime-not-verified`; evidência fornecida incorreta causa `fail` (sem códigos ou caminhos livres no relatório).

O LHS executa no browser (360px e 414px, abertura e reload) a verificação de conteúdo não vazio dos 13 hosts, checa marcos renderizados como `#time-weather-date` e `.angular-catalog`, confirma a resposta HTTP do entrypoint Angular contra o SHA do dist, emite `lhs:time-weather-updated` e espera a alteração observável da data no DOM via signal Angular. Não realiza compra, login, pagamento, save real ou interação destrutiva. Um teste de browser confirma uma **amostra de runtime**, não prova que cada uma das 13 ilhas implementou corretamente todos os eventos.

A regra Core registra asserções `islands-static:pass`, `browser-dom:pass/chromium-dom-event-observed` e `runtime-mount:unverified/full-runtime-not-verified` quando o vínculo passa. **O status global da regra permanece `unverified`, `promotion_allowed:false` e `deployment_authorized:false`**. Esse JSON não é atestado criptográfico de executor do GitHub; o recibo HMAC do SAC-004 autentica separadamente o build e o hash completo do dist. O relatório consolidado somente inclui a observação quando ambas as camadas passam. Contam como não verificados: Android físico, totalidade das interações Angular e jogabilidade.

### SAC-P001-ISLAND-EXT — eventos de dois componentes no Chromium (prova aditiva)

O ciclo isolado do LHS agora observa dois componentes adicionais sem mutar o simulador: o `angular-notice-inbox` recebe um aviso sintético via `lhs:notice-inbox-updated`, renderiza a carta no DOM e volta ao estado vazio; o `angular-finance-workspace` recebe um resumo sintético via `lhs:admin-finance-updated`, cuja apresentação é confirmada no DOM. Os eventos são enviados dentro de páginas descartáveis no Chromium, com 360/414px na abertura e recarga. Não são pressionados botões de aviso, compras, reinicialização, pagamentos nem ações econômicas.

O novo verificador genérico `verifyIslandComponentInteractions` recebe um contrato esperado **do host**, com dois probes versionados, IDs de hosts e eventos, além da prova de runtime previamente validada. Exige cobertura completa de ciclos, ordem, identidade, hash do mesmo entrypoint compilado e `dom_updated=true`. Evidência extra ou parcial é recusada; sem prova-base, uma alegação de interações falha e não é ignorada.

Mesmo com `component-events:pass`, a regra SAC Core permanece `unverified`, com `runtime-mount:unverified`, promoção e deploy proibidos. Isto verifica reações selecionadas, não todo o comportamento dos componentes nem a correção de estado da simulação. Não certifica runner, Android físico ou cobertura funcional universal.

### SAC-P001-ISLAND-EXT — navegação administrativa Angular ↔ controlador nativo

No snapshot isolado do LHS, o probe Chromium agora percorre navegação **não destrutiva** em Finanças e Estoque, em 360px e 414px, na abertura e após recarga. O teste inicia partida local descartável, abre `#admin` via botão real, seleciona área pelo Angular e toca em uma tarefa Angular segura (`finance/usage`, `stock/orders`). A seguir aciona o botão nativo existente (`finance/balance`, `stock/suppliers`) pelo DOM, exercitando os ouvintes originais. Depois de cada transição exige concordância entre `aria-pressed` Angular e nativo, painel da tarefa visível, seleção de área Angular/nativa e seletor responsivo. Confere ainda que o catálogo avançado de 1998 permanece bloqueado; não toca `finance/restart` nem compra, preço, assinatura, pagamento ou operação da economia.

A evidência tem dois novos probes (`finance-navigation` e `stock-navigation`, ambos associados ao evento `lhs:management-page-selected`) vinculados ao mesmo compromisso do módulo `__angular/main.js` e à prova-base de runtime. Os quatro ciclos exigem `dom_updated:true`; ausência, ordem incorreta, inconsistência de host/evento ou estado falso reprovam sem autorizar deploy. O relatório agrega `admin_navigation.observation=observed`, mas mantém todas as `approval=unverified`, `promotion_allowed=false`, `universal_runtime_attested=false` e `deployment_authorized=false`. Somente a navegação especificada foi exercitada, não a totalidade das áreas ou comandos administrativos.

### SAC — navegação de teclado e acessibilidade administrativa no Chromium

No snapshot fixado do Lan House Simulator, o teste de navegador exercita quatro ciclos (360 × 800 e 414 × 896; inicial e reload). Com o painel administrativo aberto em uma partida descartável, o Chromium focaliza uma aba Angular e envia teclas **Home**, **End**, **ArrowLeft** e **ArrowRight** reais. Para cada tecla, exige atualização da área nativa, aba Angular selecionada, painel visível, seletor responsivo sincronizado, foco na aba selecionada e exatamente um `tabIndex=0` (*roving tabindex*). O teste confere que o contêiner é `role=tablist`, que os botões são `role=tab` e que cada `aria-controls` referencia uma seção realmente existente. Confere também mudança de área via seletor responsivo em larguras mobile.

O JSON `admin_accessibility_evidence` é aceito apenas pelo validador limitado `packages/angular-core/src/sac-lhs-admin-accessibility.mjs`, vinculado ao SHA da fonte, ao hash do mesmo módulo Angular da prova Chromium de ilhas, à montagem `/game/`, ao host Angular de navegação e à ordem exata dos quatro ciclos. O consumidor valida a prova **depois** do recibo de compilação SAC-004 e da validação estática/dinâmica das ilhas. Negativos rejeitam alterações de foco, `aria-controls`, `tabindex`, ordem, módulos e fonte sem ecoar valores não confiáveis.

**Limites:** os testes não rodam um leitor de tela, não certificam WCAG/Android físico ou todas as áreas/tarefas, não realizam operações da economia e não corrigem automaticamente a interface. O relatório registra apenas `admin_keyboard_accessibility.observation=observed` com `approval=unverified`; `promotion_allowed=false`, `deployment_authorized=false` e `universal_runtime_attested=false` são mantidos.

### SAC — indicador de foco, contraste amostrado e catálogo bloqueado (Chromium)

O diagnóstico `sac-lhs-focus-contrast.mjs` aceita uma observação limitada do Chromium somente após a prova de build SAC-004, a validação das ilhas e a prova de navegação por teclado. Em 360 e 414 px, com abertura e recarga, o navegador foca uma aba pelo teclado, verifica `:focus-visible`, lê `outline-width` e `outline-style`, e amostra cores RGB opacas computadas do contorno, da superfície da navegação e dos textos/fundos de abas selecionadas e não selecionadas. O Core recalcula contraste relativo com sRGB linearizado: 3:1 para o contorno versus superfície da barra, 4,5:1 para rótulos normais. **Amostra CSS não substitui pixel rendering, auditoria WCAG ou avaliação de todas as superfícies adjacentes**.

Ainda na partida descartável de 1998, o navegador verifica que a tarefa de catálogo avançado Angular e seu botão nativo permanecem desabilitados, que o painel bloqueado continua oculto, que `focus()` não leva foco ao botão desabilitado e que `Shift+Tab` não o alcança. Não realiza compras, reset, pagamentos ou ações da economia.

O validador rejeita ciclos incompletos, campos extras, hashes incompatíveis, foco inexistente, largura de contorno menor que 2 px e bloqueio quebrado. Contraste insuficiente gera **finding explícito**, em vez de simular aprovação, e a automação permanece verde somente se a medição e os bloqueios funcionaram. O relatório registra `focus_and_contrast` como **observação** (com possível finding) e `focus_outline_contrast_finding` / `text_contrast_finding` como booleans. `approval:unverified`, `promotion_allowed:false`, `deployment_authorized:false`, `universal_runtime_attested:false` são mantidos. Correção visual do snapshot do jogo não está incluída nesta etapa.


### Reteste de contraste — snapshot corrigido em branch (04/11/2026)

O snapshot fixado neste experimento foi atualizado para `c5139c2cc5088adc3bbf0bf85d2952e64e2fc5ac` para testar a correção CSS na branch LHS `feat/lhs-angular-focus-contrast-sac-20261104`; a revisão original permanece rastreável no histórico. Além dos verificadores anteriores, o workflow só aprova sua própria execução quando `provenance.focus_outline_contrast_finding` e `provenance.text_contrast_finding` são ambos `false` no relatório autenticado do Chromium, mantendo `promotion_allowed=false`, `deployment_authorized=false` e `observation_status=unverified`. A amostragem de estilos não é certificação WCAG e nenhuma alteração é enviada ao deploy ou main.

### SAC-PRE002 — correlação conservadora por AST dos chunks emitidos

A inspeção de imports dinâmicos no bundle JavaScript agora analisa a chamada `import()` pela AST do TypeScript confiável, em vez de aceitar somente uma expressão regular. O marcador de URL e a chamada executável precisam ocorrer no **mesmo chunk**. Comentários, strings contendo `import(...)`, JS sintaticamente inválido e a combinação artificial de dois chunks independentes não produzem `bundle_dynamic_import_observed:true`.

Essa é uma prova estática mais restrita de consistência: os dois elementos no mesmo chunk ainda podem não estar conectados pelo fluxo de dados. O status geral continua `unverified`, com `runtime_execution_verified:false` e `deployment_authorized:false`. O Chromium e o recibo de build continuam responsáveis por suas evidências independentes. Os testes negativos de `tests/sac_lhs_runtime_external_evidence.test.mjs` protegem essa distinção.

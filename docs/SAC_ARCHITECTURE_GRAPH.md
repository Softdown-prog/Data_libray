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

O workflow `sac-lhs-dynamic-evidence.yml` usa somente o SHA fixado `db639a117024b2e14c4af844bfb69b90bef5da20`, verifica os Git blobs de ambos os arquivos, instala dependências sem scripts de lifecycle, executa os sete testes sintéticos e constrói a saída estática limpa via `npm run build:site:clean` em runner descartável. Não publica o site, não acessa contas externas, não executa a simulação, não usa a VPS e não modifica repositórios externos.

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

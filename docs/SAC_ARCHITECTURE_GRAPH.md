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

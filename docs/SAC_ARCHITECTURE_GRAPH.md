# SAC-PRE002 — grafo AST de dependências Angular/TypeScript

Microetapa opt-in, inspirada nos limites de módulos DEPS do Chromium. Não está conectada ao SAC Core, One Worker, VPS, deploy ou outros projetos. A análise é somente leitura.

## Contrato

A função analyzeImportGraph({files, policy, typescript}) está em packages/angular-precompiler/src/dependency-graph.mjs. Recebe uma lista já enumerada pelo operador de arquivos .ts/.tsx, incluindo seus conteúdos, e uma instância confiável do compilador TypeScript, também fornecida pelo operador.

A função não lê o filesystem, não instala dependências, não invoca compiladores, não executa código analisado, não acessa a rede e não corrige arquivos.

Exemplo de política:

- layers: [{name: 'ui', prefix: 'src/ui/'}, {name: 'domain', prefix: 'src/domain/'}]
- allowImports: {ui: ['ui', 'domain'], domain: ['domain']}
- external: ['@angular/', 'rxjs']

A saída determinística contém schema_version=1, rule_id=SAC-PRE002, status, scope=enumerated-typescript-sources-only, nodes, edges, findings, truncated, root_cause_verified=false e deployment_authorized=false.

## Estados

- pass: nenhum ciclo de import runtime nem violação de camada detectado nas fontes fornecidas, e todos os imports observados foram resolvidos ou explicitamente classificados como externos. Não comprova correção do projeto inteiro.
- fail: import proibido entre camadas ou ciclo runtime comprovado entre arquivos enumerados.
- unverified: arquivo ausente do conjunto, alias não classificado, import dinâmico sem string literal, parsing inconclusivo ou camada desconhecida. Não promover para pass.

Imports type-only contam como arestas de dependência mas não entram na detecção de ciclos runtime. Reexports, imports laterais e import('./mod') literais entram no grafo runtime. Alias como @app/foo permanece unverified a menos que uma etapa posterior de resolução confiável o mapeie. Somente imports relativos são resolvidos estaticamente (extensões .ts/.tsx, .js como .ts/.tsx, arquivos index.ts[x]). Não implementa tsconfig.paths, resolução de package exports ou resolução TypeScript oficial.

Limites conservadores: até 128 arquivos, 512 KiB por arquivo, 2 MiB totais, 2048 imports e 256 findings. Caminhos POSIX relativos; nunca reproduz mensagens de compilador, código-fonte ou logs brutos. Erros de contrato lançam um erro fixo.

## Validação

O workflow SAC-PRE002 Angular import graph (isolated) instala a fixture TypeScript existente em packages/angular-postcompiler/smoke, executa node --test tests/sac_angular_dependency_graph.test.mjs e preserva os testes anteriores do precompiler. Os testes usam arquivos sintéticos e verificam casos positivos e negativos, ciclos, type-only, imports não classificados, parsing incompleto, limites e ausência de vazamento do código-fonte.

Próxima etapa: resolver aliases via TypeScript e tsconfig confiáveis, comparar diagnósticos com falhas reais e somente depois propor registro observacional no SAC Core. Nenhum merge ou deploy automático.

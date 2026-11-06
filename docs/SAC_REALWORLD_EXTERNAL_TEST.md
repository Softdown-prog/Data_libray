# SAC x Angular RealWorld — fonte pública de terceiro

Alvo: https://github.com/realworld-apps/angular-realworld-example-app
Commit fixado: d426ec804f7d035c374aa4a1b48ecdb05a03eb02.
Angular 21.2.12; package manager Bun; assets e testes e2e dependem de submódulo.

## Etapa 1 — estática, executável no GitHub Actions

Checkout por SHA, submodules=false e persist-credentials=false.
Instalar exclusivamente dependências do SAC com npm ci --ignore-scripts.
Ler até 128 arquivos de fonte (48 TS e 11 HTML esperados), até 2 MiB.
Invocar ferramentas SAC-PRE001, PRE002, PRE003, PRE004 e PRE005.
O parser oficial @angular/compiler vem da fixture confiável do SAC;
nenhum módulo do aplicativo externo é importado ou executado.

Sensibilidade: o import de RouterOutlet é alterado somente em memória
para import type. O SAC-PRE003 precisa emitir
component-import-is-type-only e status fail para a mutação.

O SAC-PRE001 ainda não suporta o arquivo bun.lock (e a instalação do
aplicativo não será feita nesta etapa). Portanto, lock e resolução
instalada serão unverified, **não** falha atribuída ao aplicativo.

## Limites
O relatório é factual, somente códigos e contagens.
Nenhum clone de submódulo, bun install, AOT build, teste de integração,
backend remoto, Chromium, alteração no projeto original ou VPS.
O resultado overall permanece unverified, build/test/browser not-run.
Para build real, planejar Docker/rootless com dependências Bun
congeladas e submódulo Git fixado por SHA, ambiente sem credenciais,
limite de tempo, memória, CPU e rede.

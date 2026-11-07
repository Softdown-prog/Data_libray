# SAC — adaptadores reais para renderização procedural LHS + Terrania

Este workflow está empilhado após o scanner de fluxo do PR #76.
Ele exercita **código real dos renderizadores dos jogos**, não a fixture
procedural genérica. Usa dois checkouts públicos de projetos do usuário
fixados por SHA Git, em runner descartável do GitHub Actions.

## Lan House Simulator

Fontes: `src/sim/simulationState.ts` (o `createGame(seed)` e RNG
original) e `src/render/scene.ts` (`SceneRenderer` original).
Renderiza um estado estático numa superfície Canvas 2D de 1000x610.
Repete o mesmo estado/seed e exige pixels idênticos. Depois altera
`s.furniture.poster` (estado visual real da sala), exige novos pixels.
Compara também a sequência RNG original para mesma e outra seed,
com duas chamadas separadas ao simulador original. O desenho usa
um novo `SceneRenderer` para cada teste; evita efeitos de cache
de uma renderização anterior.

## Terrania

Fontes: `src/world/terrain.ts`, `src/world/random.ts`,
`src/render/WorldRenderer.ts`, `src/render/terrain.ts`.
Renderiza um recorte real do mundo de 512x512 via
`WorldRenderer.render`, em coordenadas/chunks controlados.
Prova repetição do mesmo mapa, mudança da câmera, limite de cache
de até 24 chunks e propriedades reais de tiles:
decoração numérica finita [0,1), conjunto de biomas conhecido,
coerência `isWalkable`, chunks incluindo coordenadas negativas
e mudança de semente em amostras controladas.

**Importante:** isso não inicia `PhaserGame`, combate, input,
batalha, sprites do jogador, câmera interpolada ou multiplayer. É
prova do renderizador de terreno, não de gameplay final.

## Método de execução e segurança

A runner instala `esbuild` e TypeScript apenas pelo lockfile
do LHS fixado (`npm ci --ignore-scripts`), sem executar scripts
de instalação dos jogos. Compila duas **entradas fixas do SAC**
que importam apenas os módulos dos renderizadores originais.
O JavaScript gerado é executado exclusivamente no Chromium
Docker fixado por digest, sem rede, sem credenciais, com
capabilities restritas. Não executa backend de pagamentos,
serviço multiplayer ou instalação do Terrania.

O navegador usa `getImageData()` no próprio Canvas, SHA-256 dos
pixels, duas densidades de tela (DPR 1 e DPR 2), repetição de
cena idêntica, mudança visual controlada e um controle negativo
que limpa os pixels intencionalmente. O host aceita somente
recibos com o SHA-256 da árvore de artefatos testada e códigos
pré-definidos, nunca afirma deploy autorizado.

Leitura AST de ambos os checkouts, em fluxo, é informativa;
`status=unverified` para código-fonte sem build do jogo inteiro.
Falhas reais de renderização são separadas de falhas de
infraestrutura e de propriedades. Todos os hashes são
observações da fixture/ambiente fixado, não golden images
universais entre versões do Chromium.

## Execução no CI

`sac-real-game-renderers.yml`: jobs de contrato + renderização
real em Chrome isolado. O resultado registra os SHA exatos
das duas revisões e distingue `browser_renderer_verified`
de `full_gameplay_verified=false`, `multiplayer_verified=false`
e `deployment_authorized=false`.

A etapa seguinte, separada, será iniciar a aplicação já compilada
de cada jogo dentro do sandbox e testar transições de input,
animação, mapas, colisões, UI, batalha e fluxo Phaser/Angular.

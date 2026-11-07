# SAC — teste de loop real em Terrania (Phaser) e Lan House Simulator

Complementa [PR #77](https://github.com/Softdown-prog/Data_libray/pull/77),
que já executa os renderizadores de ambos os jogos isoladamente.
Este teste executa **o motor temporal e os controles originais**, sem
interface de site Angular, backend, pagamentos ou multiplayer.

## Lan House Simulator: engine real

- Importa `createGame`/RNG, `stepGame` e `SceneRenderer`
  da revisão pinada `2cb4be0144354f1753c9a0cec4edca929a9dc92f`.
- Renderiza estado inicial e avança **90 minutos do jogo**, em lotes
  de 30 minutos, com APIs de produção.
- Confere `totalMinutes`, crescimento do número de visitantes observados,
  estado e desenho atualizados, `isValidSave`, repetição completa de estado
  com mesma seed e sensibilidade à mudança da seed.
- Isso NÃO verifica comportamento econômico em campanha de 35 dias,
  interações Angular, personagens em movimento a cada frame ou backend.

## Terrania: Phaser real

- Importa `mountGame` da revisão pinada
  `3c94b6f11d656afc6740121b853056efe164830c`.
  A dependência real é `PhaserGame -> Game -> Input -> OfflineSimulation`.
- Cria uma porta HUD mínima **primeira parte do SAC**, sem alterar código
  do jogo, e abre `?modo=classico&passos=1&seed=842136`.
- Observa o `canvas#game` criado pelo Phaser, ciclos `updateHero`
  em frames sucessivos, teclado **D** movendo pelo menos um tile,
  screenshot de Canvas não vazia, resize e liberação do jogo/canvas.
- É jogo offline: servidor multiplayer, ações remotas, combate completo,
  efeitos e fluxo de UI Angular não foram testados.

## Isolamento e confiança

O CI faz checkout por SHA exato; instala pacotes com
`npm ci --ignore-scripts` e o empacotamento de dois adaptadores fixos
com esbuild. Não chama scripts dos jogos. O JavaScript resultante só
é **executado em Chromium dentro do Docker** fixado por digest,
com `--network none`, limites CPU/RAM, sem secrets, sem chamadas
externas e sem permissões especiais; não usa a VPS. Dados da execução
são aceitos pelo host apenas em recibo com digest do artefato,
esquema estrito e códigos controlados.

Um teste verde significa que **aquele cenário**, naquelas versões,
passou. Não comprova ausência de bugs, builds completos, compatibilidade
de todas as GPUs, toda a campanha do LHS, servidor de jogo ou
multiplayer. Todos os resultados contêm
`complete_gameplay_verified=false`, `multiplayer_verified=false`
e `deployment_authorized=false`.

Este PR fica em draft até os dois jobs específicos e a suíte geral do
GitHub Actions ficarem verdes. Nenhum merge automático, alteração
na VPS, Worker ou repositórios dos jogos.

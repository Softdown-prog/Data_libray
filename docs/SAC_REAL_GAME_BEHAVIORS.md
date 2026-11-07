# SAC — cenários reais de combate, perseguição e filas

Dependências: PR #77 (Canvas dos jogos) e PR #78 (loops do Phaser e do LHS).

## Terrania — alvo selecionado e combate do jogo original

- Revisão fixada: `3c94b6f11d656afc6740121b853056efe164830c`.
- Executa `PhaserGame.mountGame` original com `Game`, `Input`,
  `OfflineSimulation`, `ClassicPursuit` e `ClassicCombat`.
- Usa um save local exclusivamente de teste com `seed=842136`,
  posição (-660,-1008), XP 20, próximo do slime real `-2,-2,0`,
  conforme cenário já documentado no Playwright do Terrania.
- Invoca a callback de seleção original. Um alvo inexistente deve
  ser rejeitado; o slime selecionado precisa ser perseguido,
  derrotado, registrar um abate e fazer XP passar a pelo menos 30.
  O movimento é validado por coordenadas de tiles do HUD original.
- O adaptador de HUD não implementa combate nem injeta monstros,
  e o multiplayer permanece intencionalmente desativado.

## Lan House Simulator — chegada e circulação real

- Revisão fixada: `2cb4be0144354f1753c9a0cec4edca929a9dc92f`.
- Avança 180 minutos de jogo em passos de um minuto chamando
  `stepGame` original, sem inserir clientes sintéticos.
- Inspeciona `counterQueueCustomers`, `counterQueueSlot`,
  `queueSlotsAreSeparated` da fila real, limites de lotação,
  unicidade de IDs, coordenadas e destinos finitos.
- Exige pelo menos dois clientes recebidos, fila observada,
  mudança de estágio da jornada de cliente, movimento medido
  entre minutos, `isValidSave` e execução reproduzível por seed.
- O teste NÃO afirma cobertura das filas de snacks/refrigerante
  ou de toda a economia, de layouts editados ou de campanhas inteiras.

## Segurança, critérios e evidência

Execução no GitHub Actions descartável. O host compila dois
adaptadores fixos via esbuild usando commits Git pinados;
todo código do jogo roda exclusivamente no Chromium Docker
limitado, sem rede, sem secrets e sem servidor multiplayer.
`npm ci --ignore-scripts` impede os scripts de instalação
dos próprios jogos. A análise de fonte ocorre em fluxo.

O host aceita somente relatório com hash SHA-256 do bundle
testado, campos e códigos delimitados, invariantes realmente
observados e prova de falha para relatórios fabricados.
Nunca declara `multiplayer_verified` ou
`complete_gameplay_verified`; `deployment_authorized=false`.

Este é um teste de comportamento com sementes e cenários conhecidos,
não uma afirmação de ausência de bugs. Se o cenário não ocorrer,
o resultado não será ajustado para verde silenciosamente.

PR em draft e empilhado sobre #78, sem merge automático nem
modificação na VPS, Worker ou repositórios dos jogos.

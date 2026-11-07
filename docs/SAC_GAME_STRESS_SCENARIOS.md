# SAC — stress de layouts de mercadorias e obstáculos de combate

A etapa anterior (#79) comprovou perseguição/abate no Phaser real e o
fluxo básico do caixa no LHS. Esta bateria amplia a cobertura por
**algoritmo e layout**, sem afirmar que testou todo o gameplay.

## Terrania — obstáculos, múltiplos monstros, foco e cooldown

Módulos importados sem modificações da revisão
`3c94b6f11d656afc6740121b853056efe164830c`:
`Player`, `Slime`, `ClassicPursuit`, `ClassicCombat`,
`OfflineSimulation`, `clearPath`.

Os cenários testados usam coordenadas e colisões **controladas pelo
teste**, mas o movimento, A*, golpe e dano são os códigos originais:

- Barreira contornável: perseguidor (16,16), alvo (180,16),
  parede x=64–106 / y=-32–48. Verifica que a linha direta está
  bloqueada, que o personagem dá a volta sem pisar dentro da
  parede e que termina em alcance real.
- Barreira fechada: passagem vertical x=70–105 totalmente vedada;
  jamais declarar que o alvo foi alcançado ou atravessar a parede.
- Dois alvos: seleção inicial do slime a leste, reposicionamento
  do alvo e troca para slime a sul. A rota antiga não pode ser
  reaproveitada; `suspend` precisa limpar o caminho.
- Combate focado com dois slimes sobrepostos: `ClassicCombat`
  só libera golpes no alvo selecionado; o outro não recebe
  dano colateral, duas batidas derrubam o slime e o motor
  original contabiliza abate/experiência. Seleção de morto
  ou ID inexistente deve falhar.
- Executa o mesmo conjunto duas vezes na mesma instância do
  navegador e exige recibo reproduzível.

Esses obstáculos são uma **fixture geométrica em memória**;
não provam a geração de mapas com as mesmas paredes ou a
simulação de outros tipos de monstro.

## Lan House Simulator — três geometrias de atendimento

Módulos originais de revisão
`2cb4be0144354f1753c9a0cec4edca929a9dc92f`:
`stepGame`, `retailQueueSlots`, `counterQueueSlot`,
`expandDirection`, `moveLayoutObject` e colisão/navegação.

Cenários com oito clientes predefinidos e seed 1933:
1. Máquina de refrigerante e sala de fábrica;
2. Expansão real a leste + deslocamento da máquina pelo editor;
3. Divisória interior próxima dos compradores + fila de doces.

Os oito clientes são uma **condição inicial sintética**, não
visitantes aleatórios e não um mock das rotas. Toda circulação,
estoque, cobrança e saída são calculados pelo `stepGame` real,
até 360 minutos do jogo. Verifica:
- vagas de fila distintas, sem invadir os lugares reservados
  ao caixa; todos os oito compradores terminam atendimento;
- deslocamentos efetivos, sem atravessar paredes, sobreposição
  de corpos ou teletransporte minuto a minuto;
- 8 a 16 compras, sem inconsistência `cash = inicial + receita -
  despesas`; as mudanças de layout devem ser aceitas;
- reprodução idêntica em duas execuções.

A fixture não prova layouts arbitrários do editor nem toda a
combinação de 14 clientes, mercadorias ou períodos históricos.

## Evidência, segurança e limitações

Host efêmero do GitHub Actions faz checkout de ambos os projetos
por SHA exato, varre o código em fluxo via SAC, empacota duas entradas
fixas com esbuild e executa os bundles somente dentro do Chromium
Docker **sem rede**, fixado por digest. Não instala nem roda scripts
dos jogos nem liga servidor multiplayer, pagamentos ou VPS.

O validador do host confere o SHA-256 da árvore de bundle, estruturas
exatas do relatório, resultados numéricos e controles adversariais:
wall-through, dano em segundo monstro, filas que não terminam,
colisão, teletransporte, cobranças inconsistentes e relatórios
forjados. `complete_gameplay_verified=false`,
`multiplayer_verified=false`, `deployment_authorized=false`.

Aprovação significa que **essas fixtures** passaram. Não equivale
a aprovar o jogo inteiro ou liberar deploy.

# SAC — parâmetros de animação orientados por módulos (Terrania)

## Origem e escopo

A referência primária é o [architecture/modules.json do Terrania](https://github.com/Softdown-prog/Terrania/blob/e116033578e1bab36c2c7080e10ae48b3070a54b/architecture/modules.json), no commit
e116033578e1bab36c2c7080e10ae48b3070a54b. A cópia
`packages/sac-multistack/fixtures/terrania/architecture/modules.json`
preserva o manifesto original para regressões, sem convertê-lo em
uma tabela fictícia de poses ou tempos. A integração é **opt-in**:
não altera o Terrania, SAC Core, Worker, Painel ou deploy.

A ferramenta usa as raízes declaradas dos módulos ativos `renderer`,
`actors`, `simulation` e `phaser-game`. Isso identifica código que
pode conter animação e comportamento, como `src/render/animation.ts`,
`src/render/heroPose.ts`, `src/actors/Player.ts`,
`src/engine/Weapons.ts` e `src/game/Game.ts`, sem tratar nomes
de arquivo ou a presença de Canvas como prova de qualidade visual.

## CLI para inspeção estática

Com o repositório do Terrania já disponível localmente:

```bash
npm ci --prefix packages/angular-postcompiler/smoke --ignore-scripts --no-audit --no-fund
node packages/sac-multistack/bin/animation-parameters.mjs /caminho/Terrania
```

Saída JSON:
- `modules` e `roots`: módulos e pastas realmente selecionados pelo índice;
- `parameters_observed`, `dynamic_parameters`: valores literais e expressões
  dinâmicas encontradas pelo AST TypeScript;
- `render_or_timer_calls`: chamadas observadas para desenho e temporização;
- `candidate_findings`: intervalos/durações literais não positivos, FPS
  literal inválido, transparência fora de 0..1, literais não finitos;
- `source_snapshot_sha256` e `module_manifest_sha256`: hash dos **arquivos
  inspecionados**, não validação automática do commit Git;
- `status=unverified` sempre, mesmo se `scan_completed=true`.
  Valores calculados em runtime não são inferidos por esse estágio.

O scanner processa no máximo 512 fontes TS/JS sob os módulos escolhidos,
16 MiB no total, 256 KiB por arquivo, 256 diretórios (configuração padrão).
Lê apenas arquivos regulares do checkout, recusa symlinks, caminhos externos
e artefatos especiais, não instala dependências do jogo e nunca importa
ou executa módulos do Terrania. A leitura é limitada a módulos conhecidos,
não é uma varredura irrestrita de 5.000 arquivos.

Código de saída 0 significa **somente enumeração completa sem erro de sintaxe**.
Não significa FPS aprovado, ausência de travamentos, qualidade da animação
ou autorização de deploy. Códigos 1/2 indicam observação incompleta ou
configuração inválida.

## Comparador de amostras de quadros

`assessAnimationFrameSamples` recebe objetos fornecidos por um **host
confiável**, cada um com `fps`, `timeMs` e `pose` com números finitos
`x`, `y`, `rotation` (radianos), `scaleX`, `scaleY` e `opacity` (0..1);
`progress` (0..1) é opcional. Exige exatamente duas taxas de quadros
(1..240), pelo menos dois checkpoints de tempo iguais em cada taxa
e até 512 amostras totais. Compara posição, rotação circular,
escala, opacidade e progresso usando tolerâncias explícitas.

Exemplo executável com posições iguais a 30 e 60 FPS:

```js
import {assessAnimationFrameSamples} from './packages/sac-multistack/src/animation-parameters.mjs';
const samples=[30,60].flatMap(fps=>[0,500,1000].map(timeMs=>({
  fps,timeMs,pose:{x:timeMs/100,y:0,rotation:timeMs/1000,
    scaleX:1,scaleY:1,opacity:1-timeMs/1000,progress:timeMs/1000}
})));
console.log(assessAnimationFrameSamples({samples}));
```

O comparador detecta valores NaN/infinito, timestamps duplicados,
checkpoints não alinhados, opacidade/progresso fora do intervalo,
escala zerada e divergência entre amostras em diferentes FPS.
**Não cria, executa nem autentica essas amostras.** Um `pass`
certifica apenas o contrato das amostras recebidas, com
`runtime_execution_verified=false`, nunca o jogo em execução.
Para provar animação real ainda são necessários renderer em sandbox,
captura de frames/pixels, métricas de frame time e verificação no
navegador desktop/Android.

## CI e auditabilidade

O workflow `sac-terrania-animation-parameters.yml` roda negativos
sintéticos e audita um checkout do Terrania **fixado por SHA**,
compara o manifesto original com a fixture e registra somente
observações de fontes, sem executar os scripts do jogo. A verificação
de SHA do checkout é feita pelo host CI, separadamente do scanner.
Todos os relatórios mantêm `deployment_authorized=false`.

Manter essa ferramenta separada do SAC-PRE002 (grafo de imports) e do
SAC Canvas (prova de pixels); são evidências diferentes e nenhuma
substitui as demais.

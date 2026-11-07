# SAC — código procedural e Canvas 2D (stream de milhares de fontes)

## Por que não enviar cinco mil arquivos como uma única string?

O módulo `procedural-canvas-stream.mjs` recebe um diretório de fontes
local do checkout confiável. Ele percorre diretórios em ordem estável,
abre **um arquivo por vez**, limita o tamanho de cada fonte, calcula
seu SHA-256 e analisa seu AST com TypeScript oficial já instalado na
toolchain confiável do SAC. Descarta o conteúdo e o AST antes de
abrir o arquivo seguinte. O próprio scanner não executa imports,
`eval`, scripts npm, código do jogo nem acessa a rede.

O checkout e o SHA Git são responsabilidade do host CI; este módulo
reporta `source_git_revision_verified=false`. O runner de referência
`sac_lhs_procedural_canvas_stream_probe.mjs` separadamente confere
o commit Git da fonte e **não** confunde isso com build ou runtime.

### Limites e semântica

- Até **20.000 arquivos-fonte**, **256 MiB acumulados**, 512 KiB por
  arquivo por padrão, até 4.096 diretórios e 180 s.
- Diretórios gerados ou de dependências (`dist`, `node_modules`,
  `build`, `out`, `.git`, etc.) são excluídos. Links simbólicos e
  arquivos especiais no escopo selecionado encerram a leitura, sem
  `scan_completed=true`.
- Processa JS, MJS, CJS, JSX, TS e TSX; ignora declarações `.d.ts`
  e bundles `.min.js`. Suporta AST de componentes, classes e funções,
  mas **não** resolve tipos, chamadas dinâmicas ou o grafo inteiro.
- Observa `getContext('2d')`, métodos de desenho, `Math.random()`,
  funções com nomes sugestivos de procedural e variáveis de semente.
  Os caminhos são limitados a 24 por categoria. **São candidatos,
  não bugs nem comprovação de execução.**
- `snapshot_sha256` é uma impressão dos arquivos **selecionados**
  (nomes e conteúdos), não um commit Git ou prova de que todos os
  arquivos transitivos foram incluídos.
- `status=unverified` mesmo se `scan_completed=true`. Sintaxe
  parseável não comprova tipagem, build, renderização ou gameplay.

### Testes de propriedades procedurais

`assessProceduralGridSamples` recebe **amostras produzidas por
um host confiável**, em vez de executar geradores arbitrários.
Para cada `seed` (UInt32), recebe duas matrizes `Uint8Array`
de largura/altura fixas. Verifica mesmo-seed/mismo-grid e tiles
no intervalo `0..maxTile`. Diversidade entre seeds é opcional:
mapas distintos não são garantidos matematicamente em qualquer
algoritmo, portanto diversidade não observada é `unverified`.
Limita amostras a 32 matrizes e 2 MiB totais. A procedência de
execução das amostras **não é autenticada** pelo comparador.

Não execute geradores de repositórios desconhecidos dentro do worker
confiável. Primeiro compile/execute em contêiner isolado sem
credenciais, CPU/memória/rede limitadas, depois envie as amostras
limitadas para o comparador.

### Canvas 2D: teste verdadeiro de pixels

O workflow do SAC executa uma **fixture first-party Canvas 2D** em
Chromium no Docker fixado por digest e sem rede. O navegador compara
SHA-256 de `getImageData()` e confirma:

1. Mesma semente => mesmos pixels em renders sucessivos;
2. Sementes distintas => pixels diferentes na fixture;
3. Render de controle que deixa o Canvas em branco => negativo detectado;
4. Backing-store correto para devicePixelRatio 1 (desktop) e 2 (mobile).

Os resultados são vinculados ao digest dos dois arquivos estáticos
aprovados. Relatório de códigos fixos, sem publicar pixels ou fontes
da aplicação. O `canvas-evidence.mjs` rejeita relatórios forjados,
DPR ausente, digest incompatível e conclusão verde sem execução.

**Isso prova o harness Canvas, não os gráficos ou gameplay do LHS.**
O job adicional faz só uma inspeção AST, em leitura, do
`Softdown-prog/A7-forge-2D-` na revisão
`6256f7cbbc835cc8cff4121dca51f5f855ea784e`.
Nenhum script do Lan House Simulator é executado ou instalado.

## Caminho para jogos grandes (5.000+ arquivos)

`Git checkout pinado -> scanner streaming -> caminhos candidatos
-> geração procedural em sandbox -> amostras por seed -> testes de
invariantes -> browser Canvas/frames/pixels -> relatórios separados`.

Gradualmente, podemos adicionar testes com colisão de tiles, monotonicidade
de recursos, objetos fora do mapa, densidade, culling, ordem de desenho,
`requestAnimationFrame` e perda/restauração de contexto. Isso depende
de um adaptador de gameplay explícito para cada motor, não de heurísticas
que declarariam milhares de erros falsos.

## Segurança / evidência

As análises ficam dentro do GitHub Actions efêmero. Não há execução
de fontes de terceiros, nem alteração nos jogos, VPS ou Worker.
Resultados sintéticos de procedural ou Canvas não liberam deploy.
`deployment_authorized=false` em todos os relatórios.

## CLI reutilizável para qualquer checkout

Depois de instalar o parser TypeScript **confiável do próprio SAC**:

```bash
npm ci --prefix packages/angular-postcompiler/smoke --ignore-scripts
node packages/sac-multistack/bin/canvas-stream.mjs /caminho/do/jogo src
```

No Lan House Simulator monorepo, informe `games/lan_house_simulator`
como diretório das fontes. O comando escreve um JSON de inventário no
stdout. Exit 0 significa apenas que terminou a leitura, sem erros de
parsing observados; o relatório continua `status=unverified` até
existirem provas de compilação, geração e browser. Não execute nem
instale o projeto externo no host confiável.

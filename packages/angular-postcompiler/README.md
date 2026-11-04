# Softdown Angular Postcompiler — SAC-P001

Pós-build isolado, sem fork do Angular. Verifica `dist-entry-consistency` no HTML
compilado antes de encaminhar o artefato ao Guardian. Requer Node >=22.

```bash
npm ci --prefix packages/angular-postcompiler --ignore-scripts
node packages/angular-postcompiler/bin/postcompile.mjs \
  --dist caminho/dist/browser \
  --contract packages/angular-postcompiler/smoke/contract.json > report.json
```

A CLI escreve somente o relatório JSON em stdout e resumo legível em stderr.
Exit code 0 exclusivamente para `pass`; 1 para `fail`, `unverified` e `infra-error`.
Não grava dentro do dist; o redirecionamento acima é feito pelo operador.

Contrato v1 completo (campos desconhecidos são rejeitados):

```json
{
  "schema_version": 1,
  "index": "index.html",
  "angular_host": "my-angular-shell",
  "mode": "angular-only",
  "angular_entrypoints": ["main-ABC.js"],
  "assets": ["styles-ABC.css"],
  "legacy_react_entrypoints": ["legacy-react.js"]
}
```

Todos os campos são obrigatórios. `angular_entrypoints` deve conter ao menos um
caminho exato, fornecido pelo produtor confiável do build (incluindo hash quando
existir); `assets` e `legacy_react_entrypoints` podem ser listas vazias. Não há
glob nem autodetecção de framework pelo nome do arquivo. `assets` exige arquivos
referenciados como script, stylesheet ou modulepreload. Recursos não referenciados
(por exemplo imagens) não pertencem a esse campo nesta versão. Entry Angular deve
ser script executável referenciado; modulepreload sozinho não basta.

`angular-only` reprova scripts React declarados que estejam referenciados no HTML;
`hybrid` permite essa coexistência. Arquivos React órfãos no diretório não são
considerados entrypoints. O produtor do contrato deve declarar os entrypoints
legados conhecidos; esta regra não identifica React dentro de bundles arbitrários.

O relatório estável contém `schema_version`, `rule_id`, `rule_name`, `status` e
`evidence`, com uma asserção e status por evidência. Sem relógio, caminho absoluto
ou stack trace. Precedência agregada: `infra-error`, `fail`, `unverified`, `pass`.
Arquivo ausente/vazio, host ausente, contrato inválido e caminhos inseguros são
`fail`; falhas de leitura/permissão inesperadas são `infra-error`.

## Escopo de caminhos

O diretório passado é a raiz pública do artefato, com o index diretamente nela.
Sem base explícita, URLs relativas e `/main.js` resolvem nessa raiz.
`<base href="/app/">` representa o mount público dessa raiz: `main.js` e
`/app/main.js` resolvem para `dist/main.js`. Base relativa terminada em `/` também
representa mount. Queries/fragments são removidos ao localizar arquivos; entidades
HTML são decodificadas pelo parser. Caminhos de contrato são relativos ao dist,
sem queries, percent encoding, segmentos vazios, `.` ou `..`.

Traversal, encoding ambíguo, backslash e symlinks escapando da raiz reprovam;
symlinks internos são permitidos. Não há fetch, import de bundle, eval ou shell.
URLs externas ou esquemas como `data:`, recursos fora do mount, múltiplas bases,
base sem `/` final, index aninhado sem mapeamento, scripts inline executáveis,
`nomodule` e tipos de script não suportados retornam `unverified`.
Valide artefato imutável: a checagem de realpath não protege contra outro processo
alterando symlinks simultaneamente.


## Limites de inspeção dos artefatos

O auditor estático lê arquivos regulares com um limite estrito: `index.html`
até **2 MiB**, cada recurso JS/CSS até **16 MiB**, no máximo **64 MiB**
acumulados e **512 leituras** por verificação. A leitura usa descritores locais,
confere o tamanho antes e depois da leitura e trata crescimento, truncamento
ou alteração de metadados detectável como `unverified`. Arquivos grandes,
muitos recursos ou arquivos mutáveis **não geram `pass`**. Não há truncamento
silencioso para aprovar parte do build.

O teto acumulado conta leituras repetidas (inclusive recursos referenciados
múltiplas vezes), de forma conservadora. Estas quotas não são garantia de
imutabilidade total nem substituem a sandbox: condições de corrida ainda são
possíveis, e o pipeline valida hashes completos por uma camada separada.
Se um build legítimo exceder os limites, o operador deve revisar o artefato e
o contrato em vez de desabilitar os portões de segurança.

## Testes

```bash
npm test --prefix packages/angular-postcompiler
npm ci --prefix packages/angular-postcompiler/smoke --ignore-scripts
npm run test:smoke --prefix packages/angular-postcompiler
```

Fixtures pequenas são criadas em diretórios temporários pelos testes Node:
positivo, bundle/CSS ausente ou vazio, host ausente, React proibido/híbrido,
traversal, base href, URLs externas e symlinks. O smoke separado usa `ng build`
oficial Angular 22 com componente standalone AOT; exige `pass` para o artefato e
`fail` após remover o bundle, mesmo tendo ocorrido build bem-sucedido. Seus JSONs
ficam em `smoke/reports/` e são anexados pelo CI. O workflow existente
`Validate code library` é preservado.

O `pass` comprova apenas consistência estática das asserções do contrato. Não
comprova bootstrap Angular, DOM dinâmico, clicks, rede, sintaxe/conteúdo dos
bundles, import graph transitivo, imports CSS ou publicação. A fixture HTML não é
teste runtime. Encaminhar essas verificações ao Guardian/Chromium; nenhum
resultado desta ferramenta deve ser chamado de browser-pass.

O pacote é privado. Não integra worker, VPS ou deploy. Testes de regressão
restringem as dependências dos módulos executáveis a parsing e leitura local;
o CI tem apenas permissão de leitura e upload de evidências no Actions.


## Extensão opt-in para ilhas Angular em DOM existente

A função \`verifyAngularIslands(dist, contract)\` de \`src/angular-islands.mjs\`
permite verificar **estaticamente** hosts Angular como \`<div id="widget-host">\`,
\`<section id="report-host">\` etc., sem depender de tag customizada.
O SAC-P001 v1 e a CLI continuam inalterados. A extensão mantém o identificador
\`SAC-P001-ISLAND-EXT\`, propositalmente distinto do \`SAC-P001\` original.

Contrato **exemplo** para uma aplicação arbitrária servida em \`/dashboard/\`:

\`\`\`js
import {verifyAngularIslands} from './src/angular-islands.mjs';
const report=await verifyAngularIslands('/tmp/dashboard-build',{
  schema_version:1,index:'index.html',mount:'/dashboard/',
  host_ids:['billing-host','report-host'],
  required_elements:[{tag:'main',id:'workspace'}],
  forbidden_tags:['legacy-app'],
  entrypoint_scripts:['modules/ui.js'],
  allowed_resources:['modules/ui.js','css/main.css','modules/data.js'],
  required_resources:['modules/ui.js','css/main.css'],
  required_files:['modules/data.js'],
  query_policy:'none'
});
\`\`\`

Todos os campos são obrigatórios, listas devem conter valores únicos,
caminhos são relativos ao dist, \`mount\` deve terminar em \`/\`, e \`query_policy\`
só aceita \`none\` ou \`hex12\` (exatamente \`?v=\` seguido de 12 hexadecimais).
\`host_ids\` exige a presença única dos hosts no HTML estático;
\`required_elements\` exige a tag correta para os IDs declarados;
\`entrypoint_scripts\` exige referência HTML \`<script src>\`, não apenas
arquivo existente. \`required_resources\` exige referências HTML;
\`required_files\` verifica a existência, inclusive para import dinâmico não
referenciado diretamente no HTML. Apenas recursos na allowlist explícita
\`allowed_resources\` são aceitos como scripts ou stylesheets.

Hosts ocultos em \`<template>\` não contam; IDs repetidos, JS inline,
URLs externas, traversal e caminhos percent-encoded falham. Arquivos fora
da raiz, vazios, symlinks e recursos acima de limites estritos não passam.
As verificações permitem, no máximo, 128 arquivos, 2 MiB de HTML,
16 MiB por recurso e 64 MiB totais. O resultado é limitado a
contagens e códigos fixos, sem devolver HTML, caminhos absolutos ou logs livres.

\`status:'pass'\` **não comprova** que Angular montou componentes, que o JS
produziu interação, que todos os imports existem, nem que o binário é confiável.
O retorno sempre inclui \`p001_v1_covered:false\`,
\`runtime_mount_verified:false\` e \`deployment_authorized:false\`.
Vincule com o recibo SAC-004 e Guardian em camadas separadas.

O LHS é um consumidor dessa função, com seus 13 IDs e caminhos mantidos em
\`src/lhs-scoped-postflight.mjs\`. Os testes \`test/angular-islands.test.mjs\`
usam um exemplo de dashboard independente do jogo.

### Ativação por projeto: seleção explícita e bloqueante

A extensão de ilhas tem registro versionado no SAC Core por `registerSACAngularIslands(new RuleRegistry())`, disponível em `packages/angular-core/src/sac-p001-islands.mjs`. O perfil v1 inclui `capabilities: ['angular','angular-islands']`, `mount` idêntico ao contrato e `{rule_id:'SAC-P001-ISLAND-EXT',version:'1.0.0',required:true,enforcement:'blocking'}`. Execute `execute({registry,profile,resources:{dist,islandContract}})`. O contrato não é um novo campo do perfil: é um recurso fornecido pelo host confiável.

Quando a estrutura está correta, o Core conserva `status:'unverified'` e divulga `islands-static:pass` com `runtime-mount:unverified`. Assim não autoriza promoção nem muda o SAC-P001 v1 ou sua CLI. Seleções opcionais ou `observe` são rejeitadas pelo validador para evitar aprovação indireta de outra regra enquanto faltam provas de execução.

### Prova de DOM e reação a eventos em navegador real

A regra versionada `SAC-P001-ISLAND-EXT` agora aceita, opcionalmente, dois recursos fornecidos pelo host: `islandRuntimeEvidence` (observação do Chromium) e `islandRuntimeExpectation` (contrato independente do host: commit esperado, entrypoint, viewports, fases, host reativo e nome do evento). O validador vincula o JSON à lista de hosts e ao SHA-256 do entrypoint **real** no dist; exige todas as fases ordenadas, DOM renderizado e alteração reativa observada. Prova incompleta/forjada reprova; a ausência da prova preserva `unverified`.

Mesmo quando a prova do navegador passa, o Core emite `browser-dom:pass` e mantém `runtime-mount:unverified` e `promotion_allowed:false`. Não é certificado universal de execução Angular, prova de Android real, assinatura do runner nem autorização de deploy.

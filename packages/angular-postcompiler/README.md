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

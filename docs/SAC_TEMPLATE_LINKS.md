# SAC-PRE004 — ligações Angular `@Component` ↔ templates HTML

Este módulo amplia a observação estática do pré-compilador sem substituir o compilador Angular. A implementação está em `packages/angular-precompiler/src/template-links.mjs` e só é acionada explicitamente; **não altera o Core, o worker, a VPS, a publicação ou o SAC-PRE003**.

## Contrato e limites

`inspectAngularTemplateLinks({files, templates, typescript})` recebe fontes `.ts/.tsx` e arquivos `.html` enumerados pelo operador, mais a API TypeScript confiável. Opera somente em memória; não importa código do projeto, não avalia expressões e não interpreta HTML como Angular.

- Reconhece `@Component` importado de `@angular/core` por nome, alias ou namespace. Decoradores homônimos de outros pacotes não são presumidos Angular.
- Para `templateUrl: './caminho.html'`, resolve a referência relativa ao arquivo TS, normaliza caminhos e confirma apenas se o destino existe na lista de templates HTML fornecida. Registra ligação e contagens de forma determinística.
- Para `template: '...'` ou literal sem interpolação, registra um template inline, **sem validá-lo como Angular**.
- Para referência não enumerada, caminho fora do escopo, expressão dinâmica, spread no decorator, combinação ambígua de `template` e `templateUrl`, ausência de template ou falha de parsing TS, gera um código de observação. **Referência não enumerada não prova ausência no projeto**; não causa `fail`.
- Os relatórios não contêm HTML, conteúdo TypeScript, mensagens de compilador, identificadores livres de símbolos ou tokens. Arquivos e caminhos de entrada seguem regras restritas, com limites de 128 arquivos TS, 128 HTML, 512 KiB por arquivo, 2 MiB no total, 512 componentes e 256 findings.

A saída contém `rule_id: SAC-PRE004`, `status: unverified`, contadores, links enumerados e códigos de finding. Retorna invariavelmente `angular_template_parsed:false`, `aot_verified:false`, `runtime_verified:false`, `root_cause_verified:false` e `deployment_authorized:false`.

## Comparação com Angular AOT em fixtures fixas

O script `scripts/sac_pre004_template_aot_rehearsal.mjs`, executado no workflow `.github/workflows/sac-pre003-aot.yml`, usa o `ngc` oficial da fixture `packages/angular-postcompiler/smoke` com versões imutavelmente resolvidas pelo lockfile. São cinco exemplos sintéticos versionados, compilados em diretórios descartáveis:

| Fixture | SAC-PRE004 | Angular AOT |
| --- | --- | --- |
| `templateUrl` com HTML enumerado e válido | linked, unverified | pass |
| `templateUrl` sem HTML enumerado | not-enumerated, unverified | fail (NG2008 / TS-992008) |
| HTML enumerado com elemento desconhecido | linked, unverified | fail (NG8001 / TS-998001) |
| HTML enumerado com método inexistente | linked, unverified | fail (TS2339) |
| Template inline válido | inline, unverified | pass |

Erros AOT são aceitos somente quando incluem o **código diagnóstico esperado**. Falha por instalação ou configuração não conta como acerto. O script não publica logs completos do compilador nem gera selo de produção.

Execução aprovada: [GitHub Actions 41926291056](https://github.com/Softdown-prog/Data_libray/actions/runs/41926291056).

## Observação em projeto real — LHS

A execução observacional reutiliza `c5139c2cc5088adc3bbf0bf85d2952e64e2fc5ac`, um checkout fixado do `Softdown-prog/A7-forge-2D-`, e o workflow `.github/workflows/sac-pre003-lhs-pinned-aot.yml`. Antes de instalar a toolchain do projeto, `scripts/sac_pre004_lhs_template_snapshot.mjs before` faz inventário restrito de `frontend-angular/src`. Em seguida, o workflow executa os builds oficiais `game-ui` e `site-rewrite`; `after` verifica o relatório anterior e o resultado AOT independente sem modificar arquivos versionados.

**Resultados observados nessa revisão:** 45 arquivos TypeScript, 44 arquivos HTML, 45 componentes, **43 `templateUrl` ligados**, **2 templates inline**, **0 referências externas não enumeradas** e **0 findings**. Ambos os builds oficiais AOT passaram. Execução: [GitHub Actions 41926466133](https://github.com/Softdown-prog/Data_libray/actions/runs/41926466133).

A relação entre um template e o arquivo HTML **não** significa que o arquivo tenha sido compilado como parte de todos os entrypoints. Os builds AOT percorrem seus próprios grafos; um arquivo TS que não participa deles não recebe certificado individual. A análise não comprova injeção de dependências, bindings, template type checking universal, renderização, navegação, acessibilidade nem estado em Android. O Chromium continua necessário para observar comportamento real.

## Testes e execução

```bash
npm ci --prefix packages/angular-postcompiler/smoke --ignore-scripts --no-audit --no-fund
node --test tests/sac_angular_template_links.test.mjs
node scripts/sac_pre004_template_aot_rehearsal.mjs
```

O workflow do LHS é executado com um checkout imutável e dependências próprias do jogo em runner descartável; não há alterações de código no repositório LHS nem acesso aos serviços da VPS. Não é um gate global de deploy e a aprovação de CI não concede `deployment_authorized`.

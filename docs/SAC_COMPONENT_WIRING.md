# SAC-PRE003 — conexões declaradas em componentes Angular (opt-in)

Este analisador é uma **microetapa independente de pré-compilação**, apenas para diagnóstico dos metadados de classes decoradas com `@Component` do pacote oficial `@angular/core`. Não executa fontes de projetos, templates, scripts, Angular, npm, rede ou build. A única dependência de parsing é a instância de TypeScript confiável passada pelo operador.

## Contrato

`analyzeAngularComponentWiring({files, typescript})`, em `packages/angular-precompiler/src/component-wiring.mjs`, recebe explicitamente até 128 arquivos `.ts/.tsx` com conteúdo. O limite é 512 KiB por arquivo, 2 MiB no total, 512 componentes e 2048 elementos em arrays de imports. A análise é em memória, sem leitura de filesystem e sem imports de código dos projetos. Arquivos malformados ou não enumerados não geram uma falsa aprovação.

São reconhecidos `import { Component }`, aliases e `import * as ng` vindos de `@angular/core`. Decoradores com o mesmo nome, mas definidos em outra biblioteca ou localmente, não são considerados Angular.

O auditor sinaliza dois erros estruturais **comprováveis no escopo inspecionado**:

- `component-import-is-type-only`: um identificador em `@Component({imports:[...]})` foi fornecido apenas por `import type`, `import {type X}`, `interface` ou `type`, sem declaração runtime local. Esse símbolo não está disponível como valor JavaScript.
- `nonstandalone-component-declares-imports`: `@Component({standalone:false,imports:...})` declara a propriedade `imports`, exclusiva de componentes standalone.

Metadados dinâmicos, spreads, expressões em arrays, valores de `standalone` não literais, símbolos não demonstrados e parsing incompleto são `unverified`, não `fail`. Referências que correspondem a bindings de valor são **observadas**, não certificadas como diretivas, componentes ou módulos Angular.

## Saída e limite de confiança

O relatório tem `schema_version:1`, `rule_id:SAC-PRE003`, contagens, códigos fixos, caminhos relativos enumerados e índices dos componentes. Não publica código-fonte, strings arbitrárias, logs, valores de configuração, tracebacks nem tokens.

O status é **`fail` para erro estrutural demonstrado** e **`unverified` nos demais casos**, mesmo que o conjunto de componentes pareça consistente. Sempre retorna `aot_verified:false`, `component_runtime_verified:false`, `root_cause_verified:false` e `deployment_authorized:false`. Não substitui `ng build`, o template checker Angular, a injeção de dependências, o SAC-P001, nem o Guardian com Chromium. Não é conectado automaticamente ao SAC Core, Worker, VPS ou deploy.

## Testes

```bash
npm ci --prefix packages/angular-postcompiler/smoke --ignore-scripts --no-audit --no-fund
node --check packages/angular-precompiler/src/component-wiring.mjs
node --test tests/sac_angular_component_wiring.test.mjs
```

Os testes cobrem `import type` e bindings de interface, decorators em namespace, `standalone:false`, metadata dinâmica, spreads, ausência de declarações, falso decorator Angular, entradas maliciosas, determinismo, exclusão de segredos e erros de parsing. O workflow isolado de grafo arquitetural executa este conjunto junto aos testes anteriores.

Próxima etapa futura: comparar relatórios com o AOT Angular em snapshots versionados, sem promover uma observação estática a aprovação de runtime.

## Comparação isolada com o compilador Angular AOT

O script versionado `scripts/sac_pre003_aot_rehearsal.mjs` é executado pelo workflow `.github/workflows/sac-pre003-aot.yml`. Ele compila **somente cinco fixtures sintéticas fixas**, em diretórios temporários sob `packages/angular-postcompiler/smoke` (dependências oficiais `@angular/compiler-cli` 22.0.0 e `typescript` ~6.0.0, resolvidas pelo lockfile). A fixture define `rootDir: './src'` explicitamente para respeitar a regra do TypeScript 6 (TS5011). Nenhum projeto externo, arquivo da VPS ou app de produção é executado.

| Caso | SAC-PRE003 | ngc / Angular AOT |
| --- | --- | --- |
| imports diretos com componente válido | unverified | pass |
| `import type` usado em `imports` | fail: component-import-is-type-only | fail: TS1361 |
| `standalone:false` com `imports` | fail: nonstandalone-component-declares-imports | fail: NG2010 / TS-992010 |
| símbolo `Missing` sem binding | unverified: component-import-binding-unverified | fail: TS2304 |
| array `const SHARED_IMPORTS` | unverified: component-imports-dynamic | pass |

Uma falha AOT só é aceita como evidência se tiver o **código diagnóstico esperado**, e não simplesmente um exit code diferente de zero: problemas no ambiente, configuração ou dependências não podem produzir falso acerto. Os dois casos AOT positivos precisam de exit code zero. Os relatórios são sanitizados, sem mensagens ou fontes de projetos. Os arquivos temporários são eliminados mesmo se o teste falhar.

A saída `SAC-PRE003-AOT-REHEARSAL` inclui `aot_verified:true` **somente para cada fixture sintética efetivamente compilada** e `production_aot_verified:false` no agregado. Não muda o comportamento do analisador universal: `aot_verified:false`, `component_runtime_verified:false`, `deployment_authorized:false`. Não promove `unverified` para `pass` e não conecta o SAC-PRE003 ao Core, One Worker, VPS ou deploy.

Para reproduzir no CI com o mesmo lockfile:

```bash
npm ci --prefix packages/angular-postcompiler/smoke --ignore-scripts --no-audit --no-fund
node --test tests/sac_angular_component_wiring.test.mjs
node scripts/sac_pre003_aot_rehearsal.mjs
```

O escopo continua intencionalmente estreito: esses cinco testes de concordância não comprovam template checking universal, injeção de dependências, estado reativo, navegabilidade ou ausência de regressões nos jogos e painéis. A evolução posterior deve ampliar as fixtures somente após revisão explícita, preservando o uso do AOT oficial como referência independente.

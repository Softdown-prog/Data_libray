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

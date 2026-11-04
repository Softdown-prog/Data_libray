# SAC-PRE005 — Observação de bindings e handlers Angular

Esta etapa acrescenta um analisador **opt-in e independente** para expressões de templates Angular. O módulo `packages/angular-precompiler/src/template-binding-evidence.mjs` recebe os mesmos arquivos TypeScript/HTML enumerados que a regra SAC-PRE004, mais instâncias confiáveis do TypeScript e do `@angular/compiler`. A biblioteca não instala pacotes, executa fontes de projeto, dispara builds, acessa rede, importa a aplicação, concede permissão de deploy nem altera o SAC Core ou a VPS.

## O que é realmente inspecionado

1. Reutiliza o SAC-PRE004 para identificar `templateUrl` com link estático a um HTML fornecido explicitamente.
2. Analisa esses templates externos usando `@angular/compiler.parseTemplate`, sem executar os bindings. Atualmente **não inspeciona templates inline** nem promete cobrir todos os tipos de nós da AST Angular.
3. Registra contagens de `BoundEvent`, `BoundAttribute` e `BoundText` (interpolações). Para métodos chamados diretamente, como `(click)="save()"`, e leituras diretas, como `[title]="label"`, compara o símbolo com os membros **da classe exata decorada por `@Component`**, sem misturar classes auxiliares do arquivo.
4. Se o símbolo não está declarado diretamente na classe, gera `event-handler-member-unverified` ou `property-binding-member-unverified`. Isso **não prova erro**: ele pode ser herdado, disponibilizado por contexto de template, ou legitimado por alguma construção que a análise parcial não suporta.
5. Erros retornados pelo parser oficial geram `angular-template-parser-errors-observed`, sem expor a mensagem do parser ou o código HTML. Uma falha de parsing não prova que o template participa de um entrypoint de produção.

O contrato mantém os limites de inventário do SAC-PRE004: 128 arquivos TS, 128 HTML, 512 KiB por arquivo, 2 MiB no conjunto, 512 componentes e 256 achados. O SAC-PRE005 restringe a 64 templates externos parseados, 30 mil nós AST percorridos e possui saída determinística, sem publicar conteúdo do projeto nem nomes dos membros analisados.

A saída tem `rule_id:SAC-PRE005`, `status:unverified`, contadores e apenas códigos fixos de finding, caminhos enumerados e índices de componentes. Ela sempre mantém `complete_template_ast_coverage:false`, `aot_verified:false`, `runtime_verified:false`, `root_cause_verified:false` e `deployment_authorized:false`.

## Regressão controlada com o Angular AOT oficial

O script `scripts/sac_pre005_binding_aot_rehearsal.mjs` compila cinco fixtures sintéticas em diretórios temporários sob `packages/angular-postcompiler/smoke`. Usa `ngc` e TypeScript compatíveis com o lockfile dessa fixture. Só considera uma falha do compilador uma evidência útil quando o **código diagnóstico esperado** está presente.

| Caso | Evidência estática SAC | Resultado do Angular AOT |
| --- | --- | --- |
| Evento e propriedade com declarações locais | Sem suspeita, `unverified` | Passa |
| `(click)="missingMethod()"` sem método local | Handler `unverified` | Falha: TS2339 |
| `[title]="missingTitle"` sem campo local | Property `unverified` | Falha: TS2339 |
| `(click)="save()"` herdado de classe base | Handler `unverified` | Passa |
| `[title]="label +"` malformado | Parser observou erro | Falha: NG5002 / TS-995002 |

O caso de herança documenta intencionalmente um possível **falso positivo de suspeita**, e demonstra por que nunca devemos promover heurísticas de classe local a erro confirmado. A execução de referência foi aprovada: [GitHub Actions 41930047097](https://github.com/Softdown-prog/Data_libray/actions/runs/41930047097), com oito testes de regressão e cinco casos AOT aprovados.

## Snapshot real fixado do Lan House Simulator

O workflow `.github/workflows/sac-pre003-lhs-pinned-aot.yml` reutiliza a revisão imutável `c5139c2cc5088adc3bbf0bf85d2952e64e2fc5ac` do repositório `Softdown-prog/A7-forge-2D-`. `scripts/sac_pre005_lhs_template_bindings.mjs before` executa a inspeção AST **antes** da instalação da toolchain de projeto; `after` confronta a evidência com os dois builds AOT oficiais de `game-ui` e `site-rewrite`, sem modificar fontes versionadas.

| Observação no snapshot | Resultado |
| --- | ---: |
| Arquivos TS no inventário | 45 |
| Arquivos HTML enumerados | 44 |
| Templates externos inspecionados | 43 |
| Templates inline fora do escopo | 2 |
| Eventos observados | 53 |
| Bindings de propriedades observados | 130 |
| Interpolações observadas | 134 |
| Handlers não declarados localmente (somente suspeitas) | 7 |
| Propriedades não declaradas localmente (somente suspeitas) | 0 |
| Erros do parser Angular | 0 |
| Builds AOT oficiais concluídos | 2 de 2 |

Os sete casos são classificados como `event-handler-member-unverified`, **não como erros de compilação**. A AST parcial pode enxergar referências que são válidas por herança, escopo do template ou outros mecanismos Angular. Como os builds oficiais passaram e o parser não encontrou erros, o relatório é `no-proven-syntax-contradiction`, **sem promoção** de `unverified` para `pass`.

Execução real de referência: [GitHub Actions 41930348016](https://github.com/Softdown-prog/Data_libray/actions/runs/41930348016).

## Testes

```bash
npm ci --prefix packages/angular-postcompiler/smoke --ignore-scripts --no-audit --no-fund
node --test tests/sac_angular_template_bindings.test.mjs
node scripts/sac_pre005_binding_aot_rehearsal.mjs
```

Esses testes não comprovam renderização real, acessibilidade, reatividade, navegação, interações Android nem correção de qualquer componente fora do grafo de compilação. Essa responsabilidade continua com o compilador AOT oficial, os testes de browser e o Guardian Chromium. O SAC-PRE005 permanece desacoplado do worker, dos serviços da VPS e do processo de publicação.

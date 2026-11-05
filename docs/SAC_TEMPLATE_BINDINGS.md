# SAC-PRE005 — Observação de bindings e handlers Angular

Esta etapa acrescenta um analisador **opt-in e independente** para expressões de templates Angular. O módulo `packages/angular-precompiler/src/template-binding-evidence.mjs` recebe os mesmos arquivos TypeScript/HTML enumerados que a regra SAC-PRE004, mais instâncias confiáveis do TypeScript e do `@angular/compiler`. A biblioteca não instala pacotes, executa fontes de projeto, dispara builds, acessa rede, importa a aplicação, concede permissão de deploy nem altera o SAC Core ou a VPS.

## O que é realmente inspecionado

1. Reutiliza o SAC-PRE004 para identificar `templateUrl` com link estático a um HTML fornecido explicitamente.
2. Analisa templates HTML externos **e templates inline com `template` literal** usando `@angular/compiler.parseTemplate`, sem executar os bindings. Metadados dinâmicos, spreads e expressões TypeScript não são resolvidos; a inspeção ainda não cobre todos os tipos de nós da AST Angular.
3. Registra contagens de `BoundEvent`, `BoundAttribute` e `BoundText` (interpolações). Para métodos chamados diretamente, como `(click)="save()"`, e leituras diretas, como `[title]="label"`, compara o símbolo com os membros **da classe exata decorada por `@Component`**, sem misturar classes auxiliares do arquivo.
4. Antes de sinalizar um símbolo como não encontrado, reconhece membros públicos/protegidos de classes-base declaradas **no mesmo arquivo TS** (até oito níveis, sem avaliação de código) e algumas variáveis locais com escopo lexical de `@for`, `@if (...; as x)`, `<ng-template let-x>` e `@let`. As categorias observadas são contabilizadas separadamente. Bases importadas, mixins, referências de template complexas e ASTs não percorridas permanecem não verificadas. Quando ainda não encontra o símbolo, usa `event-handler-member-unverified` ou `property-binding-member-unverified`, nunca um erro confirmado.
5. Erros retornados pelo parser oficial geram `angular-template-parser-errors-observed`, sem expor a mensagem do parser ou o código HTML. Uma falha de parsing não prova que o template participa de um entrypoint de produção.

O contrato mantém os limites de inventário do SAC-PRE004: 128 arquivos TS, 128 HTML, 512 KiB por arquivo, 2 MiB no conjunto, 512 componentes e 256 achados. O SAC-PRE005 restringe a 64 templates externos e inline parseados no total, 30 mil nós AST percorridos e possui saída determinística, sem publicar conteúdo do projeto nem nomes dos membros analisados.

A saída tem `rule_id:SAC-PRE005`, `status:unverified`, contadores e apenas códigos fixos de finding, caminhos enumerados e índices de componentes. Ela sempre mantém `complete_template_ast_coverage:false`, `aot_verified:false`, `runtime_verified:false`, `root_cause_verified:false` e `deployment_authorized:false`.

## Regressão controlada com o Angular AOT oficial

O script `scripts/sac_pre005_binding_aot_rehearsal.mjs` compila dezessete fixtures sintéticas em diretórios temporários sob `packages/angular-postcompiler/smoke`. Usa `ngc` e TypeScript compatíveis com o lockfile dessa fixture. Só considera uma falha do compilador uma evidência útil quando o **código diagnóstico esperado** está presente.

| Caso | Evidência estática SAC | Resultado do Angular AOT |
| --- | --- | --- |
| Evento e propriedade com declarações locais | Sem suspeita, `unverified` | Passa |
| `(click)="missingMethod()"` sem método local | Handler `unverified` | Falha: TS2339 |
| `[title]="missingTitle"` sem campo local | Property `unverified` | Falha: TS2339 |
| `(click)="save()"` herdado de classe base no mesmo arquivo | Ancestral local observado, `unverified` | Passa |
| `[title]="label +"` malformado | Parser observou erro | Falha: NG5002 / TS-995002 |
| `@for` com `[title]="item"` | Variável lexical observada, `unverified` | Passa |
| `@let action = save;` com `(click)="action()"` | Chamada lexical observada, `unverified` | Passa |
| Referência ao `item` **fora** de `@for` | Binding suspeito, `unverified` | Falha: TS2551/TS2339 |

As quatro fixtures adicionais para esta microetapa comparam o suporte a templates inline:

| Template inline com evento/binding declarados | Inline parseado, `unverified` | Passa |
| Template inline com handler inexistente | Handler suspeito, `unverified` | Falha: TS2339 |
| Template inline com expressão malformada | Erro do parser observado | Falha: NG5002 / TS-995002 |
| `template: SHARED` com constante válida | Inline dinâmico não analisado, `unverified` | Passa |

O caso de herança explicita como uma referência inicialmente suspeita pode ser validada por uma declaração em classe-base do mesmo arquivo; o caso de variável fora do `@for` prova que o escopo não vaza para elementos irmãos. Isso não valida herança entre arquivos nem todos os escopos do Angular. Execução de referência: [GitHub Actions 41941954990](https://github.com/Softdown-prog/Data_libray/actions/runs/41941954990), com 27 testes de regressão e 17 fixtures AOT aprovadas após acrescentar leituras de interpolação simples: [execução 41959060983](https://github.com/Softdown-prog/Data_libray/actions/runs/41959060983).

## Snapshot real fixado do Lan House Simulator

O workflow `.github/workflows/sac-pre003-lhs-pinned-aot.yml` reutiliza a revisão imutável `c5139c2cc5088adc3bbf0bf85d2952e64e2fc5ac` do repositório `Softdown-prog/A7-forge-2D-`. `scripts/sac_pre005_lhs_template_bindings.mjs before` executa a inspeção AST **antes** da instalação da toolchain de projeto; `after` confronta a evidência com os dois builds AOT oficiais de `game-ui` e `site-rewrite`, sem modificar fontes versionadas.

| Observação no snapshot | Resultado |
| --- | ---: |
| Arquivos TS no inventário | 45 |
| Arquivos HTML enumerados | 44 |
| Templates externos inspecionados | 43 |
| Templates inline literais parseados (nova microetapa) | 2 |
| Eventos observados | 56 |
| Bindings de propriedades observados | 137 |
| Interpolações observadas (nós de texto vinculados) | 141 |
| Leituras simples de interpolação analisadas | 16 |
| Leituras de variáveis locais em interpolação | 2 |
| Leituras de classe-base local em interpolação | 0 |
| Suspeitas de membros ausentes nessas interpolações | 0 |
| Chamadas de handlers herdados de classe-base no mesmo arquivo | 7 |
| Handlers ainda sem correspondência (somente suspeitas) | 0 |
| Variáveis locais observadas em eventos / propriedades | 0 / 1 |
| Propriedades não declaradas localmente (somente suspeitas) | 0 |
| Erros do parser Angular | 0 |
| Builds AOT oficiais concluídos | 2 de 2 |

Na medição anterior, as sete chamadas foram sinalizadas como `event-handler-member-unverified`. Após a verificação sintática limitada de classes-base **no mesmo arquivo**, todas as sete foram reclassificadas como referências herdadas observadas; restaram **zero** alertas dessa categoria. Com a leitura dos templates inline foi observada uma leitura adicional de variável local em binding, sem nova suspeita. A compilação AOT real de jogo e site continuou aprovada. Na nova microetapa, os dois templates inline também entram na observação estática. Em ambos os momentos a análise permanece `unverified`, sem atestar runtime, templates fora dos dois grafos nem aptidão para deploy.

Execução real com a extensão de interpolações: [GitHub Actions 41959125425](https://github.com/Softdown-prog/Data_libray/actions/runs/41959125425).

## Testes

```bash
npm ci --prefix packages/angular-postcompiler/smoke --ignore-scripts --no-audit --no-fund
node --test tests/sac_angular_template_bindings.test.mjs
node scripts/sac_pre005_binding_aot_rehearsal.mjs
```

Esses testes não comprovam renderização real, acessibilidade, reatividade, navegação, interações Android nem correção de qualquer componente fora do grafo de compilação. Essa responsabilidade continua com o compilador AOT oficial, os testes de browser e o Guardian Chromium. O SAC-PRE005 permanece desacoplado do worker, dos serviços da VPS e do processo de publicação.

### Contrato da extensão inline

O SAC-PRE005 lê somente `@Component({template:'...'})` ou literals TypeScript sem substituições, após identificar `@Component` realmente importado de `@angular/core`. Liga cada fragmento à classe decorada e compara seus membros, com as mesmas regras conservadoras de herança/escopo aplicadas ao HTML externo. A extensão não resolve `template: VARIABLE`, chamadas, interpolação dinâmica TypeScript, spreads ou metadados ambíguos. O conteúdo inline é passado apenas ao parser Angular confiável; **o relatório não publica HTML, texto inline nem identificadores de métodos**.

O relatório passa a incluir `inline_templates_parsed`, `templates_total_parsed` e `inline_templates_not_inspected`. Todos os campos de aprovação do compilador, runtime e deploy continuam falsos. O novo limite global de 64 templates considera a soma de externos e inline. A checagem com AOT real permanece independente.

### Microetapa: leituras diretas em interpolações Angular

Dentro dos templates externos e inline já enumerados, a regra examina **apenas** expressões diretas do tipo \`{{ field }}\`, reconhecidas como \`PropertyRead\` de \`ImplicitReceiver\` na AST oficial do Angular. Cada expressão simples é contada individualmente, ainda que várias apareçam num mesmo nó de texto. A análise consulta os membros declarados, a herança sintática no mesmo arquivo e o escopo lexical de \`@for\`, \`@if (...; as ...)\` e \`@let\`. Referências ausentes recebem \`interpolation-member-unverified\` apenas **uma vez por componente**; a ausência não é um erro comprovado.

O relatório adiciona \`simple_interpolation_reads_observed\`, \`template_local_interpolation_reads_observed\`, \`same_file_inherited_interpolation_reads_observed\` e \`potential_interpolation_members_not_declared_locally\`. Nenhum identificador ou trecho do HTML é emitido.

Essa observação não tenta resolver \`{{ object.name }}\`, pipes, chamadas de métodos, acesso opcional e expressões compostas. Elas ficam fora do escopo, não são falsamente consideradas válidas ou inválidas. O analisador não executa Angular nem substitui a verificação AOT de templates ou os testes do Guardian no Chromium.

| Fixture oficial de regressão | Evidência SAC | Angular AOT |
| --- | --- | --- |
| \`{{ label }}\` declarada na classe | Leitura observada, sem suspeita | Passa |
| \`{{ missingField }}\` sem campo na classe | \`interpolation-member-unverified\` | Falha: TS2339/TS2551 |
| \`{{ label }}\` herdada da classe-base no mesmo arquivo | Herança sintática observada | Passa |
| \`{{ item }}\` dentro de \`@for\` | Local do template observada | Passa |
| \`{{ item }}\` fora do \`@for\` | Suspeita lexical | Falha: TS2339/TS2551 |

Snapshot LHS imutável: dos **141 nós com interpolação**, apenas **16 leituras simples** se enquadram no novo contrato, com **duas locais**, nenhuma suspeita e nenhum erro do parser. Ambos os builds AOT oficiais continuaram aprovados. Isso não constitui cobertura completa dos 141 nós, nem certificação de runtime ou autorização de deploy.

## Preflight do Worker: preservação da fase reprovada

A execução supervisionada em modo `--enable-build` agora diferencia as três
situações devolvidas por `prepareBuild()`: `fail`, `unverified` e
`infra-error`. Antes, a ausência de sessão aprovada era sempre convertida em
`audit-infrastructure-error`, inclusive quando o pré-compilador encontrava
incompatibilidade de dependências Angular/TypeScript.

- `preflight-failed`: reprovação comprovada do pré-compilador, com os
  códigos das evidências estáticas que passaram pela lista de identificadores
  seguros do relatório v1.
- `preflight-unverified`: pré-compilador não conseguiu comprovar aprovação;
  o código-fonte não é tratado como incorreto por inferência.
- `preflight-infra-error`: erro efetivo da infraestrutura observada na
  etapa de preflight.
- `build-prerequisites-unverified`: pré-compilação aprovada, mas a preparação
  seguinte, incluindo snapshot de fontes, não obteve comprovação suficiente.
- `build-prerequisites-failed`: o snapshot de fontes foi explicitamente
  reprovado (por exemplo, seleção insegura de arquivos), **após o preflight passar**.
- `build-prerequisites-infra-error`: o snapshot falhou por infraestrutura,
  sem atribuir o problema ao código Angular.

A rotina `prepareBuild()` preserva agora `phases.pre=pass` quando uma
reprovação ocorre somente na leitura posterior do snapshot. O motivo observado
fica em `phases.build` do relatório interno, mas o **Worker v1** apresenta
`checks.build=unverified`, porque a compilação Angular não chegou a ocorrer.

Em todas as situações, build e pós-compilação aparecem como `unverified`
no contrato **v1 histórico** do Worker, e o Guardian também fica `unverified`.
Isso significa *não executado/não comprovado*, jamais sucesso. Os códigos
`not-executed` são usados nas fases bloqueadas. `static_pipeline_pass`,
`browser_pass` e `deployment_authorized` permanecem `false`.

O módulo determinístico `scripts/sac_preflight_result.mjs` não aceita
sucesso falso nem status incompatível entre a fase e o relatório. Ele
aproveita apenas o formatador seguro `sac_diagnostic_report.mjs`: nenhum
texto arbitrário de mensagem, caminho, segredo ou fonte é copiado.
Um caso com `angular_version` divergente da versão realmente instalada
é executado na fixture oficial do Angular (sem iniciar Docker para a reprovação).

O validador Python do Worker também rejeita relatórios cujo código de
preflight contradiga o estado das etapas, como `preflight-failed` com
`pre:pass`, status `pass`, browser aprovado ou `technical_report` de build.

Mantém-se o `schema_version:1` do resultado do Worker, compatível com o
consumidor atual do Painel. Nenhum deploy, merge automático, acesso à VPS
ou ativação de `sac_submit` faz parte desta alteração.

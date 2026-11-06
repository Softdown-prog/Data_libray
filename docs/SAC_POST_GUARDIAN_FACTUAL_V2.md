# SAC-041 — evidência factual v2 de pós-compilador e Guardian

Microetapa isolada da issue #41. O relatório histórico do One Worker (`schema_version:1`)
continua inalterado. O novo `scripts/sac_phase_evidence_v2.mjs` produz **somente**
uma ficha técnica paralela para falhas pós-compilador (`post`) ou Guardian
(`browser`), a partir de um resultado `verifyPipelineBrowserSandbox`
já avaliado pelo host confiável.

Para iniciar a ficha, o formatador exige `source_sha_claim` e `profile_id`
iguais aos dados do job, build autenticado com `artifact_digest`, preflight
aprovado, falha na fase seguinte e `deployment_authorized=false`.
Execução do Chromium só é afirmada quando existe binding do job/artefato e
`docker-network-none`. O formatador **não autentica** o recibo por conta própria;
ele precisa receber o relatório do pipeline verificado.

A ficha guarda `pre/build/post/browser`, fase observada, status,
`executed`, `blocked_by`, eventos de código fixo e ID de cenário verificado.
Pós-compilador reprovado implica Guardian `not-run`; não se confunde
não execução com falha de navegador. Sem evidência real de caminho/linha:
`location_verified=false`. Nunca contém mensagens livres, `next_step`,
hipóteses, código-fonte, logs, chaves ou autorização de deploy.

O texto pt-BR é projeção determinística do JSON e é revalidado contra o
objeto de entrada, com máximo de 8 achados e 4 KiB. Testes sintéticos
abrangem sucesso falso, dados adulterados, vínculo do sandbox, identificadores
inseguros e fases não executadas. O fluxo Angular AOT + Docker em CI gera
somente **artefatos sintéticos** de testes de falha de pós e browser.

**Fora deste escopo:** integração do resultado v2 ao Worker/Painel ou VPS,
ativação de `sac_submit`, inferência de causa e alteração automática de código.

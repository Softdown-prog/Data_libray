# SAC-007 — Protocolo offline para supervisor multiprojetos

O adaptador `scripts/sac_worker_bridge.py` prepara a futura ligação dos relatórios do SAC ao One Worker. **Não foi conectado ao daemon atual** (`scripts/vps_daemon.py`) e **não roda na VPS**. Não executa Angular, navegador, shell, rede nem comandos de projeto. Aceita somente dados serializáveis e estritamente versionados de projetos já aprovados pelo operador.

## Responsabilidades separadas

- **CI confiável**: executa Angular oficial, SAC-004 e SAC-005 (preferencialmente em sandbox SAC-006), inspeciona o relatório completo, e produz um resumo de evidência v1. O CI guarda a chave efêmera de HMAC fora de contratos, dist e workspace não confiáveis.
- **Biblioteca/SAC**: produz relatórios de estado estático e browser com `source_sha_claim`, `profile_digest`, `artifact_digest` e `guardian_digest`. Um resultado do Guardian não é prova independente do Git nem de publicação.
- **Bridge offline**: autentica e correlaciona um envelope assinado ao job previamente admitido pelo supervisor. Não confia em `static_pipeline_pass` ou `browser_pass` sem assinatura válida e binding idêntico. A chave HMAC nunca entra no envelope.
- **One Worker futuro**: selecionará projetos permitidos, criará jobs e armazenará o retorno. O daemon existente segue processando exclusivamente catálogo local, sem mudança de comportamento neste marco.

## Contrato v1

Política confiável, mantida pelo supervisor, não pela aplicação avaliada:

```json
{"schema_version":1,"projects":[
 {"project_id":"sample-a","profile_id":"angular-root","browser_required":true},
 {"project_id":"sample-b","profile_id":"angular-subpath","browser_required":true}
]}
```

Job escolhido pelo supervisor:

```json
{"schema_version":1,"project_id":"sample-a","profile_id":"angular-root",
 "source_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
 "profile_digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
 "artifact_digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
 "guardian_digest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}
```

Resumo de evidência que o **CI confiável deve derivar** do relatório SAC (não receber pronto da app):

```json
{"schema_version":1,"status":"pass","static_pipeline_pass":true,
 "browser_pass":true,"deployment_authorized":false,
 "binding":{"source_sha_claim":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "profile_digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "artifact_digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "guardian_digest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"},
 "browser":{"status":"pass","executed":true}}
```

Somente um CI autorizado chama `sign_submission(task, evidence, key)`. A assinatura usa HMAC-SHA256 de `softdown-sac-worker-bridge-v1\\0` + JSON canônico de schema/task/evidence. `verify_submission(policy, task, envelope, key)` exige assinatura constante-tempo, identidade completa, allowlist e consistência das fases. Resultado sempre inclui `deployment_authorized:false`. `verified` significa que o CI autenticado *declarou* que o SAC estático e o Guardian passaram; **não** aprova deploy nem prova que o CI executou o processo correto se o próprio CI estiver comprometido.

### Uso local em modo importador

```bash
python scripts/sac_worker_bridge.py --policy approved-projects.json \
  --task host-job.json --submission ci-signed-envelope.json \
  --trust-key /trusted/ci-hmac.key --state-dir /trusted/state
```

`--state-dir` é opcional. Registros são gravados atomicamente e resultados repetidos idênticos são idempotentes; o mesmo job com outro veredito é rejeitado. **O host deve garantir um único escritor por diretório** (por exemplo, lock exclusivo do supervisor); a versão offline não possui lock multiprocesso. A ferramenta não cria contas, executa código nem recebe shell de JSON.

### Limites

O HMAC só autentica a declaração de quem possui a chave. Não comprova a origem Git, inventário completo, isolamento Docker, publicação ou identidade do servidor. Compartilhar chave com projetos avaliados anula a confiança. SHA no contrato pode ser alegação; a verificação independente de Git, provenance, assinatura por job e ingestão de artefatos de GitHub Actions ainda são pendências para a integração futura ao One Worker. O adaptador não acessa rede e não altera a VPS.

Teste sintético: `python -m unittest discover -s tests -p 'test_sac_worker_bridge.py' -v`.

# SAC-008B — fila multiprojetos via GitHub Actions (recebimento, sem execução)

Esta etapa acrescenta ao **One Worker existente** um inbox durável de solicitações de validação Angular e um ack seguro. **Não confundir o ack com compilação.** `status:received`, `execution:disabled` e `deployment_authorized:false` são sempre emitidos, mesmo em teste bem-sucedido.

Contrato v1 de requisição (somente host/broker autorizado deve publicar):
```json
{"schema_version":1,"job_id":"gha-123456789-1","project_id":"generic-one",
"profile_id":"angular-root","source_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
"kind":"angular-validate"}
```

- `job_id` deriva de `GITHUB_RUN_ID` e `GITHUB_RUN_ATTEMPT` autenticados por OIDC. Nunca aceitar path, cmd, image, URL, branch ou script do solicitante.
- Projeto/perfil vêm de allowlist do operador, externa ao checkout de aplicativos. Não existe projeto habilitado por padrão.
- O broker instalado (no repositório `Painel`) é responsável por escrever o pedido atomizado em `/var/lib/data-library-worker/state/sac-inbox/<job-id>.json`. Operação autenticada por SSH/OIDC; sem endpoint HTTP e sem executar subprocessos de conteúdo da issue.
- No One Worker, `--sac-inbox` é **opt-in e fica desativado por padrão**. Ele lê o allowlist do operador (`/etc/data-library-worker/sac-projects.json`), valida novamente o pedido e registra um recibo em `state/sac-jobs/<job-id>.json`. Um processo só (lock do daemon) mantém o consumidor serial. Não modifica o comportamento da fila do catálogo existente.
- Não faz `git clone`, `npm install`, `ng build`, navegação externa ou qualquer execução de source externo. A próxima camada é um runner sandboxed que pega a revisão autorizada e executa o SAC/Guardian com limites de recursos; até lá o pedido está recebido mas não executado.
- **A instalação na VPS deve ser revisada manualmente.** A unidade atual `data-library-worker.service` não é alterada nem reiniciada. O operador deverá preparar diretório, permissões e política idêntica dos dois lados, revisar user/group e habilitar `--sac-inbox` separadamente.
- A configuração do broker `vpsops` está em outro repositório. O PR deste módulo não configura nem instala a outra metade.
- Sem merge, deploy ou VPS nesta fase. Testes rodam apenas GitHub Actions sobre diretórios temporários.

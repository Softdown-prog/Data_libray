# SAC-008F — serviço Angular rootless separado (código e testes offline)

Esta branch adiciona um protótipo de executor **distinto** da Data Library:
`scripts/sac_dedicated_runner.py` + `scripts/sac_rootless_runtime.py`. A unidade em
`deploy/sac/sac-builder.service.template` é **apenas um modelo não instalável**:
não possui seção `[Install]`, inclui o token `@SAC_BUILDER_UID@` e nenhum
instalador ou workflow de deploy foi criado.

### Controles

- O serviço `data-library-worker.service` permanece completamente **inalterado**
  e não recebe Docker, flags SAC, sudo ou permissões extras.
- O executor proposto usa `sac-builder` com grupo privado e socket
  `/run/user/<uid>/docker.sock` de propriedade do usuário, testado via
  `docker --host unix:///run/user/<uid>/docker.sock info --format ...`. O
  `SecurityOptions` precisa anunciar `name=rootless` antes de qualquer execução.
- `DOCKER_HOST` só é passado pelo supervisor após o gate rootless. Node, builder
  Angular e Guardian preservam **somente** esse endpoint validado; nenhuma variável
  arbitrária de Docker herdada do usuário pode mudar o destino.
- Serviço separado usa a **própria** fila
  `/var/lib/sac-builder/state/sac-inbox` e relatórios
  `/var/lib/sac-builder/state/sac-results`. Execução serial sob lock, limitada
  a um trabalho/rodada; apenas manifests e allowlists **root-owned** podem
  aprovar projeto e executor. `deployment_authorized=false`.
- O comando `--execute` é opt-in; sem ele a CLI apenas diagnostica o Docker
  do usuário local. O modelo systemd é one-shot para não iniciar processos
  permanentes na VPS sem aprovação.

### Pendências bloqueantes (não implementar automaticamente)

**Ainda não existe o transporte em produção** do broker `vpsops` para a fila
separada do `sac-builder`. O Painel PR #74 grava no diretório antigo
`/var/lib/data-library-worker/state` e **não deve ser habilitado** para
execução rootless até uma alteração conjunta de contrato/caminho revisada,
com permissões de escrita restritas e sem compartilhar grupos/segredos.

A preparação do checkout Angular por SHA e `node_modules` acontece por enquanto
apenas nos runners descartáveis do Actions. Não se deve ligar a VPS a
`npm install`, `git clone` de fontes não aprovadas, nem à socket do Docker
rootful. O executor rootless só aceita workspaces e manifests preparados
independentemente pelo operador; **não é ainda produção homologada**.

Os testes automatizados demonstram o controle do destino Docker e a
rejeição de identidades/sockets inseguros com dados simulados. Não são
evidência do estado real da VPS. Para homologar, usar primeiro um
workflow diagnóstico read-only autorizado via GitHub Actions/SSH OIDC e
avaliar capacidade real de CPU, RAM, disco, sem iniciar containers.
Só com aprovação explícita serão feitos provisionamento, instalação,
ajustes de broker ou alterações no `systemd`.

# Data Library: supervisor autônomo 24/7 na VPS

**Sem depender do GitHub Actions para iniciar ou manter testes.** A VPS executa um serviço systemd. O GitHub mantém o código, mas não controla a fila. Não instale o runner da captura: é outro modelo, dependente de Actions; revogue qualquer token que apareceu em imagens compartilhadas.

## Funcionamento

1. O Ubuntu inicia `scripts/vps_daemon.py` no boot, com usuário exclusivo `data-library`.
2. O supervisor consulta o catálogo do checkout local a cada minuto, sem consultar rede ou GitHub.
3. Ao detectar nova revisão local ou a revalidação diária, processa os IDs catalogados pelo `scripts/batch_worker.py`, um por vez, até o limite configurado.
4. Os resultados são gravados em JSONL e sincronizados com o disco após cada item; falha de teste não interrompe os outros.
5. Uma trava impede duas instâncias. O checkpoint permite retomar após reinícios, e o systemd reinicia o processo caso caia.
6. Ao terminar, o serviço permanece ativo aguardando próxima revisão ou nova execução diária.

A fila suporta até 1.000 IDs existentes, mas hoje há apenas 21. Não cria códigos, não corrige erros e não promove exemplos legados sozinho.

## Instalação única na VPS

Use o Shell administrativo do painel da VPS. Este instalador **não toca em Docker, PostgreSQL, outros serviços, tokens ou senhas**. Cria apenas usuário `data-library`, a pasta `/var/lib/data-library-worker` e uma unidade de serviço.

Pré-requisitos no host: git, Python 3.12+, curl, tar/xz, Go 1.23+, G++ C++20, Rust/Cargo e Java 21. No Ubuntu 24.04, execute `sudo apt-get update` e `sudo apt-get install -y --no-install-recommends g++ rustc cargo openjdk-21-jdk-headless golang-1.24-go` para instalar os quatro toolchains ausentes; o Go versionado é encontrado em `/usr/lib/go-1.24/bin` sem alterar os outros Go instalados. **Node.js 24.22.2 e npm são baixados para `/var/lib/data-library-worker/tools/node`**, com SHA-256 validado contra o manifesto oficial do Node.js; nenhum pacote global de Node é substituído. O instalador informa de uma vez os demais compiladores ausentes. Dependências Angular e TypeScript são instaladas somente na pasta do projeto, com `--ignore-scripts`. O catálogo ignora `angular/node_modules`, `.angular`, `dist` e outros diretórios gerados na varredura de código próprio, mas continua rejeitando arquivos de fonte não catalogados.

```bash
cd /tmp/data-library-setup
git pull --ff-only
sudo bash deploy/install-vps-worker.sh
```

Se uma tentativa anterior parou com `fatal: detected dubious ownership`, atualize o instalador e execute novamente: o checkout já clonado será consultado pelo próprio usuário `data-library`, sem desabilitar a proteção `safe.directory` do Git.

A instalação é idempotente para um Node local completo e da mesma versão. Se o servidor não conseguir acessar `nodejs.org`, o instalador para sem substituir binários globais; verifique conectividade HTTPS antes de tentar novamente.

O serviço estabelece limite de **1 vCPU, 1,5 GB RAM, 128 tarefas**, usuário não administrador, escrita apenas nos dados do próprio worker. Como a VPS é multiprojetos, ajuste quotas somente após medir o consumo real.

## Verificar status e relatórios

```bash
sudo systemctl status data-library-worker --no-pager
sudo journalctl -u data-library-worker -n 80 --no-pager
sudo cat /var/lib/data-library-worker/state/checkpoint.json
sudo find /var/lib/data-library-worker/state/runs -name summary.json -print
```

Arquivos de cada lote: `queue.json`, `results.jsonl`, `summary.json`. Logs via journald. Nenhuma porta HTTP é exposta.

## Atualizar para um novo commit aprovado

O supervisor **não faz git pull automático**; por segurança, mudanças remotas não viram código executável silenciosamente. Depois de revisar uma nova versão:

```bash
sudo systemctl stop data-library-worker
sudo runuser -u data-library -- git -C /var/lib/data-library-worker/repo pull --ff-only
sudo systemctl start data-library-worker
```

Uma revisão nova cria outro lote, preservando o histórico dos anteriores. Uma execução interrompida pode repetir o teste que estava ativo no instante da queda.

## Limitações

- O loop é independente de GitHub-hosted runners e do estado dos workflows GitHub; ainda precisa dos compiladores locais instalados.
- Um item sem teste de comportamento permanece `compile-only`; `pass` não significa ausência total de erros.
- A unidade aplica limites e privilégios restritos, mas não é uma sandbox completa contra código malicioso. Não execute contribuições não revisadas diretamente no host.
- O primeiro start real precisa ocorrer na VPS: publicar um commit não significa instalar um serviço no Ubuntu.

## Testes Angular sem navegador

Os três IDs Angular inicialmente disponíveis possuem testes de comportamento em `tests/angular_behavior.test.mjs`. O worker compila uma saída isolada com `angular/tsconfig.behavior.json` e executa o caso associado a cada ID. O relatório `pass` demonstra apenas o comportamento verificado por signals, URL ou HTTP simulado; não comprova o DOM ou integração com backend real. O serviço precisa receber o novo commit por atualização autorizada do checkout, não automática.

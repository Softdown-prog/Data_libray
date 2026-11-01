# Worker de validação — GitHub Actions + VPS multiprojetos

## Objetivo

Executar lotes de até 1.000 **itens existentes no catálogo** sem depender de mensagens repetidas no ChatGPT. A execução é **sequencial**, com resultado JSON após cada item. A regra operacional continua priorizando qualidade: atualmente há 21 exemplos; pedir 1.000 não fabrica 1.000 exemplos e a fila termina quando todos os selecionados forem avaliados.

## Fluxo

1. GitHub Actions recebe solicitação manual via `.github/workflows/worker-vps.yml` na branch main.
2. Um runner **dedicado**, isolado dos demais projetos da VPS, recebe o job usando label `data-library-worker`.
3. `scripts/batch_worker.py` lê `catalog.json`, filtra exemplos por status/linguagem e grava `queue.json`.
4. Para cada item, usa parsers nativos existentes em `scripts/parser_audit.py`; no modo `both` executa o teste apropriado da linguagem, se disponível.
5. Cada resultado é acrescentado imediatamente a `results.jsonl` com `pass`, `fail` ou `compile-only`. Uma falha não impede o próximo item.
6. `summary.json` agrega números, estado da fila e origem do commit. O Actions publica os três arquivos como artefato mesmo após falhas.

Os comandos são montados pelo worker a partir da linguagem e dos paths presentes no catálogo. **O JSON não recebe comandos shell.** O worker não atualiza `main`, não reescreve código, não promove legados a v2 e não acessa serviços de outros projetos.

## Preparação segura da VPS

- Configure um usuário Linux **sem privilégios administrativos** e um runner GitHub Actions self-hosted **exclusivo para este repositório** (na interface do repositório: Settings > Actions > Runners > New self-hosted runner).
- No registro do runner, inclua a label `data-library-worker` junto às labels automáticas `self-hosted,linux,x64`. Não reutilize o runner administrativo da VPS.
- Isole a execução em contêiner ou VM sem `/var/run/docker.sock`, sem acesso a credenciais, SSH ou volumes dos demais projetos. Use limites de CPU, RAM, disco e permissões de filesystem.
- Disponibilize Python 3.12+, Node 24, TypeScript 6, Go 1.23+, Rust/Cargo estáveis, G++ C++20 e Java 21 conforme as linguagens selecionadas. Angular exige dependências `npm install --prefix angular --no-audit --no-fund` em preparação isolada; futuramente usar lockfile e `npm ci`.
- **Não configure ações disparadas por PR de terceiros neste runner.** O workflow é manual, autorizado apenas na main. O checkout não persiste credenciais.
- Não existe serviço escutando uma porta externa para o worker: a conexão é de saída do próprio GitHub Actions runner.

A VPS não está automaticamente configurada ao publicar estes arquivos. Sem runner com a label correta, a execução de workflow **ficará em fila**, sem efetuar testes.

## Execução

Acesse **Actions > Data Library - worker de validação VPS > Run workflow**, selecione `main` e os filtros. Para a fase atual, comece com `status=legacy_pending_review`, `max_items=15`, `mode=both`. O script só processa exemplos que existirem no catálogo.

Localmente, no diretório do repositório:

```bash
python3 scripts/batch_worker.py --status all --language python --max-items 3 --mode both --output /tmp/dl-worker-demo
python3 scripts/batch_worker.py --status all --language python --max-items 3 --mode both --output /tmp/dl-worker-demo --resume
```

`--resume` exige o mesmo commit, filtros e fila, e evita repetir itens já concluídos **quando os arquivos de resultado ainda estiverem presentes**. Para retomar a partir de outro job/runner, é necessário restaurar `queue.json` e `results.jsonl` do artefato anterior no diretório de saída. Não há reexecução autônoma de workflows nem agendamento recorrente nesta primeira versão.

## Estrutura do resultado

```json
{
  "example_id": "python.security.safe-filename",
  "language": "python",
  "catalog_status": "documented",
  "status": "pass",
  "phases": [
    {"phase": "parser", "status": "pass", "tool": "ast.parse"},
    {"phase": "test", "status": "pass"}
  ],
  "elapsed_seconds": 0.1
}
```

Em caso de erro, veja `::error` no Actions Logs, o texto limitado do diagnóstico em JSONL e o sumário. `compile-only` significa que não há teste de comportamento demonstrado. Os tempos e estados acima são **exemplo ilustrativo**, não resultados de VPS.

## Limitações

- Um job GitHub Actions tem tempo finito. Uma fila de 1.000 testes demorados pode exceder o limite; divida em lotes de 15 a 50 e retome com controle explícito.
- Alguns parsers são globais por workspace (Angular, TypeScript e Rust), podendo repetir verificações para vários exemplos; otimização com cache por commit/language é uma evolução futura.
- O código dos testes é executado no runner quando o modo `both` está ativo. Por isso o isolamento do runner da VPS é indispensável mesmo sem aceitar comandos arbitrários no JSON.
- Não são feitas correções automáticas por IA, merges ou commits. A validação detecta resultados; promoção de qualidade exige revisão humana.

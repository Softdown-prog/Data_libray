# Ferramentas internas — inventário de código de infraestrutura

Além dos exemplos indexados, o repositório contém ferramentas operacionais próprias, que **não contam como exemplos do dataset**:

| Arquivo | Responsabilidade | Quando usar | Falhas e correções |
| --- | --- | --- | --- |
| `scripts/batch_worker.py` | Montar tarefas a partir do catálogo, executar verificações sequenciais e registrar JSONL com retomada | Serviço VPS (e smoke test de CI) | Falha do item não interrompe o lote; consultar results.jsonl e summary.json |
| `tests/test_batch_worker.py` | Validar fila, limites, prevenção de comandos JSON arbitrários e retomada | CI catalog | Regressão bloqueia a publicação |
| `scripts/vps_daemon.py` | Supervisão local contínua, checkpoints, retomada e revalidação periódica | Serviço da VPS | Ver journalctl e checkpoint |
| `tests/test_vps_daemon.py` | Testar revalidação e retomada sem Actions | CI catalog | Regressões devem bloquear publicação |
| `deploy/install-vps-worker.sh` | Instalação restrita à pasta/serviço Data Library | Shell administrativo uma vez | Preflight de ferramentas e status systemd |
| `deploy/systemd/data-library-worker.service` | Inicialização automática com limites de recursos | Ubuntu systemd | systemctl status e journalctl |
| `scripts/parser_audit.py` | Executar parsers nativos sem rodar os exemplos, anotando falhas no Actions e oferecendo JSON opcional | Primeiro estágio de cada job de linguagem | Sintaxe: abrir anotação; ferramenta ausente: conferir setup do job |
| `tests/test_parser_audit.py` | Validar seleção dos oito parsers e AST Python sem execução | CI catalog | Falha indica regressão no orquestrador |
| `scripts/catalog.py` | Validar o contrato, inventários e hashes dos legados; regenerar catálogo | Toda alteração de exemplo ou documentação | Índice divergente: executar `--write`; exemplo rejeitado: corrigir campos ou migrar legado |
| `scripts/search.py` | Pesquisar IDs, tags, contexto e diagnóstico no JSON | Durante implementação ou investigação | Sem resultados: reduzir termos/filtrar linguagem |
| `scripts/run_python_tests.py` | Executar cada teste Python em isolamento de diretório | CI Python | Falha de import: manter teste ao lado da implementação |
| `.github/workflows/validate-library.yml` | Coordenar nove jobs independentes de CI | Cada commit | Inspecionar job falho e corrigir antes de publicar outra entrada |
| `tests/test_catalog_contract.py` | Verificar que o contrato rejeita campos ausentes e código não declarado | Toda mudança do validador | Falha significa possível regressão de catalogação |

Dependências externas (Angular/TypeScript/Ruff etc.) são usadas apenas nas validações e exemplos que as declaram. Ferramentas internas devem ter documentação própria e não ser confundidas com snippets públicos.

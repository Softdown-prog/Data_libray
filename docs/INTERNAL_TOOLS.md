# Ferramentas internas — inventário de código de infraestrutura

Além dos exemplos indexados, o repositório contém ferramentas operacionais próprias, que **não contam como exemplos do dataset**:

| Arquivo | Responsabilidade | Quando usar | Falhas e correções |
| --- | --- | --- | --- |
| `scripts/catalog.py` | Validar o contrato, inventários e hashes dos legados; regenerar catálogo | Toda alteração de exemplo ou documentação | Índice divergente: executar `--write`; exemplo rejeitado: corrigir campos ou migrar legado |
| `scripts/search.py` | Pesquisar IDs, tags, contexto e diagnóstico no JSON | Durante implementação ou investigação | Sem resultados: reduzir termos/filtrar linguagem |
| `scripts/run_python_tests.py` | Executar cada teste Python em isolamento de diretório | CI Python | Falha de import: manter teste ao lado da implementação |
| `.github/workflows/validate-library.yml` | Coordenar nove jobs independentes de CI | Cada commit | Inspecionar job falho e corrigir antes de publicar outra entrada |
| `tests/test_catalog_contract.py` | Verificar que o contrato rejeita campos ausentes e código não declarado | Toda mudança do validador | Falha significa possível regressão de catalogação |

Dependências externas (Angular/TypeScript/Ruff etc.) são usadas apenas nas validações e exemplos que as declaram. Ferramentas internas devem ter documentação própria e não ser confundidas com snippets públicos.

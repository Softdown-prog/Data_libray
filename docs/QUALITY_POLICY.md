# Política de qualidade

Critérios mínimos para cada entrada — conforme [contrato v2](DATASET_SCHEMA.md):

- Metadados v2, ID único, manifesto de todos os arquivos, README completo e cabeçalho explicativo no código.
- Código original, reproduzível, com versão e dependências documentadas.
- Compilação/typecheck quando possível; lint; testes automatizados para comportamento.
- Casos de borda e tratamento explícito de erros relevantes.
- Sem operações destrutivas, credenciais, dependências de produção ou I/O externo durante o CI.
- Revisões do CI bloqueiam erros; exceções precisam de motivação e rastreabilidade.

## Jobs do CI

`catalog` valida estrutura e índice; `go` usa test/race/vet; `python` usa Ruff, compileall e unittest; `cpp` compila com -Wall/-Wextra/-Wpedantic/-Werror e UBSan; `rust` usa fmt/clippy/test; `javascript` usa node --check e node --test; `typescript` usa tsc strict e testes; `angular` usa Angular compiler com strictTemplates; `java` usa javac -Xlint:all -Werror e asserts.

Os registros congelados da versão inicial permanecem identificados como `legacy_pending_review` e não podem ser alterados sem migração.

**Importante:** essas ferramentas só cobrem o que executam. Ainda são necessárias revisão humana, acompanhamento de dependências e testes extras em cenários críticos.

## Parsers por linguagem

A etapa inicial dos oito jobs de linguagem usa `scripts/parser_audit.py` para análise nativa, com grupos de logs e anotações de erro, além do resumo do job. As verificações anteriores (compilação, lint e testes) continuam obrigatórias. Consulte [a matriz de parsers](PARSER_VALIDATION.md) para limites e modos de execução.

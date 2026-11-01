# Política de qualidade

Critérios mínimos para cada entrada:

- Metadados válidos, ID único, caminho normalizado e README útil.
- Código original, reproduzível, com versão e dependências documentadas.
- Compilação/typecheck quando possível; lint; testes automatizados para comportamento.
- Casos de borda e tratamento explícito de erros relevantes.
- Sem operações destrutivas, credenciais, dependências de produção ou I/O externo durante o CI.
- Revisões do CI bloqueiam erros; exceções precisam de motivação e rastreabilidade.

## Jobs do CI

`catalog` valida estrutura e índice; `go` usa test/race/vet; `python` usa Ruff, compileall e unittest; `cpp` compila com -Wall/-Wextra/-Wpedantic/-Werror e UBSan; `rust` usa fmt/clippy/test; `javascript` usa node --check e node --test; `typescript` usa tsc strict e testes; `angular` usa Angular compiler com strictTemplates; `java` usa javac -Xlint:all -Werror e asserts.

**Importante:** essas ferramentas só cobrem o que executam. Ainda são necessárias revisão humana, acompanhamento de dependências e testes extras em cenários críticos.

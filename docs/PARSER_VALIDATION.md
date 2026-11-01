# Parsers nativos no GitHub Actions

Objetivo: localizar erros de sintaxe e, em algumas linguagens, tipagem e semântica de compilação, com logs e diagnósticos organizados por linguagem. **Parser não garante ausência de bugs, falhas de segurança ou corridas de dados.**

## Matriz de análise

| Linguagem | Parser ou verificador | Escopo sem executar os exemplos |
| --- | --- | --- |
| Python | `ast.parse` da biblioteca padrão | Todos os arquivos `.py` em `python/`, `scripts/` e `tests/`, sem importação |
| Go | `gofmt -e` | Cada `.go`; valida sintaxe, mas não tipos |
| C++ | `g++ -std=c++20 -fsyntax-only -Wall -Wextra -Wpedantic -Werror` | Cada `.cpp`, `.cc` e `.c`; sintaxe e parte semântica, sem linkar |
| Rust | `cargo check --offline --workspace --all-targets` | Crates e testes do workspace, sem executá-los |
| JavaScript | `node --check` | Cada `.mjs`, inclusive arquivos de teste; sintaxe |
| TypeScript | `tsc --noEmit --pretty false -p` | Configuração geral e strict isolada; parser e tipagem |
| Angular | `ngc -p tsconfig.json` | Código e templates incluídos no strictTemplates, sem navegador |
| Java | `javac -encoding UTF-8 -Xlint:all -Werror -d TEMP` | Cada `.java` isolado em diretório temporário, sem executar `main` |

## Uso

Com o toolchain da linguagem instalado, na raiz:

```bash
python3 scripts/parser_audit.py --language python
python3 scripts/parser_audit.py --language go
python3 scripts/parser_audit.py --language rust
python3 scripts/parser_audit.py --language angular
```

O wrapper publica:

- Um grupo `Parser <linguagem>: <arquivo ou projeto>` para cada verificação nos Actions Logs.
- `PASS` ou `FAIL` por check; falhas com anotação `::error` na interface do GitHub.
- `PARSER RESULT | ... | N/N aprovados` e um resumo no `GITHUB_STEP_SUMMARY`.
- Opcionalmente, `--json-report /tmp/parser-python.json` para integrar com ferramentas ou um futuro MCP.

A falha de um parser reprova o job; não configurar `continue-on-error`. Os testes de comportamento, lint e análise de runtime continuam depois do parser quando ele passa.

## Limitações

- A etapa de parsing não executa diretamente os exemplos. Compiladores podem carregar configurações, build scripts e plugins de terceiros: isso não representa uma sandbox para código hostil.
- Verificação C++ de headers só ocorre quando eles forem incluídos por unidades de tradução. Java compila exemplos isoladamente por causa das classes repetidas.
- Parse de Go e JavaScript não garante correção de tipos ou lógica. TypeScript e Angular verificam os arquivos abrangidos pelos tsconfigs.
- Para os três exemplos Angular atuais, a compilação AOT é seguida de testes de comportamento: signal, query params e HTTP simulado, em ambiente Node. Isso **não verifica templates renderizados no DOM** nem uma API real; exemplos futuros sem harness permanecem `compile-only`.
- `cargo check` não executa testes de concorrência; `--offline` evita baixar novas dependências nessa etapa.
- Este estágio acrescenta alguma duplicação de compilação aos jobs existentes. Podemos medi-la e otimizar o tempo posteriormente.

Antes de atribuir confiança ao resultado, confira os arquivos realmente listados, versões do toolchain e o status dos testes funcionais, separadamente.

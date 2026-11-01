# Taxonomia v1

As linguagens iniciais são `go`, `python`, `cpp`, `rust`, `javascript`, `typescript`, `angular` e `java`.

Categorias reconhecidas pelo validador:

| Categoria | Escopo |
| --- | --- |
| `algorithms` | busca, ordenação, grafos, matemática |
| `data-structures` | pilhas, filas, mapas, conjuntos |
| `concurrency` | sincronização, canais, tarefas |
| `io` | arquivos, streams, serialização |
| `errors` | tratamento e propagação de falhas |
| `security` | validação, codificação, limites |
| `testing` | testes unitários e de integração |
| `web` | HTTP, APIs, protocolos |
| `ui` | componentes, formulários, acessibilidade |
| `databases` | consultas e persistência |
| `tooling` | scripts e automação |

Padrão: `<language>/<category>/<slug>/example.json`. Cada diretório de exemplo é uma unidade de contagem e teste. Pastas sem conteúdo não contam como exemplos.

Adições futuras possíveis: `c`, `csharp`, `php`, `kotlin`, `swift`, `sql`, `bash`, `docker`, `react`. Inclusão exige CI apropriado, evitando pastas vazias como pseudo-conteúdo.

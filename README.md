# Data Library — exemplos de código validados

Biblioteca **multilinguagem** de exemplos pequenos, independentes, pesquisáveis e reproduzíveis.

> **Prioridade atual:** revisar os exemplos existentes e construir até **500 exemplos realmente úteis e bem documentados** como primeiro marco. As metas de 10.000–12.000 não estão ativas; exemplos só entram com finalidade real, contexto e evidência de validação.

## Linguagens iniciais

`go/`, `python/`, `cpp/`, `rust/`, `javascript/`, `typescript/`, `angular/`, `java/`.

Cada exemplo segue `<linguagem>/<categoria>/<nome>/` com três componentes: `example.json` (metadados), `README.md` (uso) e código-fonte com teste ou checagem executável.

## Encontrar exemplos

- [Catálogo JSON pesquisável](catalog.json) — consumível por scripts, IDEs, agentes e servidores MCP futuros.
- [Categorias e organização](docs/TAXONOMY.md).
- [Política de validação](docs/QUALITY_POLICY.md).
- [Plano de curadoria para 500 exemplos](docs/ROADMAP.md).

Para buscar no catálogo localmente:

```bash
python scripts/search.py binary search
python scripts/search.py --language go --category algorithms busca
python scripts/catalog.py --check
```

## Dataset com níveis de revisão

Este catálogo distingue a documentação completa (`documented`) de itens antigos, congelados para revisão (`legacy_pending_review`). **Aprovação no CI não significa que a especificação de um item esteja completa.**

Veja o [contrato de catalogação v2](docs/DATASET_SCHEMA.md), o [inventário das ferramentas internas](docs/INTERNAL_TOOLS.md) e as entradas pendentes em `docs/LEGACY_REVIEW.json`.

Novos exemplos sem contexto de uso, falhas, tratamento, riscos, testes e documentação no próprio código serão rejeitados automaticamente. O volume da biblioteca não é prioridade sobre sua rastreabilidade.

## Parsers nativos por linguagem

Cada job de linguagem executa também um parser nativo com grupos de logs, anotações de erro e resumo no GitHub Actions. A análise de sintaxe ocorre sem executar os exemplos; os testes comportamentais existentes continuam obrigatórios.

```bash
python3 scripts/parser_audit.py --language python
python3 scripts/parser_audit.py --language go
python3 scripts/parser_audit.py --language typescript
```

Consulte [a matriz, os diagnósticos e as limitações dos parsers](docs/PARSER_VALIDATION.md).

## Qualidade

Pull requests executam validações de estrutura, catálogo e verificações específicas para cada linguagem. **CI verde não equivale a prova de ausência de bugs**; indica apenas que as verificações automatizadas especificadas passaram.

A branch principal deve receber apenas lotes aprovados. Não criar exemplos falsos, repetidos ou que não possam ser verificados. Consulte [CONTRIBUTING.md](CONTRIBUTING.md).


## Kit poliglota de rigor e segurança

Novas referências catalogadas para [asserções TypeScript](typescript/security/runtime-assertions), [despacho limitado em Rust](rust/concurrency/bounded-dispatcher) e [status HTTP com Signals no Angular](angular/web/cluster-status-polling). Cada registro descreve condições de aplicação, riscos, erros e soluções, com status explícito de validação. **Nenhum dos exemplos instala serviços na VPS.**

## Worker de validação em lote (Actions + VPS)

O script [batch_worker.py](scripts/batch_worker.py) monta uma fila determinística a partir de `catalog.json` e registra resultados JSON por exemplo, prosseguindo mesmo após falhas. O [workflow opcional de VPS](.github/workflows/worker-vps.yml) exige um runner dedicado com label `data-library-worker` e só é acionado manualmente. **Não instala nada na VPS sozinho.** Consulte [operação e segurança](docs/WORKER_VPS.md).

A classificação `compile-only` permanece explícita quando não há teste de comportamento; nenhuma aprovação automática promove exemplos ao contrato v2.

# Data Library — exemplos de código validados

Biblioteca **multilinguagem** de exemplos pequenos, independentes, pesquisáveis e reproduzíveis.

> **Objetivo:** alcançar entre **10.000 e 12.000 exemplos de qualidade**. Esse é um objetivo de longo prazo, não uma contagem já entregue. Exemplos só são adicionados quando têm uma finalidade real, documentação e uma checagem automática.

## Linguagens iniciais

`go/`, `python/`, `cpp/`, `rust/`, `javascript/`, `typescript/`, `angular/`, `java/`.

Cada exemplo segue `<linguagem>/<categoria>/<nome>/` com três componentes: `example.json` (metadados), `README.md` (uso) e código-fonte com teste ou checagem executável.

## Encontrar exemplos

- [Catálogo JSON pesquisável](catalog.json) — consumível por scripts, IDEs, agentes e servidores MCP futuros.
- [Categorias e organização](docs/TAXONOMY.md).
- [Política de validação](docs/QUALITY_POLICY.md).
- [Plano para 12 mil exemplos](docs/ROADMAP.md).

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

## Qualidade

Pull requests executam validações de estrutura, catálogo e verificações específicas para cada linguagem. **CI verde não equivale a prova de ausência de bugs**; indica apenas que as verificações automatizadas especificadas passaram.

A branch principal deve receber apenas lotes aprovados. Não criar exemplos falsos, repetidos ou que não possam ser verificados. Consulte [CONTRIBUTING.md](CONTRIBUTING.md).

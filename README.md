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

## Qualidade

Pull requests executam validações de estrutura, catálogo e verificações específicas para cada linguagem. **CI verde não equivale a prova de ausência de bugs**; indica apenas que as verificações automatizadas especificadas passaram.

A branch principal deve receber apenas lotes aprovados. Não criar exemplos falsos, repetidos ou que não possam ser verificados. Consulte [CONTRIBUTING.md](CONTRIBUTING.md).

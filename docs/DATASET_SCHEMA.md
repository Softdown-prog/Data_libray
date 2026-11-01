# Contrato de catalogação do dataset — v2

O repositório é uma **biblioteca reutilizável**, não um despejo de snippets. A qualidade é avaliada separadamente da compilação. Um exemplo novo só é aceito se cumprir todo o contrato.

## Identidade e organização

Cada item deve estar em `<linguagem>/<categoria>/<slug>/`, com ID permanente `linguagem.categoria.slug`, metadados `example.json`, README técnico, implementação comentada e testes/checagens.

## Campos exigidos em example.json

- Identidade: `schema_version: 2`, `id`, `title`, `description`, `entrypoint`, `run`, `test`, `tags`.
- `spec.purpose`: o que resolve, resultado esperado e comportamento.
- `spec.when_to_use` e `spec.when_not_to_use`: contexto de adoção e contraindicações.
- `spec.requirements`: versões, pré-requisitos, dependências e garantias de entrada.
- `spec.inputs` e `spec.outputs`: parâmetros, retornos, efeitos e complexidade quando relevante.
- `spec.error_handling`: condições de falha, exceções, sentinelas e como tratá-las.
- `spec.limitations`: limitações funcionais, desempenho e riscos de segurança.
- `spec.troubleshooting`: array de `symptom`, `cause`, `fix` concretos.
- `spec.runtime`, `spec.usage_language`, `spec.usage_example`: ambiente e exemplo real de integração.
- `spec.validation`: `level` (`automated-tests` ou `compile-only`), `scope` e `gaps`.
- `spec.files`: relação exata de cada código, teste e configuração com `path` e `role`.
- `spec.provenance`: `original` nesta fundação; código de terceiros exige análise de licença antes de permitir inclusão.

O `README.md` deve conter as seções correspondentes, e o arquivo principal precisa explicar o uso no cabeçalho com `Data Library ID: <id>`. O CI bloqueia a ausência desses campos, seções ou arquivos no inventário.

## Padrão de validação

```bash
python scripts/catalog.py --write  # atualiza índice determinístico
python scripts/catalog.py --check  # falha se índice ou arquivo divergir
python -m unittest discover -s tests -p 'test_*.py'
python scripts/search.py --language go "ordenado"
```

`catalog.json` distingue `documented` de `legacy_pending_review`. `documented` indica documentação técnica completa e checagens automatizadas no escopo declarado, **não uma prova formal de correção**.

## Migração gradual da fundação

Os exemplos anteriores à versão 2 foram congelados com hashes individuais em `docs/LEGACY_REVIEW.json`. Eles continuam disponíveis para consulta, mas **não contam como documentados**. Nenhum arquivo antigo pode ser alterado sem passar para o contrato v2; nenhum exemplo novo v1 pode ser criado. A cada migração, remova o registro correspondente da lista de congelamento, escreva a especificação e atualize o catálogo.

Não aumente a quantidade de exemplos enquanto a qualidade e o catálogo não estiverem devidamente revisados.

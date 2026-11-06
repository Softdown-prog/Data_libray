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

## Worker autônomo 24/7 na VPS (padrão)

A VPS executa `scripts/vps_daemon.py` como serviço `systemd`, sem GitHub Actions runner. O supervisor mantém fila persistente, retoma lotes interrompidos, registra resultados JSON por exemplo, verifica novos trabalhos no checkout local e revalida uma vez por dia. O serviço tem cotas de CPU/RAM para proteger os outros projetos.

A instalação única está em [deploy/install-vps-worker.sh](deploy/install-vps-worker.sh), o serviço em [deploy/systemd/data-library-worker.service](deploy/systemd/data-library-worker.service) e os comandos de operação em [docs/WORKER_VPS.md](docs/WORKER_VPS.md). Publicar estes arquivos no GitHub não instala o serviço na VPS. GitHub continua como repositório e CI complementar, sem controlar a fila local.

A fila suporta até 1.000 IDs existentes, mas não fabrica exemplos novos. Nenhuma aprovação promove legados automaticamente à especificação v2.

## SAC Multistack (em desenvolvimento)

Treze novos perfis opt-in, com pré-verificação somente leitura e probes
nativos reais para Python, JavaScript, Go, Rust, C++20, HTML5 e CSS.
Os gates de frameworks ainda dependem de compiladores/Chromium isolados;
preflight aprovado não representa validação de runtime ou deploy.
Consulte [SAC Multistack](docs/SAC_MULTISTACK.md) e a [issue #62](https://github.com/Softdown-prog/Data_libray/issues/62).

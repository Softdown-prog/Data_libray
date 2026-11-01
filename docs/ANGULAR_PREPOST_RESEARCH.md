# Pesquisa inicial — pré/pós-compilador Softdown Angular

**Estado:** levantamento inicial em 01/11/2026. Não representa varredura completa de todos os repositórios, branches apagadas, logs ou conversas. Dados estruturados: [angular-incidents.v1.json](angular-incidents.v1.json).

## Método

1. Consultar PRs, histórico Git e commits corrigidos nos repositórios `Softdown-prog/Painel`, `Softdown-prog/A7-forge-2D-`, `Softdown-prog/Terrania` e `Softdown-prog/Data_libray`.
2. Recuperar semanticamente relatos antigos das conversas, sempre classificados como `conversation_report` quando não houver prova direta de execução.
3. Registrar a falha, referência, etapa correspondente e regra candidata, sem copiar tokens, dados pessoais ou credenciais de logs.
4. Criar uma fixture **antes da correção** (reprova) e uma **depois da correção** (aprova) antes de transformar cada hipótese em regra bloqueante.

## Resultados desta amostra

- LHS: Angular 22 usa TypeScript 6 isolado; React ainda era entrypoint durante o preview. Hosts Angular compilados não garantem integração no HTML de publicação.
- Painel: o build sem verificação da publicação deixou o bundle Angular fora do artefato Pages; verificar bundle e SHA publicado é função de pós-build/deploy.
- Terrania: smoke legado exigia texto do HTML estático antigo; o shell Angular usa `app-root`, e configuração pública WSS pode estar em chunks ESM carregados sob demanda.
- Data Library: testes em Node de Signals e HTTP simulado não atestam a interface no DOM.
- Conversas: `aria-pressed` e scripts de captura que esperavam React surgem como relatos relevantes, mas precisam de confirmação de diff/execução para virar regras oficiais.

## Arquitetura sugerida

```text
Preflight Softdown (AST/tsconfigs, resolução de dependências, host contracts)
  -> Angular oficial (ng build sem fork)
  -> Postflight Softdown (dist HTML, bundles, chunk graph, root, sourcemap, hashes)
  -> Guardian / Playwright (DOM, clicks, state, API, mobile)
  -> Check de publicação (artifact SHA + URL pública/health)
  -> One Worker (orquestra, registra resultado; falha bloqueia promoção)
```

**Atenção:** o pós-compilador não deve presumir que HTML estático contém textos produzidos dinamicamente pelo Angular. Nem o pré-compilador deve tratar somente uma versão fixa de TypeScript como regra universal: a resolução depende das peer dependencies do Angular efetivamente instalado.

## Primeira regra executável proposta

`SAC-P001 / dist-entry-consistency`:

- Entrada: diretório de `dist` pós-build, arquivo `index.html`, manifesto de framework esperado e hashes do commit.
- Verificação: root Angular esperado presente; entry scripts existem e são legíveis; todas as referências a CSS/JS locais no HTML resolvem no artefato; sem bundle React legado se o contrato declarar `angular-only`; se a publicação copiar os arquivos, manifestos pré e pós-deploy devem corresponder.
- Prova negativa: fixture compila mas aponta para script inexistente, HTML com React-only apesar de contrato Angular-only, ou root não montado.
- Prova positiva: fixture Angular com root e assets corretos. Confirmação de boot efetivo permanece responsabilidade do Guardian Chromium.
- Sem rede, sem shell vindo de JSON, sem publicar nada e sem alterar o compilador oficial.

## Evolução dos dados

Adicionar incidentes com `SAC-011` em diante somente após anexar referência, condição que falhou, resultado esperado e categoria de prova. Registrar também **falsos positivos**, para evitar criar um fiscal que reprova código correto.

Comando de verificação do catálogo:

```bash
python3 scripts/validate_angular_incidents.py
python3 -m unittest tests.test_angular_incidents -v
```

O primeiro verificador está implementado em [`packages/angular-postcompiler`](../packages/angular-postcompiler/README.md), com fixtures Node e smoke de build Angular oficial. O resultado é estático; integração ao Guardian/One Worker e promoção em produção continuam fora deste marco. Não ativar bloqueio em produção com base apenas neste catálogo.

## SAC-003 — primeiro preflight executável

[`packages/angular-precompiler`](../packages/angular-precompiler/README.md) registra `SAC-PRE001` no Core com phase pre e demonstração em observe. Valida declarações, lock npm e instalações reais via peers/engines locais; separa a resolução do app daquela usada por compiler-cli. A ordem é preflight → Angular oficial → postflight → Guardian posterior. Não modifica workspace ou supervisor, não instala dependências e não ativa gate de produção.

## SAC-004 — auditor do pipeline estático

[`packages/angular-pipeline`](../packages/angular-pipeline/README.md) liga PRE001 → comprovante autenticado do build oficial do host → P001, sem executar comandos do perfil. `--no-build` confere digests de perfil/fontes selecionadas/dist e separa `static_pipeline_pass` de autorização real de deploy. SHA e execução do build são declarações do CI confiável; cobertura é explicitamente limitada. Guardian/browser e deploy não são executados.

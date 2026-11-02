# SAC Brain v1 — explicador local, sem rede

## Objetivo e limites

Microetapa isolada do SAC na Data Library. Interpreta **somente** o diagnóstico SAC
sanitizado de schema_version=1 e consulta `knowledge/sac-brain-v1.json`
para produzir `causa possível` e `próxima ação` em português.

- Runtime Node.js 24, módulos nativos; **sem IA generativa, GPU, APIs pagas, embeddings, LLM, PyTorch ou TensorFlow**.
- É uma base de raciocínio simbólico por códigos exatos, não um modelo treinado.
  Reconhecer código **não comprova causa raiz**. Não calcula probabilidades inventadas.
- Para código desconhecido ou incompatível com a fase, retorna
  `insufficient-evidence` em vez de uma explicação especulativa.
- Nunca lê fontes, executa código analisado, acessa rede, coleta segredos ou modifica projetos.
- Não preenche arquivo/linha sem evidência: `file_location_verified: false`.
  Nunca copia títulos, mensagens ou orientações livres do input.
- A saída `SAC Brain` é **separada** de `diagnostic`: o contrato do Worker atual
  é fixo e **não deve** ser alterado por esta microetapa.
- Não altera a decisão dos compiladores, Guardian, nem autoriza deploy.
- Não há aprendizado automático ainda: adicionar uma regra ao catálogo exige revisão,
  testes e PR. As próximas etapas poderão aprender com correções **confirmadas**,
  mas não com erros supostos.

## Uso em runner confiável

```bash
node --test tests/sac_brain.test.mjs
node scripts/sac_brain_cli.mjs /caminho/confiavel/report.json
```

A CLI limita a entrada a 8 KiB, aceita o objeto `diagnostic` diretamente
ou o resultado do Worker que contenha `diagnostic`, emite **apenas** JSON
sanitizado por stdout, e falha com código 2 sem reproduzir texto hostil.

O resultado distingue `known-pattern` de `insufficient-evidence`,
mantém o estado original do relatório e inclui `root_cause_verified:false`.
Erros `pass` não podem conter findings nem verificações pendentes.

## Integração posterior

1. Fechar com evidência real a consulta da VPS via GitHub/MCP.
2. Rodar SAC Brain após o diagnóstico autenticado do Worker.
3. Publicar o resumo sanitizado como artefato separado associado a `job_id`
   e commit SHA; exigir confirmação do retorno antes de declarar integração pronta.
4. Somente depois: classificador local treinado com casos validados, recuperação
   de exemplos e análise de AST TypeScript por microetapas.

**Não foi efetuado merge, publicação, intervenção na VPS ou mudança de permissão.**

## Prova GitHub Actions (sintética, sem VPS)

O workflow `SAC Brain v1 local diagnostic engine` executa os testes e gera
`sac-brain-v1-synthetic-diagnostic` a partir de uma fixture rotulada
explicitamente como **sintética**. Testa um padrão conhecido, um desconhecido
e a omissão de `FAKE_SECRET_VALUE`. Esse artefato pode ser consultado via
GitHub/MCP para comprovar o formato do retorno. **Não representa um job que
passou pela VPS nem significa que a comunicação SAC Worker esteja pronta.**


## Microetapa — resposta do Painel SAC Worker (offline)
A nova CLI `scripts/sac_brain_worker_reply_cli.mjs` interpreta um
`vps-result.json` sanitizado com `operation=sac_worker` e `action=job`.
Ela valida ids, SHA, estado, proibição de deploy e o diagnóstico antes
de entregar classificações do SAC Brain. Uma falha, como
`{"exitCode":1,"error":"ValueError: request rejected"}`, produz
`unverified`, nunca `pass`. Se um resultado não tiver diagnóstico,
a análise também será `unverified`.

**A validação do JSON não é prova de origem.** O campo
`origin_verified:false` fica explícito até o GitHub Actions e o
commit de origem serem conferidos por canal autenticado.

O caso de teste usa fixture **sintética** publicada como artefato do
CI. Uma tentativa real de consulta somente leitura no Painel,
[Issue #75](https://github.com/Softdown-prog/Painel/issues/75),
foi rejeitada pelo broker. Portanto não há ainda relatório real do
Worker SAC nem integração VPS concluída.


## SAC Brain Text v1 — explicação de logs sem modelo local

A etapa `scripts/sac_brain_text.mjs` gera **texto em português de forma
determinística** usando exclusivamente os códigos e hipóteses do catálogo
versionado. Não usa Ollama, Hugging Face, modelo 0,5B/7B, rede ou dependências
externas. É uma saída **adicional**: não substitui o log bruto, o contrato do
Worker ou o relatório JSON original.

```bash
node scripts/sac_brain_text_cli.mjs tests/fixtures/sac-brain-incident.synthetic.json --text
node scripts/sac_brain_text_cli.mjs tests/fixtures/sac-brain-vps-reply.synthetic.json
```

- Entrada: diagnóstico SAC já sanitizado, ou resposta `sac_worker` de **job**
  submetida ao adaptador rigoroso `interpretWorkerReply`.
- Saída: resumo, lista de ocorrências e próximas verificações; quando um
  código não consta no catálogo, informa que **não há causa comprovada**.
- Casos `unverified` e `infra-error` não viram `pass`.
  Consultas negadas ou jobs sem diagnóstico também não viram aprovação.
- Não lê nem reproduz `title`, `next_step`, logs brutos, paths, segredos
  ou identificadores informais do input. O resultado afirma
  `origin_verified:false` e `root_cause_verified:false`.
- A saída textual não produz timestamp de execução inventado; quem escreve
  o log pode acrescentar um carimbo confiável no seu próprio sistema.
- O CI publica um artefato **sintético** `sac-brain-text-v1-synthetic`.
  Nenhuma execução real da VPS nem autenticação da origem é inferida.
- A consulta de status do One Worker reportou 21 verificações aprovadas em
  02/11/2026, mas **isso não é um diagnóstico de job Angular** e não deve
  ser narrado como tal. A autorização para execução de novos jobs permanece
  uma etapa separada.

### Integração posterior

Conectar a saída de texto somente após receber um diagnóstico de job real
por um canal autenticado; manter o log estruturado íntegro e publicar a
explicação como anexo opcional. Não introduzir modelos locais por padrão.

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

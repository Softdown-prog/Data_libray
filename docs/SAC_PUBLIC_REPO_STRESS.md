# SAC: teste de estresse em repositórios públicos gigantes

Objetivo: encontrar limites do SAC usando **repositórios nunca adaptados**.
Não compilar o Chromium inteiro nem afirmar que o repositório foi auditado.

| Repositório | Perfil SAC | Amostra |
| --- | --- | --- |
| chromium/chromium | cpp20 | base/ |
| kubernetes/kubernetes | go | pkg/apis/core/ |
| rust-lang/rust | rust | library/core/src/ |
| microsoft/TypeScript | javascript | packages/typescript/src/ast/ |
| golang/go | go | src/go/ast/ |

A coleta começa por commit SHA do GitHub; percorre subárvores por seus
hashes e seleciona até três blobs de até 32 KiB. O conteúdo só é aceito
depois de conferir o Git blob SHA-1. Arquivos ficam em diretório temporário
e são passados a `inspectModule` (o pré-verificador SAC real).
Não são importados nem executados. Não se fazem clones, installs ou builds.

**Orçamentos:** cinco projetos fixos; até seis árvores/projeto;
no máximo 4.000 entradas por árvore, 2 MiB por resposta HTTP,
três blobs/projeto, 96 KiB de amostra por projeto e 60 s/projeto.
Runner descartável, sem acesso à VPS nem deploy.

**Como interpretar:** `metadata_status=observed` apenas confirma leitura
parcial da árvore Git. `preflight_status=pass` só comprova pré-requisitos
dos arquivos amostrados. `overall_audit=unverified` e
`build/tests/browser=not-run` são obrigatórios em todos os casos.

`no-supported-sources-in-sample` revela lacuna do perfil/seleção, não
erro do projeto (como TypeScript num perfil limitado a JavaScript).
`required-root-manifest-unavailable` expõe perfil incompatível com a raiz
(como stdlib sem go.mod). `limited-or-unavailable` cobre falhas de rede,
API, limites ou digest, sem inventar diagnóstico técnico.

O CI rejeita uma bateria silenciosamente vazia: exige 3 repositórios
observados e ao menos um arquivo Chromium confirmado por SHA.
Produz somente JSON factual no artifact (sem código fonte).

Para **compilação real de projetos enormes**, será necessária outra etapa
com orçamento de disco/RAM/CPU, toolchains específicas, dependências
imutáveis e sandbox sem rede/credenciais. A VPS de 4 vCPU/4 GB não
é apropriada para compilação integral do Chromium.

Workflow: `.github/workflows/sac-huge-public-repos.yml`.

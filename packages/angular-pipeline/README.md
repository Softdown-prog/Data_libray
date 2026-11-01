# SAC-004 — Pipeline universal 0.1

Auditor CLI `--no-build`: preflight via Core → comprovante de build do host CI →
postflight via Core. Não executa compiladores, shell, navegador ou publicação.
Pacote privado, Node >=22, uso no checkout monorepo. APIs/CLIs/JSON dos três
pacotes anteriores permanecem intactos.

```bash
npm ci --prefix packages/angular-core --ignore-scripts
npm ci --prefix packages/angular-precompiler --ignore-scripts
npm ci --prefix packages/angular-postcompiler --ignore-scripts
node packages/angular-pipeline/bin/pipeline.mjs --no-build \
  --profile profile.json --workspace /workspace/app --dist dist/browser \
  --sources sources.json --receipt build-receipt.json \
  --trust-key /trusted-ci/host.key --source-sha COMMIT_SHA
```

`--project apps/example` seleciona subapp; workspace é a raiz confiável.
Dist e cada item de sources.json são caminhos relativos a essa raiz, sem traversal.
Sources.json é uma lista explícita de arquivos relevantes ao build, por exemplo
package.json, package-lock.json, angular.json, tsconfig.json e todos os fontes.
A seleção pertence ao host confiável, **não é descoberta completa do Git**.
Package.json do app é obrigatório; o host deve incluir também locks, configs,
assets e demais inputs relevantes. Omissões do host não podem ser detectadas
universalmente. Não selecione secrets, arquivos .env ou a chave. A implementação
não varre o workspace, não lê scripts para executá-los e não serializa conteúdo.

O perfil usa o schema v1 do Core. Para Angular, seleciona exatamente SAC-PRE001 e
SAC-P001 v1.0.0; static pass requer ambos required=true/enforcement=blocking.
Observe nunca substitui cobertura obrigatória. Perfil não Angular fica
not-applicable sem IO. Nenhum major, nome ou host de produto é imposto.

## Comprovante emitido pelo host confiável

Não basta escrever `build: pass` ou alegar um SHA em JSON. O host que já executa
a pipeline oficial mantém chave aleatória privada com pelo menos 32 bytes,
protegida dos contratos/contribuições não confiáveis. Nunca envie essa chave ao
Git, relatório ou artefatos. Use chave efêmera por job; audite no mesmo job ou
configure distribuição segura pelo próprio host, fora deste pacote.

```js
import { prepareBuild, sealBuild, auditPipeline } from './packages/angular-pipeline/src/index.mjs';
const args = { profile, resources, sourceSha, key }; // recursos e chave do host
const { session, report } = await prepareBuild(args);
if (!session) throw new Error('Preflight não comprovado');
// Host executa sua etapa Angular oficial já autorizada, sem comandos do perfil.
// Limpar o output antes do build evita reaproveitamento acidental de dist velho.
const receipt = await sealBuild({ ...args, session, buildStatus: officialBuildSucceeded ? 'pass' : 'fail' });
const result = await auditPipeline({ ...args, receipt });
```

`prepareBuild` exige preflight obrigatório aprovado e captura digest das fontes
selecionadas antes do build. `sealBuild` confere que elas não mudaram e captura
manifesto de conteúdo completo do dist após a etapa oficial do host. Ambos
vinculam perfil normalizado, seleção de recursos e source_sha_claim. O recibo é
autenticado por HMAC-SHA256; comparação em tempo constante. O auditor repete
preflight e verifica recibo e digests atuais antes de executar post, rechecando
os inputs após postflight. Não há sessão válida quando pre falha; não há post
quando build/evidência falta, falha ou diverge.

**Fronteira de confiança:** HMAC autentica a declaração do host detentor da chave.
Não prova independentemente que ng build rodou nem a origem do compilador. Um
host que assine um dist velho como build novo pode mentir. O caminho autorizado
é CI confiável, preflight antes, limpar/build oficial, assinatura depois; não
assinar recibos de terceiros. A versão inicial deliberadamente não oferece
executor genérico de comandos. O script examples/official.mjs é um host de teste
isolado, com comando fixo, shell:false e timeout externo de 120 s.

SHA é **alegação**, não consulta/prova de Git: source_sha_claim recebe 40/64 hex.
Digests SHA256 atestam os conteúdos selecionados e artefatos atuais vinculados ao
comprovante autenticado; não são assinatura de publicação ou prova de integridade
de todos os inputs transitivos, node_modules, toolchain, serviços ou Git remoto.
Mesmo conteúdo reproduzível pode ter mesmo digest; não exigimos diferença
artificial de bytes para reconhecer novo build autenticado pelo host.

## Relatório e política

JSON estável v1, sem relógio, stdout de build, paths absolutos, URLs ou exceções
brutas. Inclui profile_id/profile_digest, source_sha_claim e versões das regras
nos resultados Core. Fases em ordem auditável pre/build/post/browser/deploy.
Cada fase inclui status, executed e evidências/cobertura quando executada.
`build.executed=false` significa build externo consumido; código authenticated-ci-build
explicita a evidência. Browser/deploy permanecem unverified/executed=false.

Exit 0 exclusivamente com static_pipeline_pass=true; demais resultados exit 1.
`deployment_authorized` é sempre false, inclusive quando status=pass. Não usar
promotion_allowed do Core como gate real do produto. Pre pass, comprovante de
build pass e post pass são necessários; regras opcionais ou observe não produzem
aprovação implícita. Nenhum resultado estático é browser-pass. Sem segredos em
perfis/IDs; o host deve fornecer só identificadores públicos.

## Limites

Execução sequencial, não compartilhar dist entre processos. Pre/post herdam
limites cooperativos do Core; timeout/infra-error bloqueiam aprovação. Snapshot
limita 2048 fontes, 4096 entradas/leituras, 16 MiB/arquivo, 64 MiB total e 24 níveis
de dist; excesso é unverified. Arquivos regulares, symlinks de dist rejeitados,
leituras confinadas à raiz real. Exige workspace/outputs imutáveis durante auditoria;
realpath/open têm limite TOCTOU, sem promessa de sandbox. Contratos não escolhem
módulos/código, shell ou rede. Saída de build existe só nos logs do host CI e não
é incorporada ao JSON. Nenhuma integração Guardian, One Worker, VPS ou deploy.

## Verificação

`npm test --prefix packages/angular-pipeline` exercita SPA raiz, subpath, híbrido,
subapps/locks independentes e não Angular. Negativos: pre incompatível/ausente,
observe, required sem cobertura, timeout/infra, build ausente/falho/adulterado,
SHA/perfil/fontes/dist divergentes, post com bundle/root quebrado e CLI.
O workflow SAC Universal Pipeline anexa JSON de build Angular oficial positivo e
artefato adulterado negativo. O workflow anterior mantém os 199 testes e smoke
Angular 22. Validate code library mantém seus 9 jobs.

# SAC — comparação incremental de recibos autenticados

## Objetivo

O PR #72 confirmou em uma fixture oficial que Angular AOT A limpo,
template negativo TS2339, B no mesmo workspace e B limpo produzem
artefatos coerentes. Esta etapa vincula a comparação aos **recibos HMAC**
já gerados por `prepareBuild` + `sealBuild` no pipeline Angular do SAC.

### Contrato de uso opt-in

Um host confiável produz três recibos com a **mesma chave temporária**:

- `baseline`: versão anterior A, com source SHA claim e digest de fontes A.
- `warm`: versão atual B, assinada pelo `sealBuild` (também o recibo
  normal fornecido a `auditPipeline`).
- `clean`: versão B recompilada independentemente pelo host, com hashes
  de fontes e de toda a árvore de artefatos B.

Exemplo de auditoria sem execução ou rede dentro do SAC:

```js
const report = await auditPipeline({
  profile, resources, key, sourceSha: currentCommitSha,
  receipt: currentSignedReceipt,
  incremental: {baseline: oldSignedReceipt, clean: freshSignedReceipt}
});
```

Se `incremental` é omitido, o contrato atual do pipeline permanece igual.
Se é informado, o SAC verifica HMAC dos três recibos, identidade do
perfil e escopo do projeto, SHA declarado do commit, digest da fonte e
digest de **toda a árvore dist**. Só depois autoriza executar o postflight.
Falha de HMAC, bundle B igual ao A, divergência B warm/clean, origem
incompatível ou recibo ausente bloqueiam o postflight com código fixo.
O caso de hash igual entre A e B produz `unverified`, pois uma mudança
sem impacto no bundle (comentário, tree-shaking) é perfeitamente válida;
não seria correto confirmar "cache obsoleto" apenas com hashes iguais.
O resultado de `incremental` é um campo opcional no relatório principal.

### Evidência e limites

Um HMAC autentica a **declaração do host**, não o processo do Angular CLI
ou a execução de um build limpo. O código confirma igualdade de digests
assinados, não prova que os builds ocorreram em máquinas/containers
diferentes, nem garante um cache hit ou ausência de bugs de runtime.
Por isso o recibo inclui:

- `compiler_invocation_verified=false`;
- `clean_workspace_independent_verified=false`;
- `cache_hit_verified=false`;
- `production_aot_verified=false`;
- `deployment_authorized=false`.

Para auditorias reais, o host deve fixar comandos, toolchain, commit e
proveniência dos arquivos de cada build em seu executor isolado e manter
a chave sob controle. O SAC não recebe scripts de projeto, não expõe
a chave, não clona repositórios e não executa compiladores nesta API.

### Regressão automatizada

`packages/angular-pipeline/test/incremental-receipts.test.mjs` sela de
verdade os recibos com a implementação atual do pipeline e testa:

- A -> B com fontes diferentes e hashes iguais em B warm/clean;
- artefato B obsoleto, mas status de build declarado `pass`;
- assinatura adulterada, chave errada e projetos/perfis misturados;
- fonte B diferente da referência limpa, com mesmo bundle;
- ausência de recibo, SHA reutilizado e build declarado `fail`;
- opt-in positivo que chega ao pós-compilador e opt-in inválido que
  bloqueia o pós-compilador.

**Nota:** os testes de recibos usam dist sintético; a prova separada
de compilação oficial Angular permanece no PR #72. Esta mudança não
cria uma prova de build real do projeto do usuário nem modifica Worker,
VPS, API externa ou política de deploy.

## Executor confiável — ensaio integrado em Docker

O workflow `.github/workflows/sac-signed-angular-docker.yml` executa o
`scripts/sac_trusted_signed_docker_rehearsal.mjs` numa runner efêmera,
com a fixture **first-party Angular 22**, lockfile oficial da fixture
e imagem Docker Playwright fixada por digest.

A execução emite três recibos reais por `prepareBuild` e `sealBuild`,
com uma chave HMAC aleatória efêmera mantida no processo confiável:
A (template inicial), B (mesmo projeto com template alterado) e B de
referência (mesma fonte, outra execução de Docker). Cada build usa
`isolatedAngularBuild`, com `--network none`, limite de CPU/RAM,
capabilities removidas, UID não-root, imagem fixada e sem scripts
externos. A assinatura só ocorre **após** o build isolado terminar e
o host conferir as fontes e o digest completo de `dist`.

O host usa **claims sintéticos diferentes A/B** para exercitar o
contrato de recibos, não commits Git verdadeiros; nunca afirmar
autenticação do SHA Git do conteúdo. O auditor testa a comparação
opt-in e pós-compilação real, além de um recibo B adulterado,
que precisa bloquear o postflight. A saída inclui apenas códigos
estáveis, contagem de compilações e SHA-256 de artefatos.

**Limite:** `isolatedAngularBuild` usa staging novo a cada invocação;
o segundo build não é um cache-warm comprovado, embora use uma
revisão posterior da mesma fonte confiável. Isto é prova de
reprodução entre builds isolados, não de cache hit, incremental
ngtsc interno, compilação de repositório externo ou equivalência
funcional de todo o aplicativo. O teste de warm rebuild oficial
continua documentado no PR #72. Nenhum deploy ou VPS é autorizado.

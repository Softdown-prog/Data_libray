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

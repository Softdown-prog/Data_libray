# SAC — comparação AOT Angular entre rebuild aquecido e build limpo

## Objetivo
O objetivo é detectar quando a recompilação após uma mudança gera artefato
antigo ou diferente de uma compilação independente da mesma fonte. Usamos o
Angular CLI oficial da fixture confiável `angular-postcompiler/smoke`,
não um projeto externo. Esta etapa é prova de comportamento, não uma regra
que considera todo projeto Angular validado para deploy.

## Sequência real (quatro invocações do CLI Angular)

1. Criar workspace sintético `warm`, compilar template A limpo. Registrar
   SHA-256 do `dist/browser/main.js` e o marcador público de A.
2. Trocar o HTML por `{{ missingMethod() }}` no mesmo workspace e exigir
   uma **falha real do compilador oficial** contendo o código `TS2339`.
3. Corrigir o HTML para B no **mesmo workspace/cache** e exigir build
   bem-sucedido e artefato com marcador B, diferente do digest de A.
4. Criar outro workspace `cold` sem histórico/cache; compilar o mesmo B.
   O SHA-256 do artefato B frio deve ser igual ao do B aquecido.

O comparador `compareAngularIncrementalEvidence()` retorna códigos limitados.
A verificação negativa substitui **somente no objeto de evidência** o hash
do warm B pelo hash A e exige `stale-artifact-not-updated`.
Essa alteração em memória não demonstra falha do Angular: demonstra que
o comparador rejeita um recibo obsoleto.

## Limites e honestidade das evidências

O workspace de teste habilita explicitamente o cache Angular CLI mesmo em
ambiente CI. Uma execução repetida no mesmo diretório é considerada um
**warm rebuild candidate**, não prova de cache hit, porque não há
contabilização de cache hits pela ferramenta: `cache_hit_verified=false`.
Também não há browser, runtime ou deploy verificados nesta prova.

Um hash de um único artefato main.js não equivale a uma validação de toda
a árvore `dist/`, nem garante equivalência funcional. Expandir para
manifests de arquivos e recibos autenticados será uma etapa separada.

CI roda em runner GitHub efêmero, sem VPS, sem fonte de terceiros, sem
lifecycle scripts; `npm ci --ignore-scripts` instala apenas a ferramenta
oficial já fixada no `smoke/package-lock.json`.
Saída pública contém fases, digests SHA-256 e códigos fixos, nunca stdout
ou stderr de compilador, paths privados ou conteúdo de arquivos.

PR em draft até o job unit e as quatro etapas AOT estarem comprovadamente
aprovados. Não mesclar nem modificar o Worker/Painel/VPS.

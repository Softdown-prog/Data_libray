SAC — microetapa 2: evidência de falha da compilação isolada

A coleta em scripts/sac_compiler_evidence.mjs reconhece um erro TypeScript na
saída local do Angular CLI executado no Docker isolado e confere se o arquivo
relativo está na lista sourceFiles do operador. Nenhum stdout/stderr bruto,
trecho do código-fonte, mensagem arbitrária, segredo ou caminho do host é
repassado ao resultado.

O resultado isolado traz:
- status=fail e code=angular-compiler-failed, somente quando houver assinatura
  explícita do erro no compilador Angular.
- compiler_evidence.schema_version=2: código TypeScript, arquivo relativo
  permitido, linha e coluna verificadas, descrição factual fixa, exit_code,
  post_status=not-run e browser_status=not-run.
- Se não houver dados seguros para comprovar arquivo e posição, retornam null.
- Erros Docker sem evidências de compilação mantêm infra-error/build-failed.
- No máximo 4 ocorrências, limite de entrada 32 KiB e sem publicação de logs.

IMPORTANTE: a estrutura v2 fica somente no resultado interno de
isolatedAngularBuild(). O supervisor e a fila de jobs ainda usam contrato v1,
não foram migrados; quando o supervisor não recebe um build aprovado ainda pode
resumir genericamente a falha. A etapa seguinte será transportar o objeto v2
por um contrato distinto, sem modificar o JSON histórico v1 até a homologação.

Testes de unidade: tests/sac_compiler_evidence.test.mjs.
Teste real em Docker: scripts/sac_isolated_build_integration.mjs injeta TS2322
numa fixture e verifica que o construtor observa código, arquivo, linha e
coluna. Essa fixture é artificial, sem projetos reais e sem VPS.

Issue #41 da Data Library. Nada de modelo local, permissão de deploy, novo
job na VPS ou merge automático.

# SAC-041 — observação negativa do compilador Angular oficial

**Microetapa 1 de investigação**, não é um coletor de produção, nem alteração do
Worker. Prova com um build Angular/TypeScript oficial e uma fixture artificial
se o compilador fornece `TS2322` e localização `src/main.ts:<linha>:<coluna>`.

## Execução reproduzível no runner descartável

```bash
npm ci --prefix packages/angular-postcompiler/smoke --ignore-scripts --no-audit --no-fund
node --test tests/sac_angular_failure_probe.test.mjs
node scripts/sac_angular_failure_probe.mjs
```

O script copia um conjunto **fixo** de arquivos da fixture versionada para
diretório temporário, usa dependências fixadas por lockfile e insere uma
atribuição TypeScript deliberadamente inválida `string = 123`.
O Angular CLI oficial faz o build. Código de saída **1** é esperado:
este é um teste de compilação **negativa intencional**, não uma aprovação
do projeto. A automação passa **somente** se o compilador apresentar código
`TS2322`, arquivo relativo e localização coerente com a linha inserida.

O arquivo de evidência publicado no GitHub Actions traz **apenas**
campos estruturados do erro sintético, nunca o stdout/stderr bruto,
mensagens arbitrárias, caminhos do host ou credenciais. Nenhum resultado
revela a localização de código real ou valida uma revisão de terceiros.

## Limites e próximo passo

- O parser deste teste é deliberadamente específico da fixture.
  **Não reutilizá-lo** como extrator genérico de logs de projetos.
- O build real do `scripts/sac_sandbox_builder.mjs` atualmente retorna
  `build-failed` quando o processo de build sai com código diferente
  de zero. `scripts/sac_supervised_runner.mjs` pode transformar a falha
  em `audit-infrastructure-error`. **Ambos ainda perdem o diagnóstico**.
- A etapa 2 deve preservar eventos de compilação com parser/sanitização e
  escopo restritos **dentro** do executor confinado; diferenciar erro
  TypeScript de falha de infraestrutura; manter código, localização relativa
  comprovada e não-execução das fases posteriores; definir contrato v2
  **separado** sem alterar o v1 usado pelo broker do Painel.
- O minicérebro do SAC será **relator factual**, sem causas possíveis,
  recomendações, aprendizado de máquina ou modelo local.
- Nenhum código desta prova é executado na VPS. Não habilita `sac_submit`,
  Docker privilegiado, auto-merge ou deploy.

Ver issue [#41](https://github.com/Softdown-prog/Data_libray/issues/41).

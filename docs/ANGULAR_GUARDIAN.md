# Angular Guardian — rollout planejado

## Localização e estado

- Fonte do pacote: `packages/angular-guardian/` neste repositório.
- Supervisor atual: `scripts/vps_daemon.py` (VPS, `data-library-worker.service`), com fila local documentada em `docs/WORKER_VPS.md`.
- CI da biblioteca: `.github/workflows/validate-library.yml`. O Guardian possui seu próprio CI, que não é mecanismo de acionamento do daemon.
- Execução de navegador: **somente laboratório GitHub Actions neste primeiro marco**. A execução na VPS, a comunicação GitHub↔VPS e a publicação NPM ainda não foram implantadas.

## Marco 1 — Fundação (este PR)

1. Criar pacote NPM privado `@softdown/angular-guardian` com contrato JSON versionado.
2. Executar cenários DOM reais com Playwright Chromium em servidor HTTP local.
3. Falhar de forma conservadora: erro, timeout, seletor ausente ou browser indisponível nunca equivalem a aprovação.
4. CI executar prova positiva e negativa: uma interface correta passa e uma interface quebrada é reprovada.
5. Não modificar serviço systemd ou instalar Chromium no host multiprojetos.

## Marco 2 — Projetos Angular reais

1. No projeto consumidor, compilar Angular para produção e servir **somente** o `dist`/bundle compilado em porta local, numa sandbox isolada sem acesso à rede interna da VPS.
2. Configurar contrato versionado por projeto e protegido de alterações oportunistas no mesmo PR: rotas, cliques, HUD, estoque, autenticação simulada, atualizações reativas e layout mobile.
3. Executar Guardian em Chromium real e anexar logs/artefatos associados ao SHA de origem.
4. Acrescentar testes de componentes (TestBed/Vitest), screenshots com baseline revisada, traces e testes de rede.

## Marco 3 — Portaria de deploy

1. Adicionar ao One Worker um tipo de tarefa fixo, sem shell arbitrário e com allowlist de repositórios e SHA exato.
2. O runner do Guardian executa em container descartável com recursos limitados, sem credenciais de produção, acesso Docker privilegiado ou acesso aos serviços de outros projetos.
3. Resultado assinado/autenticado vinculado a repositório, SHA, artefato, versão do contrato e versão do Guardian.
4. O GitHub CI registra uma verificação obrigatória por SHA; o mecanismo de deploy **também** verifica o atestado antes da promoção. Em caso de `fail`, `unverified` ou `infra-error`, a promoção é bloqueada.
5. Rollback só no **artefato publicado** para a última versão saudável, nunca `git reset --hard`/force-push na `main`.

## Separação de escopos

O banco do painel/VPS é infraestrutura multiprojetos. O serviço da Data Library atualmente persiste em JSON/JSONL; eventual banco para resultados do Guardian deve ter credenciais e schema exclusivos. Não presumir que o worker atual já usa MySQL.

**Regra:** compilação Angular não implica qualidade visual; testes DOM não equivalem a cobertura funcional completa; somente checks explicitamente definidos recebem `pass`.

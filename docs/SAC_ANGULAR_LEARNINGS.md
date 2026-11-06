# SAC: aprendizados integrados dos testes oficiais e repositórios públicos

## Diagnósticos oficiais Angular
O Angular oficial distingue análise sintática, typecheck, extended diagnostics,
compilação AOT, testes incrementais e runtime. O SAC não deve reimplementar ngtsc.
O coletor existente de erros TS/NG, em scripts/sac_compiler_evidence.mjs,
continua inalterado. A nova API **collectAngularCompilerWarnings** em
scripts/sac_angular_warning_evidence.mjs reconhece warnings oficiais
[WARNING] TS/NG de uma saída Angular CLI, incluindo processos com exit code 0.

Ela devolve apenas severidade, códigos de diagnóstico, quantidade e
localização conferida contra lista explícita de arquivos, com limite de oito
diagnósticos e 32 KiB de saída. Nunca devolve conteúdo de mensagens nem fontes.

A função recebe saída/exit code do hospedeiro, mas não atesta a sua
autenticidade: **compiler_invocation_verified=false, source_sha_verified=false,
post_status/browser_status=not-run, deployment_authorized=false**. Um exit 0
não prova build válido, ainda menos execução ou deploy.

## O que mostraram os testes
- Angular angular/angular e angular/examples: estudos de ngtsc, diagnósticos
  estendidos, builds incrementais, Signals e SSR. Exigir provas oficiais nas
  fases adequadas, sem duplicar o compilador.
- Chromium, Kubernetes, Rust, Go, TypeScript: amostras Git autenticadas por
  commit mostram limites de cobertura, não builds completos. Ausência de
  go.mod na biblioteca padrão de Go e fontes .ts em repos TypeScript
  representam limites dos adaptadores, não erros do upstream.
- Angular RealWorld no commit d426ec804f7d035c374aa4a1b48ecdb05a03eb02:
  48 TypeScript, 11 HTML, 117 arestas de imports, 18 componentes e
  18 templates observados; uma mutação de RouterOutlet para import type
  foi corretamente detectada por PRE003. PRE001 ficou unverified devido
  a Bun lockfile e instalação de terceiros ausente.
- Imports externos ainda não categorizados e submódulos Git também não
  devem ser registrados como defeitos comprovados da aplicação.

## Próximas microetapas
1. Integrar a coleta de warnings ao host de execução autenticada ngtsc
   com SHA da fonte, pacote instalado, identidade do compilador e artefatos.
2. Ampliar o suporte de lockfile com validação de bun.lock, separadamente,
   sem fingir resolução de pacotes não instalados.
3. Conferir clean build versus incremental para detectar cache obsoleto;
   comparar pós-build e Chromium com contratos explícitos.
4. Rodar build de repositórios externos somente em sandbox de execução
   de código não confiável, sem segredos/credenciais, pinando submódulos.

Sem alterações nos componentes existentes PRE001-PRE005, Worker, VPS ou deploy.

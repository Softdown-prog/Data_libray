# SAC Multistack — Next.js (fixture sintética)

Microetapa da issue #62, seguindo o módulo NestJS e preservando o Angular SAC.

`packages/sac-multistack/fixtures/nextjs` contém uma aplicação Next.js
**de primeira parte**, com App Router, renderização HTML do `/` e rota
`GET /api/health`. O CI instala dependências diretas com versões exatas e
`--ignore-scripts`, sem executar scripts de repositórios externos.

O probe executa os comandos oficiais `tsc --noEmit` e `next build`.
Confirma um erro real `TS2339` inserido temporariamente na página,
restaura a página, faz build de produção e inicia o servidor Next.js com
`next start --hostname 127.0.0.1` em porta efêmera. Valida HTML da página,
HTTP 200/JSON `{"status":"ok"}` e resposta 404 para rota inexistente.

Em uma segunda build, muda apenas a resposta da API para
`{"status":"regressed"}`. O TypeScript e o build **devem passar**,
mas o teste HTTP que exige `status=ok` deve reprovar com o código
factual `api-response-mismatch`. O erro é comprovado pela resposta HTTP
observada, não inferido por compilação ou logs.

Os dois servidores de teste são interrompidos e os arquivos
restaurados no encerramento. Não há navegador nesta microetapa
(`browser=not-run`) nem execução de workspace externo.
O resultado não contém logs, caminhos privados ou dados de usuário,
e `deployment_authorized=false`.

**Limites:** a prova é exclusivamente sintética, executada em runner
GitHub descartável. Para projetos de terceiros ainda serão necessários
snapshot/autenticação de commit, executor Docker/rootless sem rede, limites
de recursos, lockfile das dependências transitivas e testes Chromium.
Não há alteração em VPS, Worker, Painel ou deploy.

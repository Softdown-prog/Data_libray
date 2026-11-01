# SAC-008C — execução auditada opcional de artefatos preparados

**Somente GitHub Actions para testes, sem instalação na VPS.**

O projeto mantém o fluxo GitHub Issue → Actions → SSH/OIDC broker → inbox (SAC-008B). Agora, após `receive_pending`, o One Worker pode, **somente se iniciado com `--sac-inbox --sac-audit`**, selecionar no máximo um job por ciclo e consultar um executor Node instalado e escolhido pela política **do operador**, não pela solicitação.

**Escopo do estágio:** executar SAC-004 em artefato compilado previamente por CI confiável e SAC-005/006 no Chromium isolado. **Este estágio não executa `ng build` e não baixa repositórios na VPS.** Compilação remota de fonte do usuário será o próximo marco depois de homologar sandbox independente para compilação. Não chamar uma aprovação estática de compilação realizada pelo Worker.

A política de execução é separada do allowlist do inbox e externa ao checkout:
```json
{"schema_version":1,"projects":[
 {"project_id":"example-a","profile_id":"angular-root",
  "manifest":"/etc/data-library-worker/auditors/example-a.json"}
]}
```
O manifest aprovado contém, somente em arquivo de operador com permissões restritas, exatamente estes campos: `schema_version`, `project_id`, `profile_id`, `workspace`, `profile_file`, `resources_file`, `receipt_file`, `guardian_file`, `trust_key_file`, `sandbox_image`. Os caminhos são absolutos, estáticos, e não vêm de Issues do GitHub. O executor usa `git rev-parse HEAD` local para conferir o SHA solicitado, valida o comprovante HMAC do CI com `auditPipeline`, e chama `verifyPipelineBrowserSandbox` em Docker sem rede. O segredo permanece no host, não no container.

O resultado `state/sac-results/<job-id>.json` tem só IDs, SHA, estado, cobertura estática/navegador e código seguro. Um `pass` requer **ambos** SAC estático e Chromium isolado aprovados, com `network_isolation:container-network-none`; qualquer erro, falta de artefato, assinatura ou navegador gera falha ou não verificado. `deployment_authorized=false` sempre.

A execução é serializada pelo lock atual do daemon, com timeout e limite de tentativas. Não aceita shell, container image, paths, scripts, Git URLs ou comandos no job. Arquivos de resultado são imutáveis/idempotentes e não sobrescrevem valores conflitantes. O Worker precisa ter permissões mínimas para o runner/container; **não dar Docker socket ao Worker sem análise/homologação explícita**, e jamais compartilhar credenciais com o Chromium.

**Limitações:** o runner requer CI confiável que prepare dist, perfis, fontes/recibo e snapshot do projeto antes do processamento; não implementa sincronização automática nem prova da origem remota do checkout. `git rev-parse` não garante que os arquivos monitorados estejam limpos; a cobertura de `sourceFiles` é declarada pelo host SAC-004. Timeout do supervisor mata o grupo Node mas não comprova encerramento de daemon Docker em toda falha possível; requer limpeza/observabilidade na implantação. Sem merge, sem VPS e sem habilitação em systemd.

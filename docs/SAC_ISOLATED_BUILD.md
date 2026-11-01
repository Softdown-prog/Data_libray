# SAC-008D — compilação Angular confinada (prova offline no Actions)

Este pacote apresenta `isolatedAngularBuild`: pré-requisito técnico para o One Worker gerar `dist` com `ng build` de projetos autorizados sem executar código-fonte Angular diretamente no host.

**Separação de responsabilidades:** o GitHub Actions/SSH-OIDC admite o job v1; o One Worker escolhe, usando política do operador, o checkout, perfil e o nome canônico de projeto Angular. A função aceita somente parâmetros deste operador confiável, **não JSON de Issue**, não tem `git clone`, `npm install`, deploy, API ou shell. O passo de preparação da dependência usa `npm ci --ignore-scripts` em CI descartável; **não é habilitado na VPS**.

O build monta somente um snapshot temporário de fontes enumeradas pelo host (incluindo `package.json`, `angular.json`, `package-lock.json`) e dependências já instaladas em modo read-only. A imagem fixa por SHA256 é a imagem Playwright/Node usada no SAC-006; networking `none`; UID/GID não-root do usuário executor do host (falha fechada se for root); filesystem root readonly, todas as capabilities descartadas, no-new-privileges, limites CPU 1, RAM 1024 MiB sem swap extra, PID 128, /tmp limitado. O comando é fixo `node node_modules/@angular/cli/bin/ng.js build <nome-registrado>`, sem shell.

A saída só é copiada para o `dist` aprovado se o Docker terminar com sucesso e o output contiver arquivos regulares limitados: sem symlinks, sem dispositivos, máximo 4096 arquivos ou 64 MiB. O destino não pode existir. Os erros são códigos estáveis, sem stdout/stderr do build. `deployment_authorized=false` em todos os resultados.

**Limitações atuais**: ainda não há conexão deste builder ao `sac_supervised_runner.mjs` nem ao daemon do One Worker. A prova inicial testa o contrato de isolação, sem execução operacional. Para homologação futura: preparar/sanitizar node_modules em CI confiável; garantir propriedade de diretórios, limpeza de containers mortos, não conceder socket Docker irrestrito ao Worker multiprojetos; limitar resource sourceFiles/artefatos e impedir acesso a segredos; vincular SHA remoto à revisão local; executar preflight/build/post/Guardian sob o mesmo identificador de job. Controles Docker reduzem risco, mas **Docker daemon/root é TCB, não uma sandbox de segurança completa contra código hostil**.

Sem merge, deploy ou acesso à VPS.

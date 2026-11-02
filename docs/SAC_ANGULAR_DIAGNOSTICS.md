# SAC - Relatorio de diagnostico Angular (v1)

Objetivo: converter evidencias do pre-compilador, build, pos-compilador e Guardian em um relatorio curto e util para o ChatGPT recuperar pelo GitHub Actions.

O modulo scripts/sac_diagnostic_report.mjs produz um JSON com schema_version=1, status, checks (pre/build/post/browser), findings (no maximo oito), truncated, location_verified=false e deployment_authorized=false. Cada finding inclui phase, status, code, assertion quando existente, title e next_step em portugues.

As recomendacoes sao selecionadas de um catalogo estatico de mensagens. Nenhuma mensagem bruta de erro, arquivo arbitrario, numero de linha, stdout, segredo, URL, conteudo-fonte, chave HMAC ou caminho absoluto entra no relatorio. Se o codigo ou identificador nao for valido, ele e substituido por um identificador neutro. location_verified=false deixa explicito que o diagnostico ainda nao identificou arquivo/linha.

O script sac_supervised_runner.mjs agora anexa diagnostic ao resultado real de SAC/Guardian. O supervisor Python em scripts/sac_execution.py valida esse campo antes de gravar em sac-results. Relatorios legados sem diagnostic continuam aceitos.

Os testes simulam falhas de TypeScript, compilacao, pos-compilacao, bootstrap e interacao Angular, incluindo casos que tentam injetar credenciais, caminhos privados ou status de sucesso. Em caso de resultado de navegador sem comprovacao de sandbox sem rede, o diagnostico permanece unverified, nunca pass.

Nao ha novas APIs, serviços, containers, acesso a VPS, Codex ou autorizacao de deploy. A consulta desse campo pelo Painel sera integrada separadamente apos os testes; a ponte Actions/SSH-OIDC continua em PR draft e nao esta homologada na VPS.

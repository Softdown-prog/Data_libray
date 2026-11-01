# Angular Guardian — base experimental

Pacote NPM **privado** (ainda não publicado) para fiscalizar a interface de um frontend compilado antes de promover o deploy. Este é um **primeiro módulo isolado**; ele não altera o One Worker, não executa comandos do GitHub e não instala nada na VPS.

## Política inicial

- Só conecta via HTTP a `localhost`, `127.0.0.1` ou `::1`. O frontend precisa ser compilado e servido localmente antes de rodar o Guardian.
- O contrato JSON declara somente rotas, seletores visíveis e cliques com resultado esperado. Não aceita shell, expressões JavaScript ou código remoto.
- Cada cenário usa uma página nova. Erros de JavaScript (`pageerror`), erros de console e HTTP 5xx detectados durante o cenário reprovam a avaliação. Falha ao iniciar Chromium produz `infra-error` e nunca `pass`.
- Ausência de casos ou de asserções é inválida. Sem uma especificação verificável, o Guardian não afirma que o frontend está correto.
- `pass` significa **somente** que o contrato executado passou, não que todo o app está sem bugs.

## Rodar com um aplicativo já compilado

Node.js 22+ e o Chromium do Playwright são necessários:

```bash
cd packages/angular-guardian
npm install
npx playwright install chromium
node bin/guardian.mjs verify \
  --url http://127.0.0.1:4783 \
  --config test/fixture-contract.json \
  --report /tmp/guardian-report.json
```

O endereço de exemplo usa o servidor de demonstração `node test/fixture-server.mjs`, que deve ser iniciado em outro terminal. **Não é um teste do Lan House Simulator.** Para testar um projeto Angular real, substitua o servidor e forneça um contrato próprio contendo seletores estáveis, preferencialmente `data-testid`.

Exit codes: `0=pass`, `1=fail`, `2=infra-error/contrato inválido`. O JSON é adequado a uma futura integração com o supervisor e com uma verificação obrigatória no GitHub.

## Separação de responsabilidades

- Biblioteca guarda e testa o pacote Guardian.
- One Worker da VPS (`scripts/vps_daemon.py`) continua cuidando dos exemplos do catálogo e **ainda não invoca este pacote**.
- Uma fase posterior adicionará tarefas `angular-app` aprovadas explicitamente, execução em container temporário com limites, armazenamento de evidências, transmissão de resultados autenticados e bloqueio real do deploy por `required status check`.

O mecanismo não faz rollback, correção autônoma nem escreve na `main` na v0.1.

# SAC Capability Evidence — observação de comprovantes (incremento opt-in)

O SAC Core já possui `profile.capabilities` e `RuleRegistry.capabilities(profile)`.
Esses campos **declaram condições de aplicabilidade**, não comprovam execução ou
autorizam deploy. O novo adaptador
[`packages/angular-guardian/src/capabilities.mjs`](../packages/angular-guardian/src/capabilities.mjs)
observa os resultados produzidos pelo **pipeline e pelo Guardian realmente
invocados no mesmo processo**, sem aceitar como prova uma flag arbitrária
`passed: true` de um arquivo JSON.

## Fluxo e fronteiras de confiança

1. `RuleRegistry.capabilities(profile)` lista as declarações e requisitos.
2. `verifyPipelineBrowser({pipeline,guardian})` chama novamente
   `auditPipeline()`, que verifica o preflight, a autenticação HMAC do
   comprovante do host, o digest do artefato e o postflight.
3. O Guardian somente é iniciado após a aprovação do pipeline estático. O
   adaptador distingue o worker Chromium integrado de `runBrowser`
   fornecido diretamente pelo host para testes.
4. Um resultado válido é resumido em quatro observações: `preflight`,
   `authenticated_build_claim`, `postflight` e `guardian_contract`.

A API de demonstração, para o **host confiável** que detém os recursos do
projeto, o contrato Guardian e a chave do comprovante:

```js
import {observeSACCapabilityEvidence}
  from './packages/angular-guardian/src/capabilities.mjs';

const {capabilities,result}=await observeSACCapabilityEvidence({
  pipeline:{profile,resources,receipt,key,sourceSha},
  guardian:contract
});
console.log(capabilities);
// result é o relatório completo do mesmo ciclo de auditPipeline + Guardian.
// capabilities contém apenas categorias, enumerações e declarações públicas.
```

**Não usar contratos/relatórios vindos de entradas não confiáveis como
atestado.** O adaptador reexecuta verificações no host, mas sua saída JSON
**não é assinada** e não deve ser aceita por outro serviço como um token
de autorização. Para uso remoto será necessário comprovante assinado, ligação
à revisão e política de CI/serviço confiável. Não se adicionou nenhuma
permissão ao One Worker, à VPS ou ao deploy.

| Evidência observada | Escopo exato | O que **não** comprova |
| --- | --- | --- |
| `preflight: observed-pass` | Metadados instalados npm, peers e engines passaram no SAC-PRE001 | Todas as ferramentas do host estão instaladas |
| `authenticated_build_claim: authenticated-host-claim` | HMAC do host válido, associação de fonte/artefato e digest conferidos | Que o comando `ng build` ou `ngc` necessariamente foi executado |
| `postflight: observed-pass` | Regras estáticas obrigatórias do artefato passaram | Que a aplicação roda corretamente no navegador |
| `guardian_contract: observed-contract-pass` | Worker Chromium integrado passou nos casos previstos do contrato | Que todo o produto foi testado, que há sandbox de rede externo ou que o deploy é seguro |
| `guardian_contract: caller-runner-claimed-pass` | `runBrowser` fornecido pelo chamador declarou sucesso | Execução real do Chromium pelo SAC |

### Invalidação após o navegador

O Guardian executa um **novo** `auditPipeline()` depois dos testes no navegador.
Se os arquivos-fonte ou o artefato compilado mudarem entre as duas auditorias,
o pipeline gera `artifact-mutated-during-browser` e reprova o navegador. Nesse
cenário, a antiga observação de build e postflight **não** pode continuar
indicando a validade *atual* do artefato.

O adaptador marca ambas as observações como
`invalidated-after-browser`, ainda que a primeira auditoria tenha sido
aprovada. A verificação anterior dos metadados de dependências permanece uma
observação separada (`preflight: observed-pass`), sem autorizar nada.
Uma falha de interface **sem** alteração do artefato continua preservando
corretamente a evidência estática anterior e reprovando apenas o Guardian.

Fixtures específicas alteram, dentro de um runner sintético,
o bundle compilado e o arquivo-fonte entre as auditorias. Em ambos os casos o
sistema comprova a invalidação e mantém `deployment_authorized:false`.
Esse teste de mutação não equivale a uma simulação de produção; o workflow
oficial também executa a fixture com Chromium real.

O JSON mantém `status:unverified`,
`tool_installation_verified:false`,
`angular_cli_execution_verified:false`,
`official_aot_verified:false`,
`full_runtime_verified:false` e `deployment_authorized:false`.
O preflight aprovado pode declarar
`angular_toolchain_metadata_verified:true`, mas isso não transforma uma
declaração de capability em prova de execução do Angular CLI.

O Angular CLI oficial **já está instalado para a fixture** em
`packages/angular-postcompiler/smoke` (`@angular/cli@22.0.0`).
O host do teste usa o executável local
`node_modules/@angular/cli/bin/ng.js build smoke`, com argumentos fixos.
O módulo de Capabilities não executa nem aceita comandos do perfil.

## Regressões

```bash
npm ci --prefix packages/angular-core --ignore-scripts --no-audit --no-fund
npm ci --prefix packages/angular-precompiler --ignore-scripts --no-audit --no-fund
npm ci --prefix packages/angular-postcompiler --ignore-scripts --no-audit --no-fund
node --test packages/angular-guardian/integration/capabilities.test.mjs
```

As fixtures verificam perfil inválido, ausência/falsificação do receipt,
mutação do artefato, ausência de contrato de navegador e runner sintético.
O workflow `angular-browser.yml` executa também uma **fixture Angular
compilada com CLI oficial e testada pelo Chromium real**, conferindo o
relatório resumido do adaptador no cenário positivo. Não foi alterado o
schema dos perfis nem o formato existente de `verifyPipelineBrowser()`.

**Sem merge, deploy, alteração da VPS ou integração com o PR #54 do Dependabot.**

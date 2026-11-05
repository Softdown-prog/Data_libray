# SAC Core 0.1 — motor universal de regras

Registro e executor aditivos para fases `pre`, `post`, `browser` e `deploy`.
O core não chama compiladores, navegadores ou serviços. O adaptador SAC-P001 é
opt-in e usa o verificador existente sem modificar sua API/CLI/contrato/JSON.
Pacote privado, Node >=22; checkout monorepo requerido para o adaptador.

```bash
npm ci --prefix packages/angular-postcompiler --ignore-scripts
npm ci --prefix packages/angular-core --ignore-scripts
npm test --prefix packages/angular-core
node packages/angular-core/examples/matrix.mjs > matrix.json
```

## Integração por consumidor

O host confiável lê o perfil declarativo e fornece os recursos separadamente:

```js
import { readFile } from 'node:fs/promises';
import { RuleRegistry, execute } from './packages/angular-core/src/index.mjs';
import { registerSACP001 } from './packages/angular-core/src/sac-p001.mjs';

const registry = registerSACP001(new RuleRegistry());
const profile = JSON.parse(await readFile('profile.json', 'utf8'));
const report = await execute({
  registry, profile,
  resources: { dist: '/workspace/candidate/browser' },
  analysis: {},
  limits: { timeoutMs: 5000, totalMs: 30000 }
});
console.log(JSON.stringify(report, null, 2));
// O chamador decide sua política; o core não faz promoção ou deploy.
process.exitCode = report.promotion_allowed ? 0 : 1;
```

Perfil completo em [examples/profile.json](examples/profile.json); schema Draft-07
em [schemas/profile.v1.json](schemas/profile.v1.json), validado com Ajv estrito.
Todos os campos são obrigatórios e campos desconhecidos são rejeitados:

| Campo | Semântica v1 |
| --- | --- |
| schema_version | Exatamente 1 |
| profile_id | Identificador público seguro, sem nome de produto obrigatório |
| angular_version | Versão exata declarada pelo consumidor; null para non-angular. Não autodetecta versão instalada |
| capabilities | Lista explícita, como angular, static-dist, workspace; sem inferência por repositório |
| mode | angular-only, hybrid ou non-angular |
| mount | Caminho público absoluto terminado em /, sem traversal, query ou URL |
| bundle_hints | null quando sem artefato; contrato de index/host/entrypoints/assets/React para static-dist Angular |
| rules | IDs e versões exatas selecionadas, required booleano e enforcement blocking/observe |

`bundle_hints` segue os campos do SAC-P001, excluindo schema_version/mode.
Paths são relativos ao artefato. Perfil Angular sem static-dist pode omitir hints
usando null, por exemplo para preflight. Perfil non-angular exige versão/hints
null e não pode declarar capability angular. Dependências devem estar registradas
e explicitamente selecionadas; o core nunca ativa regras silenciosamente.

## Módulo Capabilities — declarações, elegibilidade e provas

O SAC **já utilizava capabilities** como requisitos de perfil (por exemplo,
`angular`, `workspace` e `static-dist`). O módulo
[`src/capabilities.mjs`](src/capabilities.mjs) acrescenta uma visão **somente
leitura** das capacidades declaradas e do motivo de cada regra selecionada ser
elegível ou não. Ele compartilha com `execute()` a mesma função pura de
elegibilidade, evitando divergências entre explicação e comportamento.

```js
import {RuleRegistry} from './packages/angular-core/src/index.mjs';
import {registerSACPRE001} from './packages/angular-precompiler/src/register.mjs';

const registry=registerSACPRE001(new RuleRegistry());
const report=registry.capabilities({
  schema_version:1,profile_id:'candidate',angular_version:'22.0.0',
  capabilities:['angular','workspace'],mode:'angular-only',mount:'/',
  bundle_hints:null,
  rules:[{rule_id:'SAC-PRE001',version:'1.0.0',
    required:false,enforcement:'observe'}]
});
// report.selected_rules[0].eligibility === 'eligible-by-profile'
// report.tool_installation_verified === false
// report.angular_cli_execution_verified === false
// report.deployment_authorized === false
```

O status `eligible-by-profile` **não** significa que a regra foi executada,
que o Angular CLI foi instalado, que o AOT passou ou que há permissão de
publicar. `not-applicable` informa capabilities ausentes, modo diferente ou
major incompatível. Regra não registrada ou versão divergente fica `unverified`.
Relatórios são determinísticos, limitados às regras selecionadas, sem incluir
código, descrição de regra, recursos, tokens ou logs. O schema do perfil v1 não
foi alterado; nenhum recurso é ativado automaticamente.

O Angular CLI oficial **já é executado** na fixture
[`angular-postcompiler/smoke`](../angular-postcompiler/smoke):
`@angular/cli@22.0.0` está fixado no manifesto, e o host confiável chama
`node_modules/@angular/cli/bin/ng.js build smoke`. O próprio Core só verifica
metadados e aplica regras; não executa comandos `ng`. Para afirmar que um
build funcionou, continua indispensável a evidência independente do workflow
AOT/Guardian. O PR do Dependabot que mistura versões Angular deve permanecer
separado até compatibilização e reteste.

## API de regras

`new RuleRegistry().register(descriptor)` retorna o registro. IDs únicos; versões
exatas. Registro vazio não ativa regras por padrão. Cada descriptor inclui:

- rule_id, version, phase, description e severity (error/warning);
- applies_when: capabilities necessárias (AND), modes permitidos (OR; vazio = todos),
  angular_majors permitidos (OR; vazio = qualquer versão);
- dependencies: IDs; inputs: nomes dos recursos necessários;
- assertions: códigos obrigatórios para comprovar pass;
- test_fixtures e source_incidents: identificadores públicos rastreáveis;
- run({ profile, resources, analysis, signal }): retorna { status, evidence }.

Cada evidência tem assertion, status e code, com códigos públicos curtos.
A saída descarta campos extras e não serializa perfil, caminhos absolutos,
recursos, análises, mensagens de exceção, logs ou objetos arbitrários do plugin.
Regras confiáveis devem usar códigos constantes e jamais codificar segredos nos
identificadores. O adaptador reduz evidências legadas a asserções/status/códigos;
para detalhes de arquivos, use separadamente a CLI legada do SAC-P001.

`TEST-DUMMY` existe somente em test/helpers.mjs e comprova registro externo sem
alterar dispatcher; não é exportada, registrada nem ativa na implementação.
A ordenação topológica desempata IDs por ordem lexical de caracteres, sem locale,
independente da ordem de registro/seleção. Dependência sem pass impede executar a
regra dependente (unverified). Metadata é copiada/congelada no registro.

## Relatório e cobertura

JSON v1 determinístico para as mesmas entradas/resultados, com profile_id,
results por regra (ID/versão/fase/required/enforcement/status/evidências), coverage,
diagnostics, status agregado e promotion_allowed. `duration: null` declara que
medição por regra não é publicada nesta versão para preservar determinismo;
relógio monotônico interno serve apenas aos limites. Timeout pode naturalmente
alterar resultados quando a carga varia.

`pass` exige evidência pass para todas as assertions declaradas. Falta de evidência
ou evidência contraditória retorna unverified. Erro/má formação de resultado é
infra-error, sem expor sua exceção. Perfil/registro/plano inválido retorna fail
antes de executar qualquer regra.

- not-applicable não entra como teste aprovado; capability/modo/versão incompatível
  gera evidência explícita e nenhuma execução.
- Regras required só satisfazem cobertura com pass e enforcement blocking.
  Required com fail/unverified/infra-error/not-applicable/observe bloqueia aprovação.
- Regras opcionais blocking podem bloquear por fail/unverified/infra-error.
  Opcionais observe aparecem integralmente, mas não bloqueiam outras verificações.
- Ao menos uma regra required deve ser aprovada para promotion_allowed=true.
  Seleções vazias são inválidas. Sem asserções obrigatórias, não há aprovação
  implícita. Status agregado não substitui promotion_allowed.
- Precedência para verificações bloqueantes: infra-error, fail, unverified.
  Perfil só com opcionais não aplicáveis retorna not-applicable e promoção false.

Esse indicador informa apenas cobertura declarada, nunca qualidade completa de
produção. Checagem estática continua post e jamais vira browser-pass.

## Limites e fronteiras de confiança

Até 256 regras selecionadas; evidências limitadas a 256 por regra por padrão
(máximo configurável 1024); timeout padrão 5 s/regra (máximo 30 s), orçamento total
30 s (máximo 60 s). Campos e arrays do schema são limitados. Executor sequencial,
AbortSignal por regra, sem paralelismo de navegador ou novos servidores.

Regras são módulos JavaScript **confiáveis**, registrados pelo host; o JSON não
escolhe módulos, funções, URLs, shell ou comandos. Timeout é cooperativo: corrida
assíncrona e AbortSignal; detecta sobrecarga síncrona quando a função retorna,
mas não consegue interromper loop infinito nem impor memória/CPU/IO. Uma regra
que ignore cancelamento pode continuar em segundo plano. Para código não confiável,
o host futuro precisará de isolamento de processo/container, fora deste marco.
SAC-P001 legado não recebe AbortSignal e uma leitura pendente pode terminar após
um timeout. Não foi acrescentada promessa de sandbox a esse adaptador.

`analysis` é snapshot geral serializável, copiado e congelado; `resources` é
objeto separado, congelado superficialmente, com recursos particulares do projeto.
Regras não recebem resultados internos mutáveis de outras regras. Nenhum desses
objetos vai para o relatório. O host deve fornecer somente recursos mínimos,
sem credenciais. Não há limites de leitura adicionados ao SAC-P001 legado.

## Evolução e rastreabilidade

1. Reproduzir incidente com fixture mínima independente (defeito/fail e corrigido/pass).
2. Registrar source_incidents, caso limítrofe e falso positivo, descrição, inputs,
   assertions, capabilities, dependências e versão estável. Critério de negócio
   fica em plugin/contrato do consumidor.
3. Registrar a regra externamente e selecioná-la inicialmente com observe;
   revisar evidências/falsos positivos antes de torná-la blocking.
4. Alterações de contrato pedem nova versão e testes de compatibilidade.

Futuras pré-análises (AST, índices de arquivos, manifestos) podem ser preparadas
uma vez pelo host e passadas em analysis, sem reler entradas em cada camada.
Cache não implementado: chave futura precisa incluir SHA do artefato/projeto,
versões das regras, perfil normalizado e versão da análise; invalidar ao mudar
qualquer entrada. Guardian, precompiler, hashes de publicação e deploy ficam
para camadas futuras.

## Evidências sintéticas

| Perfil | Íntegro | Entry removido | Host incorreto |
| --- | --- | --- | --- |
| SPA raiz | pass | fail | fail |
| SPA subpath | pass | fail | fail |
| Angular/React hybrid | pass | fail | fail |
| Estático non-angular | not-applicable | — | — |

A matriz JSON reproduz esses casos em diretórios temporários e limpa os arquivos.
Nenhum projeto real é importado. CI mantém os 59 testes anteriores e smoke oficial
Angular 22, além dos testes do core e compatibilidade byte a byte da CLI.
As fixtures sintéticas são estáticas e não comprovam runtime Angular/React.

# SAC-003 — Angular Precompiler / SAC-PRE001

Preflight universal **somente leitura**, registrado externamente no SAC Core 0.1.
A regra `SAC-PRE001` v1.0.0 prova compatibilidade do toolchain instalado, antes do
Angular oficial. Não substitui `ngtsc`, não compila, não corrige arquivos e não
ativa deploy. Node >=22; pacote privado, sem publicação.

```bash
npm ci --prefix packages/angular-core --ignore-scripts
npm ci --prefix packages/angular-precompiler --ignore-scripts
npm test --prefix packages/angular-precompiler
```

Esses comandos são executados pelo desenvolvedor/CI. A API do verificador não
instala dependências, importa JS do workspace, executa scripts nem faz rede.

## Integração segura pelo host

```js
import { RuleRegistry, execute } from './packages/angular-core/src/index.mjs';
import { registerSACPRE001 } from './packages/angular-precompiler/src/register.mjs';
import { verifyWorkspace } from './packages/angular-precompiler/src/index.mjs';

const workspace = '/workspace/candidate'; // recurso local escolhido pelo host
const profile = {
  schema_version: 1, profile_id: 'candidate', angular_version: '23.1.0',
  capabilities: ['angular', 'workspace'], mode: 'angular-only', mount: '/',
  bundle_hints: null,
  rules: [{ rule_id: 'SAC-PRE001', version: '1.0.0', required: false, enforcement: 'observe' }]
};
const registry = registerSACPRE001(new RuleRegistry());
const report = await execute({ registry, profile, resources: { workspace } });
console.log(JSON.stringify(report, null, 2));
// Para evidência detalhada segura das versões (não há logs/scripts/URLs):
const inspection = await verifyWorkspace({ workspace, angularVersion: profile.angular_version });
console.log(JSON.stringify(inspection, null, 2));
```

A versão do exemplo é alegação do consumidor, conferida contra `@angular/core`
instalado. Nenhuma versão específica é imposta pela regra. Registro seleciona
phase `pre`, capabilities `angular` **e** `workspace`, modos angular-only/hybrid,
sem restrição de major. Sem capabilities, o Core retorna not-applicable sem ler
recursos. A demonstração usa observe: `results[0].status` pode ser pass enquanto
o agregado continua unverified e `promotion_allowed=false`, por não haver
cobertura bloqueante obrigatória. Não há gate de produção ativado.

Ordem recomendada ao host: **preflight → compilador Angular oficial → postflight
SAC-P001 → Guardian posterior**. O core não executa comandos dessas etapas.
Para um consumidor ligar regras numa mesma execução, dependências continuam
explícitas no registro; não foi criada dependência global que quebre P001 isolado.

## Workspace, aplicação e resolução

`resources.workspace` delimita a raiz confiável de leitura. Para app sob essa
raiz, passe `resources.project: 'apps/example'`; o caminho é opcional e relativo,
sem traversal/URL/shell. Pode também passar o próprio subapp como workspace:
nesse caso não há busca em diretórios pais externos.

O resolvedor lê caminhos fixos `package.json` ao longo dos ancestrais internos,
sem varredura recursiva de node_modules. `@angular/compiler-cli` e `@angular/core`
são resolvidos pela aplicação; `typescript` e `@angular/compiler` usados pelo
compilador são resolvidos pelo issuer compiler-cli, conforme resolução local
padrão do Node (realpath). Isso evita confundir TS do aplicativo com a cópia que
`ngtsc` usará. A cópia do app também é conferida contra sua própria declaração e
lock, mesmo quando difere da cópia do compiler-cli. Não é executado o entry JS
nem verificado o comportamento de flags como preserve-symlinks/package loaders.

- Subapp com lock próprio fica isolado das declarações/engines da raiz.
- npm workspace com dependências hoisted usa a raiz somente com filiação
  comprovada: `workspaces` da raiz corresponde ao app e o lock tem sua entrada.
  São aceitos padrões literais e segmentos inteiros `*`/`**` (zero ou mais
  segmentos); globs parciais, negações, braces/extglobs não são expandidos e a
  filiação não comprovada fica unverified.
- Declarações locais prevalecem sobre fallback da raiz. No mesmo manifesto,
  optionalDependencies sobrescreve dependencies/devDependencies para o nome.
  Conflitos remanescentes entre dependencies/devDependencies são conservadoramente
  verificados contra ambas as faixas.
- Suporta npm package-lock ou npm-shrinkwrap v2/v3 pelo objeto `packages` e caminho
  exato de cada instalação; shrinkwrap tem precedência npm. O lock mais próximo
  prevalece. Lock v1, pnpm/yarn, links sem versão e formatos desconhecidos ficam
  unverified. Não se busca node_modules acima da raiz confiável.

## O que é comprovado

São necessários metadados locais válidos dos quatro pacotes core, compiler-cli,
compiler e TypeScript. CLI/build também são conferidos quando declarados.
A biblioteca semver interpreta ranges reais (incluindo OR/caret/tilde/prerelease),
sem tabela Angular/TypeScript/Node copiada da documentação.

| Asserção | Evidência |
| --- | --- |
| workspace-metadata | package.json local; angular.json/tsconfig.json quando presentes, com leitura confinada/limitada |
| installed-resolution | nomes/versões dos pacotes efetivamente localizados; peers do CLI têm issuer próprio |
| declared-resolution | ranges semver declarados versus instalação resolvida pela aplicação |
| lockfile-resolution | versões exatas do lock versus instalações do app e do compilador |
| typescript-peers | TypeScript resolvido pelo CLI satisfaz peerDependencies.typescript instalado |
| angular-peers | constraints Angular publicadas conectam core ao compiler-cli, normalmente via compiler; peers instalados opcionais também são avaliados |
| node-engines | runtime Node satisfaz engines.node dos pacotes, de ambas as instalações e manifestos do escopo aplicável |
| profile-version | versão declarada no perfil coincide com core instalado |

Uma cópia extra de peer Angular também precisa estar no lock e satisfazer engines;
resoluções de versões Angular divergentes permanecem unverified se não houve
incompatibilidade comprovada primeiro. Mesmas versões de pacotes, sem relação de
peers publicada, não provam compatibilidade. Ranges npm alias/file/git/catalog/
workspace não são tratados como faixas semver; ficam unverified. Não há auditoria
completa de todos os peers transitivos (rxjs, zone.js etc.), lock integrity/hashes,
package exports, fontes ou opções Angular/TS. `angular.json`/`tsconfig.json` são
lidos como dados opacos; JSONC não é falsamente rejeitado e extends/plugins não
são seguidos. Diagnóstico de conteúdo/configuração pertence ao Angular oficial.

## Relatórios e status

`verifyWorkspace({workspace, project, angularVersion, signal})` retorna JSON
estável v1 com rule_id, status, evidence (assertion/status/code) e resolution.
Para cada nome fixo de pacote, resolution separa:

- `declared`: source project/workspace e faixa semver normalizada;
- `declared_installed_version` / `declared_locked_version`: instalação do app;
- `installed_version` / `locked_version`: instalação efetiva do toolchain;
- `node_engine`, `declared_node_engine`, `peer_ranges`: apenas semver normalizado;
- `resolution.node_version`: runtime observado, nunca assumido do perfil.

Sem timestamps, paths absolutos, resolved URLs, conteúdo de config, scripts,
nomes arbitrários de projeto, tokens ou mensagens brutas de exceção. O adaptador
Core mantém as evidências resumidas de códigos e status, conforme API existente.
Null indica dado não comprovado. Precedência: infra-error > fail > unverified > pass.
Nenhuma falta de asserção vira aprovação implícita.

Incompatibilidade de peer/engine/declarado versus instalado/perfil é fail;
ausência de pacotes/campos, lock ausente/drift, JSON inválido ou resolução não
suportada é unverified; falha inesperada de filesystem/abort é infra-error.
Traversal ou symlink escapando da raiz é fail antes de ler o alvo. not-applicable
é atribuído pelo Core, não simulado como pass pelo verificador direto.

## Segurança e limites

Até 4 MiB por arquivo, 24 MiB totais e 128 tentativas de leitura (cache de paths),
profundidade de projeto 16 segmentos e busca limitada em ancestrais. Excesso fica
unverified. Arquivos devem ser regulares; abertura não bloqueante impede aguardar
FIFO. AbortSignal é checado entre operações/leituras; o Core mantém timeout
cooperativo. Nada impõe sandbox de CPU/memória para módulos externos.

Realpath + confinamento são conferidos antes de abrir os arquivos. Symlink dentro
da raiz é permitido; root symlink escolhido explicitamente pelo host define sua
raiz canônica. Há limite **TOCTOU** entre realpath e abertura: use workspace local
imutável, não diretório que outro processo possa trocar enquanto é analisado.
Metadados locais são alegações dos módulos instalados, não prova criptográfica de
proveniência nem prova de que o código não foi adulterado. Nenhum JS local é
importado/executado, nenhum segredo é procurado e não há fetch/download/shell/write.

## Testes e falsos positivos

Fixtures sintéticas independentes cobrem toolchain compatível, peers incompatíveis,
perfil incorreto, instalação ausente, root/subapp com versões/locks diferentes,
npm hoisting, cópias distintas por issuer, scopes de engines, traversal/symlinks,
cancelamento, limites e ausência de vazamento. Falsos positivos explícitos incluem
optionalDependencies, peer optional instalado, ranges OR/prerelease e tsconfig JSONC.

CI instala o Angular oficial somente na fixture já existente de SAC-P001. Antes
de seu `ng build`, `examples/official.mjs` exige preflight pass e registra a regra
em observe no Core; gera `sac-pre001-official.json`. Depois executa o smoke AOT
positivo/negativo de P001. Instalação/build pertencem ao host CI e não à regra.
Os 59 testes P001, 57 Core 0.1 e os 9 jobs Validate code library são preservados.
Não se alega sucesso de bootstrap/DOM/navegador; Guardian não é acionado.

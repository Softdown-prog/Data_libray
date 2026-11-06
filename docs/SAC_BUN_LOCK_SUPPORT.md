# SAC-PRE001 — suporte conservador ao Bun text lock v1

O angular-realworld-example-app utiliza bun.lock textual em JSONC com comentários
e vírgulas finais. O leitor bun-lock.mjs interpreta esse formato por leitura
limitada; não importa scripts, não executa Bun e não acessa a rede.

É suportado o workspace raiz de versão 1 e registros de pacotes de registro
nome@semver, confrontados com as declarações de package.json.
Sem dependências instaladas, a análise permanece unverified.

Monorepositórios Bun, cópias aninhadas, aliases, versões não semver,
pacotes git/file/tarball, arquivo binário bun.lockb e conflitos entre
lockfiles permanecem unverified até termos evidência oficial suficiente.

O reconhecimento do formato não substitui validação de engine Node,
pares Angular/TypeScript, autenticidade do build, testes de navegador
ou proveniência dos artefatos. Nenhuma execução de projeto de terceiro
ou autorização de deploy é adicionada.

## Prova no RealWorld original (sem executar o aplicativo)

O workflow `sac-realworld-pinned.yml` também inspeciona o `bun.lock`
real da revisão fixada `d426ec8` do Angular RealWorld. Ele exige
`resolution.lockfile_format=bun-text-v1` e `status=unverified`, pois
as dependências do aplicativo não são instaladas no runner.
A evidência não mais identifica erroneamente um lockfile existente como
`lockfile-missing`. Isso não comprova build, runtime ou instalação Bun.

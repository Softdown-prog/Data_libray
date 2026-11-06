# SAC Multistack — 13 módulos independentes (fase inicial)

A arquitetura Angular SAC/PRE/POST/Guardian existente permanece intacta.
Esta fase adiciona perfis declarativos e um pré-verificador read-only para
**Alpine.js, Vue.js, NestJS, Python, JavaScript, CSS, HTML5, React,
Next.js, Astro, Rust, C++20 e Go** em
`packages/sac-multistack/profiles/`.

Os perfis têm requisitos de dependência/manifesto, extensões de fonte
admitidas e ferramentas de verificação por fase. O preflight aceita
somente arquivos declarados pelo operador e protege contra symlinks,
caminhos de escape, `.env`, `node_modules`, limites de tamanho e
arquivos inexistentes. Não lê ou executa scripts de `package.json`.

## Contrato

O `inspectModule` retorna `preflight.status=pass` quando esses
pré-requisitos estáticos foram comprovados. O `status` do resultado
**continua `unverified`**: cada gate (sintaxe, tipos, build, testes,
browser) é explicitamente `not-run`, e `runtime_verified` e
`source_sha_verified` são sempre `false`.
Uma falha de dependência ou arquivo produz `preflight.status=fail`.
Isso não equivale a compilar nem a identificar todos os problemas do projeto.

Exemplo de requisição local, em arquivo JSON com campos exatos:
```json
{
  "module_id": "vue",
  "workspace": "/home/ci/workspace",
  "source_files": ["src/App.vue"]
}
```

```bash
node packages/sac-multistack/bin/inspect.mjs --request request.json
```

O CLI retorna código 3 quando há somente preflight aprovado ou inconclusivo,
código 1 quando o preflight reprova e código 2 para requisição inválida.
Código 0 fica reservado para uma futura auditoria completa realmente verificada.

O retorno não contém arquivos-fonte, linhas, mensagens livres, variáveis,
segredos ou caminhos do host. Os módulos jamais recebem comandos de
`package.json` como instruções executáveis.

## Validação real e limitações

O CI da fase inicial comprova erros *sintéticos* e execução de toolchains
nativas: Python (AST/py_compile), JS (Node --check), Go (go compiler),
Rust (rustc) e C++20 (g++). Esses testes usam apenas arquivos artificiais
da própria suite; **não aprovam projetos externos**.

HTML5/CSS/Alpine.js demandam validadores de padrões e Chromium.
Vue, NestJS, React, Next.js e Astro precisam de seus CLIs oficiais e
testes AOT/DOM/integrados isolados. Os perfis **não marcam esses testes
como aprovados enquanto não foram executados**.

Fases futuras: adaptadores Docker/rootless separados, evidências observadas
com SHA/manifest/budget, cobertura real dos frameworks e integração opt-in
com o Worker. Não há alteração na VPS, no Worker v1, no SAC Angular,
no Painel nem autorização de deploy.

Veja issue #62.

## Probes extras: HTML5 e CSS

O CI descartável também instala as versões **exatas** declaradas em
`packages/sac-multistack/fixtures/package.json` e executa um HTML5 e um CSS
válidos e outros deliberadamente inválidos via HTML-Validate e Stylelint,
sem acessar projetos externos ou executar scripts de instalação.

Essa prova ainda não substitui o Chromium, nem homologa Alpine.js.
A instalação CI inicial ainda usa resolução transitiva por npm; antes de
homologação para produção, congelar o lockfile e revisar o conjunto instalado.

## Provas oficiais iniciais: Vue e React

Fixtures de primeira parte em `packages/sac-multistack/fixtures/ui/` usam
Vue SFC com `vue-tsc` e React TSX com `tsc`, seguidos por build oficial
`vite build` e verificação de `dist/index.html` + bundle JS não vazio.
Cada fixture é primeiro aprovada, depois alterada temporariamente para chamar
um método inexistente; o teste exige erro real **TS2339** e restaura
os arquivos antes do build. Nenhum script definido em `package.json` é executado.

O job `official-vue-react` não executa browser; `browser=not-run`.
O relatório demonstra a funcionalidade da toolchain sobre as fixtures
sintéticas e **não** classifica um app externo como válido. Para uma futura
execução em projetos reais ainda serão necessários isolamento e autenticação
imutável do job/commit e um lockfile para congelar dependências transitivas.

## Testes comportamentais Vue/React em Chromium isolado

O job `chromium-vue-react` constrói fixtures **próprias do repositório**
com Vite, copia o `dist` gerado para diretório descartável, registra digest
SHA-256 do conteúdo e executa Chromium em Docker com a imagem imutável do
Guardian Angular. Reutiliza o servidor de artefatos, o perfil seccomp,
filesystem read-only, rede desabilitada, usuário não-root e limites de recursos.

Para Vue e React são exigidas duas provas por fixture: clique em botão
`Count 0` que realmente muda para `Count 1`, seguido por **nova
compilação oficial válida** com uma regressão semântica intencional
(clique deixa de alterar estado). O teste negativo deve ser reprovado com
`no-observable-transition`, não com um erro qualquer de infraestrutura.

A saída do navegador é limitada a códigos de erro controlados, ao cenário e
ao digest do artefato; resultados ambíguos nunca são aprovados. Nenhum
workspace externo é executado, nenhuma autorização de deploy é emitida.
A primeira etapa é prova da fixture sintética, **não** uma integração pronta
ao Worker multistack. Lockfiles transitivos e provas de builds externos
continuam pendentes.

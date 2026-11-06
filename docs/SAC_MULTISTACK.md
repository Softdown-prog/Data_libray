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

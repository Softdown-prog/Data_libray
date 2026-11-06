# SAC Multistack — pesquisa de compiladores e evidência verificável

**Objetivo:** mapear o funcionamento das toolchains oficiais antes de ampliar
as análises. O SAC usa os binários oficiais no runner; **não incorpora ou
reimplementa** os compiladores. A origem de cada toolchain é mantida em
\`packages/sac-multistack/src/compiler-study.mjs\` com documentação oficial,
repositório upstream, etapas e limitações técnicas.

| Módulo | Etapas que precisamos distinguir | Ferramentas oficiais / limitações |
|---|---|---|
| Alpine.js | HTML → JS → execução de diretivas DOM | Alpine é runtime, não compilador próprio; HTML-Validate e Playwright |
| Vue | Vue SFC → tipos → bundler → DOM | Vue compiler / vue-tsc; Vite não substitui typecheck |
| NestJS | TS/SWC → CLI → inicialização → API | nest build envolve compilador subjacente; testar HTTP separadamente |
| Python | tokens → PEG/AST → bytecode → execução | CPython py_compile; não é teste funcional |
| JavaScript | parse JS → otimização/runtime → testes | Node --check valida sintaxe, não comportamento |
| CSS | parse/conformidade → cascade/renderização | Stylelint e browser; não existe compilador único do padrão |
| HTML5 | tokenizer/árvore DOM → conformance → browser | HTML-Validate; não existe build compiler único |
| React | TSX/JSX → bundler → DOM | tsc, Vite, Playwright; React Compiler é otimizador opcional |
| Next.js | TS → Next build → rotas SSR/API → navegador | Build verde não aprova semântica HTTP |
| Astro | arquivos .astro → astro check → astro build → browser | Executar check e build separados |
| Rust | parse/tipos/borrow → metadata/codegen → cargo test | rustc JSON error codes; cargo check não prova runtime |
| C++20 | preprocessador → parse/tipos → link → testes | g++ -fsyntax-only não testa link; formatos JSON/SARIF variam com GCC |
| Go | gofmt → compile/build → vet → go test | go tool compile não é substituto de go build/test |

### Regras de captura

1. Executar apenas as **ferramentas originais instaladas em ambiente isolado**
   e guardar versão/resolução de dependências + commit/artefato vinculados.
2. Preferir diagnósticos estruturados e **códigos oficiais estáveis**.
   \`rustc --error-format=json\` registra \`E0308\` num teste de tipos;
   mensagens, caminhos privados e explicações livres nunca vão para o Worker.
3. Distinguir erro de compilador de ausência de toolchain, timeout, falha de
   infraestrutura, falha de testes e falha do navegador.
4. \`status=not-run\` permanece até a fase efetivamente executar; sucesso de
   parsing ou build **não** autoriza deploy, nem implica testes funcionais.
5. Usar fontes upstream como referência de arquitetura, não clonar enormes
   árvores \`rustc\`, \`gcc\`, \`v8\` ou \`cpython\` para dentro da biblioteca.

### Primeiro refinamento aplicado

O probe Rust sintético antes aceitava **qualquer falha** do \`rustc\` na
fixture inválida; agora usa \`--error-format=json\` e exige \`E0308\`.
Um erro de ambiente, flag incompatível, falta de toolchain ou mensagem
inesperada **não** satisfaz essa prova. Os testes verificam desserialização
restrita, limite de tamanho, deduplicação e descarte de mensagens/caminhos.

**Escopo:** somente testes sintéticos de Rust e catálogo técnico. Ainda não
há importação de código de terceiros, execução segura genérica de projetos,
ligação ao Worker, correções automáticas ou clonagem dos compiladores.

Fontes de referência primárias por família:
- CPython: https://github.com/python/cpython/blob/main/InternalDocs/compiler.md
- TypeScript: https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- Vue: https://vuejs.org/guide/typescript/overview
- NestJS: https://docs.nestjs.com/cli/scripts
- Next.js: https://nextjs.org/docs/app/api-reference/cli/next
- React Compiler (otimizador): https://react.dev/learn/react-compiler
- rustc JSON: https://doc.rust-lang.org/rustc/json.html
- GCC diagnostics: https://gcc.gnu.org/onlinedocs/gcc/Diagnostic-Message-Formatting-Options.html
- Go: https://go.dev/doc/cmd
- Astro: https://docs.astro.build/en/reference/cli-reference/
- Padrão HTML: https://html.spec.whatwg.org/multipage/parsing.html

**Próximo foco:** validar AST e códigos por compilador nas demais linguagens,
respeitando as diferenças entre fases; quando houver provas reais, somente
então anexá-las a jobs autenticados do SAC.

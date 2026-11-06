/**
 * SAC multistack compiler study, first-party static reference catalog.
 * References upstream tools; no compiler sources are vendored, downloaded
 * or evaluated. Does not assert a toolchain executed or authorize a deploy.
 */
import { getModule, listModules } from './registry.mjs';
const entries = [
  {
    "module_id": "alpinejs",
    "kind": "runtime-library",
    "compiler": null,
    "pipeline": "HTML parser + JavaScript engine; Alpine directives execute in DOM",
    "official_guide": "https://alpinejs.dev/start-here",
    "upstream_source": "https://github.com/alpinejs/alpine",
    "caveat": "HTML-Validate checks markup; Playwright must prove Alpine directive behavior."
  },
  {
    "module_id": "vue",
    "kind": "sfc-framework",
    "compiler": "vue-template-compiler",
    "pipeline": "Vue SFC compiler + vue-tsc TypeScript + Vite bundling",
    "official_guide": "https://vuejs.org/guide/typescript/overview",
    "upstream_source": "https://github.com/vuejs/core",
    "caveat": "Vite transpiles without full Vue/TypeScript typechecking; separate vue-tsc."
  },
  {
    "module_id": "nestjs",
    "kind": "typescript-framework",
    "compiler": "typescript",
    "pipeline": "TypeScript/SWC transpilation through Nest CLI; HTTP integration after build",
    "official_guide": "https://docs.nestjs.com/cli/scripts",
    "upstream_source": "https://github.com/nestjs/nest",
    "caveat": "Nest CLI wraps compiler; API behavior needs independent HTTP assertions."
  },
  {
    "module_id": "python",
    "kind": "bytecode-language",
    "compiler": "cpython",
    "pipeline": "tokenize -> PEG parse -> AST -> CFG -> Python bytecode",
    "official_guide": "https://github.com/python/cpython/blob/main/InternalDocs/compiler.md",
    "upstream_source": "https://github.com/python/cpython",
    "caveat": "py_compile detects syntax/compile errors; it does not run tests or prove runtime behavior."
  },
  {
    "module_id": "javascript",
    "kind": "engine-language",
    "compiler": "v8",
    "pipeline": "ECMAScript parse/compile in V8; node --check only syntax",
    "official_guide": "https://nodejs.org/api/cli.html#-c---check",
    "upstream_source": "https://github.com/nodejs/node",
    "caveat": "Node --check neither executes tests nor proves module/runtime behavior."
  },
  {
    "module_id": "css",
    "kind": "stylesheet-standard",
    "compiler": null,
    "pipeline": "CSS parsing/conformance checked by Stylelint; browser applies cascade/layout",
    "official_guide": "https://stylelint.io/user-guide/get-started",
    "upstream_source": "https://github.com/stylelint/stylelint",
    "caveat": "Stylelint is not a CSS compiler; browser rendering requires separate evidence."
  },
  {
    "module_id": "html5",
    "kind": "markup-standard",
    "compiler": null,
    "pipeline": "HTML tokenizer/tree construction; conformance checks; DOM browser validation",
    "official_guide": "https://html.spec.whatwg.org/multipage/parsing.html",
    "upstream_source": "https://github.com/whatwg/html",
    "caveat": "HTML-Validate is a conformance validator, not a build compiler or DOM runtime."
  },
  {
    "module_id": "react",
    "kind": "tsx-framework",
    "compiler": "typescript",
    "pipeline": "TypeScript/TSX typecheck + Vite transpile/bundle; optional React Compiler optimization",
    "official_guide": "https://react.dev/learn/react-compiler",
    "upstream_source": "https://github.com/facebook/react",
    "caveat": "React Compiler optimizes components; it is not a substitute for tsc, build or DOM tests."
  },
  {
    "module_id": "nextjs",
    "kind": "fullstack-framework",
    "compiler": "typescript",
    "pipeline": "TypeScript + Next build/route generation + server rendering/API + browser",
    "official_guide": "https://nextjs.org/docs/app/api-reference/cli/next",
    "upstream_source": "https://github.com/vercel/next.js",
    "caveat": "A production build can succeed with broken API semantics; assert HTTP/SSR separately."
  },
  {
    "module_id": "astro",
    "kind": "component-framework",
    "compiler": "astro-check",
    "pipeline": "Astro template diagnostics + astro build + DOM behavior",
    "official_guide": "https://docs.astro.build/en/reference/cli-reference/",
    "upstream_source": "https://github.com/withastro/astro",
    "caveat": "Astro check and build are separate phases; client islands require runtime evidence."
  },
  {
    "module_id": "rust",
    "kind": "native-language",
    "compiler": "rustc",
    "pipeline": "Rust parser/type/borrow checks + metadata/codegen; Cargo orchestration, Clippy/test",
    "official_guide": "https://doc.rust-lang.org/rustc/json.html",
    "upstream_source": "https://github.com/rust-lang/rust",
    "caveat": "Use rustc JSON error codes; cargo check does not prove binary runtime behavior."
  },
  {
    "module_id": "cpp20",
    "kind": "native-language",
    "compiler": "gcc",
    "pipeline": "C++20 preprocessing/parse/type checks, codegen/link and executable tests",
    "official_guide": "https://gcc.gnu.org/onlinedocs/gcc/Diagnostic-Message-Formatting-Options.html",
    "upstream_source": "https://github.com/gcc-mirror/gcc",
    "caveat": "g++ -fsyntax-only cannot prove successful linking or program behavior."
  },
  {
    "module_id": "go",
    "kind": "native-language",
    "compiler": "gc-go",
    "pipeline": "gofmt syntax, go compiler type/build, go vet and go test",
    "official_guide": "https://go.dev/doc/cmd",
    "upstream_source": "https://github.com/golang/go",
    "caveat": "go tool compile is low-level; go build/test cover package dependencies/runtime."
  }
];
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const VALID_KIND = new Set(['runtime-library','sfc-framework',
 'typescript-framework','bytecode-language','engine-language',
 'stylesheet-standard','markup-standard','tsx-framework','fullstack-framework',
 'component-framework','native-language']);
const VALID_COMPILER = new Set([null,'vue-template-compiler','typescript',
 'cpython','v8','astro-check','rustc','gcc','gc-go']);
const SITE = /^https:\/\/(?:[a-z0-9-]+\.)+[a-z0-9-]+\/[A-Za-z0-9_.!#?&=%\/-]+$/;
function freezeEntry(e) {
 const registered=getModule(e.module_id);
 if(!e||!ID.test(e.module_id)||!VALID_KIND.has(e.kind)||
    !VALID_COMPILER.has(e.compiler)||
    typeof e.pipeline!=='string'||e.pipeline.length<12||e.pipeline.length>240||
    !SITE.test(e.official_guide)||!SITE.test(e.upstream_source)||
    typeof e.caveat!=='string'||e.caveat.length<12||e.caveat.length>260)
   throw Error('invalid-compiler-research-entry');
 return Object.freeze({...e,profile_family:registered.family});
}
const INDEX=new Map(entries.map(entry=>[entry.module_id,freezeEntry(entry)]));
if(INDEX.size!==13||listModules().some(p=>!INDEX.has(p.id)))
 throw Error('incomplete-compiler-research');
export function listCompilerStudies() {
 return [...INDEX.values()];
}
export function getCompilerStudy(id) {
 if(typeof id!=='string'||!INDEX.has(id))throw Error('unknown-compiler-study');
 const e=INDEX.get(id);
 const profile=getModule(id);
 return Object.freeze({...e,registered_gates:Object.freeze(
   profile.gates.map(g=>Object.freeze({id:g.id,tool:g.tool,phase:g.phase,
     status:'not-run'}))),
   evidence_verified:false,source_sha_verified:false,
   deployment_authorized:false});
}

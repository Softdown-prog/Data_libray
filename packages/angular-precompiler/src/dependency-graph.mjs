import path from 'node:path';

// SAC-PRE002: bounded, read-only AST analysis of operator-enumerated TypeScript.
// The caller supplies its trusted TypeScript compiler; workspace code is never run.
const MAX_FILES = 128;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_IMPORTS = 2048;
const MAX_FINDINGS = 256;
const POSIX_FILE = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.tsx?$/;
const SEGMENT = /^[a-z][a-z0-9-]{0,63}$/;
const validFile = file => typeof file === 'string' && file.length <= 200 &&
  POSIX_FILE.test(file) && !file.split('/').some(s => s === '.' || s === '..' || s === 'node_modules');
const fail = () => { throw new Error('sac-import-graph-invalid-input'); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, expected) => object(v) && Object.keys(v).sort().join(',') === expected.slice().sort().join(',');

function validatePolicy(policy) {
  if (!keys(policy, ['layers', 'allowImports', 'external']) ||
      !Array.isArray(policy.layers) || policy.layers.length > 24 ||
      !Array.isArray(policy.external) || policy.external.length > 32 ||
      !object(policy.allowImports)) fail();
  const names = new Set(), prefixes = new Set();
  for (const layer of policy.layers) {
    if (!keys(layer, ['name', 'prefix']) || !SEGMENT.test(layer.name) ||
        typeof layer.prefix !== 'string' || layer.prefix.length > 150 ||
        !layer.prefix.endsWith('/') || !validFile(layer.prefix + 'check.ts') ||
        names.has(layer.name) || prefixes.has(layer.prefix)) fail();
    names.add(layer.name); prefixes.add(layer.prefix);
  }
  if (Object.keys(policy.allowImports).length !== names.size) fail();
  for (const [name, allowed] of Object.entries(policy.allowImports)) {
    if (!names.has(name) || !Array.isArray(allowed) || allowed.length > names.size ||
        new Set(allowed).size !== allowed.length || allowed.some(v => !names.has(v))) fail();
  }
  if (new Set(policy.external).size !== policy.external.length || policy.external.some(v =>
    typeof v !== 'string' || v.length < 1 || v.length > 100 ||
    !/^[A-Za-z0-9@_./-]+$/.test(v) || v.startsWith('.') || v.includes('..'))) fail();
}

function candidates(from, specifier) {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  if (!target || target.startsWith('../') || target === '..' || target.startsWith('/')) return [];
  const exact = /\.tsx?$/.test(target);
  if (exact) return [target];
  if (/\.[cm]?js$/.test(target)) {
    const stem = target.replace(/\.[cm]?js$/, '');
    return [stem + '.ts', stem + '.tsx'];
  }
  if (path.posix.extname(target)) return [];
  return [target + '.ts', target + '.tsx', target + '/index.ts', target + '/index.tsx'];
}


// The TS resolver sees only operator-enumerated in-memory files. Never allow its
// default sys host to probe the filesystem or depend on the caller's checkout.
const VIRTUAL_ROOT = '/__sac_import_graph__';
const MAX_TSCONFIG_BYTES = 16 * 1024;
const CONFIG_PATTERN = /^[A-Za-z0-9@_./*#-]+$/;
const safeConfigPath = (value, allowStar = false) =>
  typeof value === 'string' && value.length > 0 && value.length <= 160 &&
  CONFIG_PATTERN.test(value) && !path.posix.isAbsolute(value) &&
  !value.includes('\\') && !value.includes('..') &&
  (!allowStar || value.split('*').length <= 2) &&
  (allowStar || !value.includes('*')) &&
  !value.split('/').includes('node_modules') && !value.split('/').includes('.git');

const TSCONFIG_NAME = /^tsconfig(?:\.[a-zA-Z0-9-]{1,40})?\.json$/;
const MAX_CONFIGS = 4;
const MAX_JSON_ASSETS = 32;
const MAX_JSON_BYTES = 32 * 1024;
const MAX_JSON_TOTAL = 256 * 1024;
const validJson = value => typeof value === 'string' && value.length <= 200 &&
  /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.json$/.test(value) &&
  value.startsWith('src/') &&
  !value.split('/').some(s => s === '.' || s === '..' || s === 'node_modules');
const validGenerator = value => typeof value === 'string' &&
  /^scripts\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.mjs$/.test(value) && value.length <= 160;

function readTsconfig(ts, tsconfig) {
  if (tsconfig === undefined) return {options: null, aliasPatterns: [], invalid: null};
  if (!keys(tsconfig,['path','text']) && !keys(tsconfig,['path','text','parents'])) fail();
  const parents = tsconfig.parents ?? [];
  if (!Array.isArray(parents) || parents.length > MAX_CONFIGS - 1) fail();
  const inputs = [{path: tsconfig.path, text: tsconfig.text}, ...parents];
  const records = new Map();
  for (const entry of inputs) {
    if (!keys(entry,['path','text']) || typeof entry.path !== 'string' ||
        !TSCONFIG_NAME.test(entry.path) || typeof entry.text !== 'string' ||
        Buffer.byteLength(entry.text,'utf8') > MAX_TSCONFIG_BYTES ||
        records.has(entry.path)) fail();
    records.set(entry.path, entry.text);
  }
  if (typeof ts.parseConfigFileTextToJson !== 'function' ||
      typeof ts.convertCompilerOptionsFromJson !== 'function' ||
      typeof ts.resolveModuleName !== 'function') fail();
  const visited = new Set();
  const evaluate = (file, active) => {
    if (active.has(file)) return {invalid:'unsupported-tsconfig-inheritance'};
    const text = records.get(file);
    if (text === undefined) return {invalid:'unsupported-tsconfig-inheritance'};
    visited.add(file);
    const decoded = ts.parseConfigFileTextToJson(file,text);
    const config = decoded.config;
    if (decoded.error || !object(config) ||
        (config.compilerOptions !== undefined && !object(config.compilerOptions)))
      return {invalid:'invalid-tsconfig'};
    if ('references' in config) return {invalid:'unsupported-tsconfig-inheritance'};
    let inherited = {};
    if ('extends' in config) {
      const ext = config.extends;
      if (typeof ext !== 'string' || !/^(?:\.\/)?tsconfig(?:\.[A-Za-z0-9-]{1,40})?\.json$/.test(ext))
        return {invalid:'unsupported-tsconfig-inheritance'};
      const name = ext.replace(/^\.\//,'');
      const parent = evaluate(name,new Set([...active,file]));
      if (parent.invalid) return parent;
      inherited = parent.compiler;
    }
    return {compiler:{...inherited,...(config.compilerOptions ?? {})}};
  };
  const result = evaluate(tsconfig.path,new Set());
  if (result.invalid) return {options:null,aliasPatterns:[],invalid:result.invalid};
  // Every caller-enumerated parent must belong to the actual inheritance chain.
  if (visited.size !== records.size)
    return {options:null,aliasPatterns:[],invalid:'unsupported-tsconfig-inheritance'};
  const compiler = result.compiler;
  if (['rootDirs','moduleSuffixes','customConditions','resolvePackageJsonImports',
       'resolvePackageJsonExports','noResolve','allowArbitraryExtensions','baseUrlPaths'].some(k=>k in compiler))
    return {options:null,aliasPatterns:[],invalid:'unsupported-tsconfig-resolution'};
  if (compiler.baseUrl !== undefined &&
      !(compiler.baseUrl === '.' || safeConfigPath(compiler.baseUrl)))
    return {options:null,aliasPatterns:[],invalid:'unsupported-tsconfig-resolution'};
  if (compiler.paths !== undefined &&
      (!object(compiler.paths) || Object.keys(compiler.paths).length > 32))
    return {options:null,aliasPatterns:[],invalid:'unsupported-tsconfig-paths'};
  const patterns = [];
  for (const [alias,targets] of Object.entries(compiler.paths ?? {})) {
    if (!safeConfigPath(alias,true) || alias.startsWith('.') ||
        !Array.isArray(targets) || !targets.length || targets.length > 8 ||
        targets.some(target=>!safeConfigPath(target,true)))
      return {options:null,aliasPatterns:[],invalid:'unsupported-tsconfig-paths'};
    patterns.push(alias);
  }
  if (compiler.moduleResolution !== undefined && typeof compiler.moduleResolution !== 'string')
    return {options:null,aliasPatterns:[],invalid:'unsupported-tsconfig-resolution'};
  if (compiler.module !== undefined && typeof compiler.module !== 'string')
    return {options:null,aliasPatterns:[],invalid:'unsupported-tsconfig-resolution'};
  if (compiler.resolveJsonModule !== undefined && typeof compiler.resolveJsonModule !== 'boolean')
    return {options:null,aliasPatterns:[],invalid:'unsupported-tsconfig-resolution'};
  const subset = {};
  for (const key of ['baseUrl','paths','moduleResolution','module','resolveJsonModule'])
    if (key in compiler) subset[key] = compiler[key];
  const converted=ts.convertCompilerOptionsFromJson(subset,VIRTUAL_ROOT,tsconfig.path);
  if (converted.errors.length) return {options:null,aliasPatterns:[],invalid:'invalid-tsconfig-options'};
  return {options:converted.options,aliasPatterns:patterns,invalid:null};
}

function validateResources(jsonAssets, generatedFiles, sources) {
  if (!Array.isArray(jsonAssets) || jsonAssets.length > MAX_JSON_ASSETS ||
      !Array.isArray(generatedFiles) || generatedFiles.length > MAX_JSON_ASSETS) fail();
  const assets = new Map(), generated = new Set();
  let total=0;
  for (const item of jsonAssets) {
    if (!keys(item,['path','source']) || !validJson(item.path) ||
        typeof item.source !== 'string' || sources.has(item.path) || assets.has(item.path)) fail();
    const bytes=Buffer.byteLength(item.source,'utf8');
    total+=bytes;
    if (bytes>MAX_JSON_BYTES || total>MAX_JSON_TOTAL) fail();
    try { JSON.parse(item.source); } catch { fail(); }
    assets.set(item.path,item.source);
  }
  for (const item of generatedFiles) {
    if (!keys(item,['path','generator']) || !validFile(item.path) ||
        !validGenerator(item.generator) || sources.has(item.path) || generated.has(item.path)) fail();
    generated.add(item.path);
  }
  return {assets,generated};
}

function virtualResolver(ts, sources, assets, options) {
  const snapshot = new Map();
  const directories = new Set([VIRTUAL_ROOT]);
  for (const [file,source] of [...sources,...assets]) {
    const absolute = VIRTUAL_ROOT + '/' + file;
    snapshot.set(absolute, source);
    for (let dir=path.posix.dirname(absolute);dir.startsWith(VIRTUAL_ROOT);dir=path.posix.dirname(dir)) {
      if (directories.has(dir)) break;
      directories.add(dir);
    }
  }
  const host={
    fileExists:file=>snapshot.has(file),
    readFile:file=>snapshot.get(file),
    directoryExists:dir=>directories.has(dir),
    getCurrentDirectory:()=>VIRTUAL_ROOT,
    realpath:file=>file,
    useCaseSensitiveFileNames:()=>true
  };
  return (from,specifier)=>{
    const result=ts.resolveModuleName(specifier,VIRTUAL_ROOT+'/'+from,options,host);
    const absolute=result.resolvedModule?.resolvedFileName;
    if (!absolute || !snapshot.has(absolute)) return null;
    return absolute.slice(VIRTUAL_ROOT.length+1);
  };
}

function matchesAlias(patterns, specifier) {
  return patterns.some(pattern => {
    const split = pattern.split('*');
    return split.length === 1 ? pattern === specifier :
      specifier.length >= split[0].length + split[1].length &&
      specifier.startsWith(split[0]) && specifier.endsWith(split[1]);
  });
}

function collectImports(ts, sourceFile) {
  const out = [];
  const add = (specifier, typeOnly) => {
    if (typeof specifier === 'string') out.push({specifier, kind: typeOnly ? 'type' : 'runtime'});
    else out.push({specifier: null, kind: 'runtime'});
  };
  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      const clause = node.importClause;
      const names = clause?.namedBindings;
      const onlyTypes = Boolean(clause?.isTypeOnly ||
        (clause && !clause.name && names && ts.isNamedImports(names) &&
          names.elements.length > 0 && names.elements.every(e => e.isTypeOnly)));
      add(ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : null, onlyTypes);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : null,
        Boolean(node.isTypeOnly));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const ref = node.moduleReference.expression;
      add(ref && ts.isStringLiteralLike(ref) ? ref.text : null, Boolean(node.isTypeOnly));
    } else if (ts.isCallExpression(node) &&
               (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const arg = node.arguments[0];
      add(arg && ts.isStringLiteralLike(arg) ? arg.text : null, false);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return out;
}

function cycleComponents(nodes, runtimeEdges) {
  const neighbors = new Map(nodes.map(n => [n, []]));
  for (const edge of runtimeEdges) neighbors.get(edge.from).push(edge.to);
  for (const links of neighbors.values()) links.sort();
  const index = new Map(), low = new Map(), stack = [], active = new Set(), cycles = [];
  let counter = 0;
  function walk(node) {
    index.set(node, counter); low.set(node, counter++);
    stack.push(node); active.add(node);
    for (const next of neighbors.get(node)) {
      if (!index.has(next)) { walk(next); low.set(node, Math.min(low.get(node), low.get(next))); }
      else if (active.has(next)) low.set(node, Math.min(low.get(node), index.get(next)));
    }
    if (low.get(node) === index.get(node)) {
      const component = [];
      let current;
      do { current = stack.pop(); active.delete(current); component.push(current); } while (current !== node);
      component.sort();
      if (component.length > 1 || neighbors.get(node).includes(node)) cycles.push(component);
    }
  }
  for (const node of nodes) if (!index.has(node)) walk(node);
  return cycles.sort((a, b) => a.join(',').localeCompare(b.join(',')));
}

/**
 * Analyze only a bounded, explicit set of TypeScript sources in memory.
 * No filesystem access, network, npm install or source execution; optional
 * module resolution uses the official TypeScript API with a virtual-only host.
 * typescript is supplied by a trusted operator, not by the analyzed workspace.
 */
export function analyzeImportGraph({files, policy = {layers: [], allowImports: {}, external: []}, typescript: ts, tsconfig, jsonAssets = [], generatedFiles = []} = {}) {
  if (!ts || typeof ts.createSourceFile !== 'function' || typeof ts.forEachChild !== 'function' ||
      typeof ts.isImportDeclaration !== 'function' || !Array.isArray(files) ||
      files.length < 1 || files.length > MAX_FILES) fail();
  validatePolicy(policy);
  const sources = new Map();
  let size = 0;
  for (const item of files) {
    if (!keys(item, ['path', 'source']) || !validFile(item.path) ||
        typeof item.source !== 'string' || sources.has(item.path)) fail();
    const bytes = Buffer.byteLength(item.source, 'utf8');
    size += bytes;
    if (bytes > MAX_SOURCE_BYTES || size > MAX_TOTAL_BYTES) fail();
    sources.set(item.path, item.source);
  }
  const nodes = [...sources.keys()].sort();
  const {assets,generated} = validateResources(jsonAssets,generatedFiles,sources);
  const config = readTsconfig(ts, tsconfig);
  const resolve = config.options ? virtualResolver(ts, sources, assets, config.options) : null;
  const layers = [...policy.layers].sort((a, b) => b.prefix.length - a.prefix.length);
  const layerOf = file => layers.find(rule => file.startsWith(rule.prefix))?.name ?? null;
  const edges = [], asset_edges = [], findings = [];
  let unresolved = false, failure = false, truncated = false, count = 0;
  const report = finding => {
    if (findings.length >= MAX_FINDINGS) { truncated = true; unresolved = true; return; }
    findings.push(finding);
  };
  if (config.invalid) { unresolved = true; report({code: config.invalid}); }
  for (const file of nodes) {
    const source = ts.createSourceFile(file, sources.get(file), ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (source.parseDiagnostics?.length) {
      unresolved = true; report({code: 'source-parse-unverified', file});
    }
    const imports = collectImports(ts, source);
    count += imports.length;
    if (count > MAX_IMPORTS) fail();
    for (const item of imports) {
      const {specifier, kind} = item;
      if (specifier === null || specifier.length > 256 || specifier.length === 0) {
        unresolved = true; report({code: 'dynamic-or-invalid-import', file}); continue;
      }
      const relative = specifier.startsWith('.');
      let target = null;
      try {
        target = resolve ? resolve(file, specifier) :
          relative ? candidates(file, specifier).find(candidate => sources.has(candidate)) ?? null : null;
      } catch {
        unresolved = true; report({code: 'module-resolution-unverified', file}); continue;
      }
      if (!target) {
        if (relative && candidates(file,specifier).some(candidate=>generated.has(candidate))) {
          unresolved = true; report({code:'generated-source-not-captured',file}); continue;
        }
        if (!relative && matchesAlias(config.aliasPatterns, specifier)) {
          unresolved = true; report({code: 'unresolved-tsconfig-alias', file}); continue;
        }
        if (!relative && policy.external.some(ext => ext.endsWith('/') ? specifier.startsWith(ext) : specifier === ext)) continue;
        unresolved = true;
        report({code: relative ? 'unresolved-relative-import' : 'unclassified-bare-import', file});
        continue;
      }
      if (assets.has(target)) {
        // TypeScript can find JSON paths even if resolveJsonModule is disabled.
        // Resolving a filename does not prove the compiler would accept the import.
        if (config.options?.resolveJsonModule !== true) {
          unresolved = true; report({code:'json-module-not-enabled',file});
          continue;
        }
        asset_edges.push({from:file,to:target,kind:'json'});
        continue;
      }
      edges.push({from: file, to: target, kind});
      if (layers.length) {
        const fromLayer = layerOf(file), toLayer = layerOf(target);
        if (fromLayer === null || toLayer === null) {
          unresolved = true; report({code: 'unclassified-layer', file, target});
        } else if (!policy.allowImports[fromLayer].includes(toLayer)) {
          failure = true;
          report({code: 'forbidden-layer-import', file, target});
        }
      }
    }
  }
  edges.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  asset_edges.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const members of cycleComponents(nodes, edges.filter(e => e.kind === 'runtime'))) {
    failure = true;
    report({code: 'circular-runtime-import', members});
  }
  findings.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    schema_version: 1,
    rule_id: 'SAC-PRE002',
    status: failure ? 'fail' : unresolved ? 'unverified' : 'pass',
    scope: 'enumerated-typescript-sources-only',
    nodes,
    edges,
    asset_edges,
    findings,
    truncated,
    root_cause_verified: false,
    deployment_authorized: false
  };
}

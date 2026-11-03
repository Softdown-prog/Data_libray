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
 * No filesystem access, module resolution, network, npm install or source execution.
 * typescript is supplied by a trusted operator, not by the analyzed workspace.
 */
export function analyzeImportGraph({files, policy = {layers: [], allowImports: {}, external: []}, typescript: ts} = {}) {
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
  const layers = [...policy.layers].sort((a, b) => b.prefix.length - a.prefix.length);
  const layerOf = file => layers.find(rule => file.startsWith(rule.prefix))?.name ?? null;
  const edges = [], findings = [];
  let unresolved = false, failure = false, truncated = false, count = 0;
  const report = finding => {
    if (findings.length >= MAX_FINDINGS) { truncated = true; unresolved = true; return; }
    findings.push(finding);
  };
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
      if (!specifier.startsWith('.')) {
        if (policy.external.some(ext => ext.endsWith('/') ? specifier.startsWith(ext) : specifier === ext)) continue;
        unresolved = true; report({code: 'unclassified-bare-import', file}); continue;
      }
      const target = candidates(file, specifier).find(candidate => sources.has(candidate));
      if (!target) {
        unresolved = true; report({code: 'unresolved-relative-import', file}); continue;
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
    findings,
    truncated,
    root_cause_verified: false,
    deployment_authorized: false
  };
}

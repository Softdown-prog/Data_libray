// SAC-PRE002 external runtime imports: evidence, not runtime certification.
// Pure inspection of operator-supplied, bounded source/build strings. No IO.
import {createHash} from 'node:crypto';

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_BUNDLES = 64;
const invalid = () => { throw new Error('sac-external-runtime-invalid-input'); };
const fixedString = x => typeof x === 'string' && Buffer.byteLength(x,'utf8') <= MAX_BYTES;
const hash = x => createHash('sha256').update(x).digest('hex');
const literal = (text, value) => text.includes(value);
const hasDynamicImport = text => /\bimport\s*\(/.test(text);
const simplePath = x => typeof x === 'string' && x.length < 150 &&
  /^[A-Za-z0-9][A-Za-z0-9_./-]*\.js$/.test(x) &&
  !x.startsWith('/') && !x.split('/').some(part => part === '..');
const expected = Object.freeze({
  canvas: {
    source: 'src/main.ts',
    marker: './js/main.js',
    argument: 'gameUrl.href',
    path: 'game/js/main.js'
  },
  save: {
    source: 'src/site-rewrite/account.ts',
    marker: '/game/js/sim/saveTransfer.js',
    argument: 'modulePath',
    path: 'game/js/sim/saveTransfer.js'
  }
});
const includesDynamicCall = (ts, source, argument) => {
  const ast = ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  if (ast.parseDiagnostics?.length) return false;
  let found = false;
  function walk(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 && node.arguments[0]?.getText(ast) === argument) found = true;
    ts.forEachChild(node,walk);
  }
  walk(ast);
  return found;
};

/**
 * Expects game and site JS bundles and website artifacts produced from the
 * same pinned checkout. Must not treat artifact presence as runtime success.
 * The TypeScript compiler must be preinstalled and trusted by the operator.
 */
export function inspectLhsRuntimeImports({typescript: ts,sources,bundles,assets}={}) {
  if (!ts || typeof ts.createSourceFile !== 'function' || typeof ts.isCallExpression !== 'function' ||
      !sources || typeof sources !== 'object' || Array.isArray(sources) ||
      !bundles || typeof bundles !== 'object' || Array.isArray(bundles) ||
      !assets || typeof assets !== 'object' || Array.isArray(assets) ||
      !fixedString(sources.canvas) || !fixedString(sources.account) ||
      !Array.isArray(bundles.game) || !Array.isArray(bundles.site) ||
      !bundles.game.length || !bundles.site.length ||
      bundles.game.length > MAX_BUNDLES || bundles.site.length > MAX_BUNDLES ||
      !fixedString(assets.gameIndex) || !fixedString(assets.nativeCanvas) ||
      !fixedString(assets.nativeSave)) invalid();
  for (const group of [bundles.game,bundles.site]) {
    if (group.some(x => !x || !simplePath(x.path) || !fixedString(x.source)) ||
        new Set(group.map(x=>x.path)).size !== group.length) invalid();
  }
  const checks = [
    {key:'canvas', source:sources.canvas, emitted:bundles.game, native:assets.nativeCanvas},
    {key:'save',source:sources.account,emitted:bundles.site,native:assets.nativeSave}
  ].map(({key,source,emitted,native}) => {
    const spec = expected[key];
    const sourceUrlObserved = literal(source,spec.marker);
    const sourceDynamicObserved = includesDynamicCall(ts,source,spec.argument);
    const bundleUrlObserved = emitted.some(x=>literal(x.source,spec.marker));
    const bundleDynamicObserved = emitted.some(x=>hasDynamicImport(x.source));
    const nativeTargetObserved = native.length > 0;
    return {
      entry:key,
      source_reference:spec.source,
      runtime_target:spec.path,
      source_url_observed:sourceUrlObserved,
      source_dynamic_import_observed:sourceDynamicObserved,
      bundle_url_observed:bundleUrlObserved,
      bundle_dynamic_import_observed:bundleDynamicObserved,
      target_file_present:nativeTargetObserved,
      target_sha256:nativeTargetObserved ? hash(native) : null,
      artifact_link_evidence:sourceUrlObserved && sourceDynamicObserved &&
        bundleUrlObserved && bundleDynamicObserved && nativeTargetObserved
    };
  });
  const angularBootstrapped = assets.gameIndex.includes('__angular/main.js');
  // Approval is deliberately never returned: the browser and asset server
  // have not been exercised; a build can succeed while a dynamic import fails.
  return {
    schema_version:1,
    rule_id:'SAC-PRE002-EXT',
    status:'unverified',
    scope:'pinned-LHS-build-artifacts-only',
    emitted_artifacts_consistent:checks.every(x=>x.artifact_link_evidence) && angularBootstrapped,
    angular_bootstrap_observed:angularBootstrapped,
    entries:checks,
    runtime_execution_verified:false,
    deployment_authorized:false
  };
}

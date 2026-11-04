/**
 * SAC-PRE003: opt-in, read-only examination of directly enumerated Angular
 * component decorator metadata. This is deliberately NOT Angular AOT, an
 * injector analysis, a template compiler, or a production gate.
 */
const MAX_FILES = 128;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_COMPONENTS = 512;
const MAX_IMPORT_ENTRIES = 2048;
const MAX_FINDINGS = 256;
const SAFE_PATH = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.tsx?$/;
const invalid = () => { throw new Error('sac-component-wiring-invalid-input'); };
const validPath = p => typeof p === 'string' && p.length <= 200 &&
  SAFE_PATH.test(p) && !p.split('/').some(x=>x==='.'||x==='..'||x==='node_modules');
const code = (node, ts) => ts.isIdentifier(node) ? node.text :
  (ts.isStringLiteral(node) ? node.text : null);
const property = (obj, name, ts) => obj.properties.filter(p =>
  ts.isPropertyAssignment(p) && code(p.name,ts) === name);
const isFalse = (node, ts) => node?.kind===ts.SyntaxKind.FalseKeyword;
const hasSpread = (obj, ts) => obj.properties.some(p => ts.isSpreadAssignment(p) ||
  (ts.isPropertyAssignment(p) && ts.isComputedPropertyName(p.name)));

function bindings(ts, ast) {
  const components = new Set(), namespaces = new Set();
  const typeOnly = new Set(), runtime = new Set();
  for(const stmt of ast.statements) {
    if(ts.isImportDeclaration(stmt) && ts.isStringLiteralLike(stmt.moduleSpecifier)) {
      const isAngular = stmt.moduleSpecifier.text === '@angular/core';
      const clause = stmt.importClause;
      if(!clause) continue;
      if(clause.name) (clause.isTypeOnly?typeOnly:runtime).add(clause.name.text);
      const named=clause.namedBindings;
      if(!named) continue;
      if(ts.isNamespaceImport(named)) {
        (clause.isTypeOnly?typeOnly:runtime).add(named.name.text);
        if(isAngular && !clause.isTypeOnly) namespaces.add(named.name.text);
      } else if(ts.isNamedImports(named)) {
        for(const entry of named.elements) {
          const local=entry.name.text, original=entry.propertyName?.text??local;
          const type=Boolean(clause.isTypeOnly||entry.isTypeOnly);
          (type?typeOnly:runtime).add(local);
          if(isAngular && original==='Component' && !type) components.add(local);
        }
      }
    } else if(ts.isClassDeclaration(stmt) && stmt.name) {
      if(stmt.modifiers?.some(m=>m.kind===ts.SyntaxKind.DeclareKeyword)) typeOnly.add(stmt.name.text);
      else runtime.add(stmt.name.text);
    } else if(ts.isFunctionDeclaration(stmt) && stmt.name) {
      if(stmt.modifiers?.some(m=>m.kind===ts.SyntaxKind.DeclareKeyword)) typeOnly.add(stmt.name.text);
      else runtime.add(stmt.name.text);
    } else if(ts.isEnumDeclaration(stmt)) {
      if(stmt.modifiers?.some(m=>m.kind===ts.SyntaxKind.DeclareKeyword)) typeOnly.add(stmt.name.text);
      else runtime.add(stmt.name.text);
    } else if(ts.isVariableStatement(stmt)) {
      for(const d of stmt.declarationList.declarations) {
        if(ts.isIdentifier(d.name)) runtime.add(d.name.text);
      }
    } else if((ts.isTypeAliasDeclaration(stmt)||ts.isInterfaceDeclaration(stmt)) && stmt.name) {
      typeOnly.add(stmt.name.text);
    }
  }
  return {components,namespaces,typeOnly,runtime};
}
function isComponentDecorator(ts, decorator, b) {
  if(!ts.isCallExpression(decorator.expression)) return false;
  const expr=decorator.expression.expression;
  if(ts.isIdentifier(expr)) return b.components.has(expr.text);
  return ts.isPropertyAccessExpression(expr)&&expr.name.text==='Component' &&
    ts.isIdentifier(expr.expression)&&b.namespaces.has(expr.expression.text);
}

/**
 * Only proven Angular @Component decorators are inspected. Source and dynamic
 * metadata are never executed or included in diagnostics. AOT must independently
 * verify that runtime symbols are real directives/components/NgModules.
 */
export function analyzeAngularComponentWiring({files, typescript:ts}={}) {
  if(!ts || typeof ts.createSourceFile!=='function' ||
    typeof ts.getDecorators!=='function' || typeof ts.isClassDeclaration!=='function' ||
    !Array.isArray(files) || files.length===0 || files.length>MAX_FILES) invalid();
  const inputs=new Map();let total=0;
  for(const item of files) {
    if(!item || Array.isArray(item) || typeof item!=='object' ||
      Object.keys(item).sort().join(',')!=='path,source' ||
      !validPath(item.path) || typeof item.source!=='string'||inputs.has(item.path)) invalid();
    const bytes=Buffer.byteLength(item.source,'utf8'); total+=bytes;
    if(bytes>MAX_FILE_BYTES || total>MAX_TOTAL_BYTES)invalid();
    inputs.set(item.path,item.source);
  }
  let checked=0, observed=0, failed=false, importEntries=0;
  const findings=[];
  const report=(code,file,component_index)=>{
    if(findings.length>=MAX_FINDINGS)invalid();
    findings.push({code,file,component_index});
  };
  for(const [file,source] of [...inputs].sort(([a],[b])=>a.localeCompare(b))) {
    const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,
      file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    if(ast.parseDiagnostics?.length){report('typescript-parse-unverified',file,0);continue;}
    const b=bindings(ts,ast);
    for(const stmt of ast.statements) {
      if(!ts.isClassDeclaration(stmt)) continue;
      for(const dec of ts.getDecorators(stmt)??[]) {
        if(!isComponentDecorator(ts,dec,b))continue;
        checked++;if(checked>MAX_COMPONENTS)invalid();
        const idx=checked;
        const args=dec.expression.arguments;
        if(args.length!==1 || !ts.isObjectLiteralExpression(args[0])) {
          report('component-metadata-dynamic',file,idx);continue;
        }
        const meta=args[0];
        if(hasSpread(meta,ts)){report('component-metadata-spread-unverified',file,idx);continue;}
        const imports=property(meta,'imports',ts);
        const standalone=property(meta,'standalone',ts);
        if(imports.length>1 || standalone.length>1){report('component-metadata-ambiguous',file,idx);continue;}
        if(imports.length===0) {observed++;continue;}
        if(standalone.length===1 && isFalse(standalone[0].initializer,ts)) {
          failed=true;report('nonstandalone-component-declares-imports',file,idx);continue;
        }
        if(standalone.length===1 && standalone[0].initializer.kind!==ts.SyntaxKind.TrueKeyword){
          report('component-standalone-value-unverified',file,idx);continue;
        }
        const list=imports[0].initializer;
        if(!ts.isArrayLiteralExpression(list)) {
          report('component-imports-dynamic',file,idx);continue;
        }
        observed++;
        for(const entry of list.elements) {
          importEntries++;if(importEntries>MAX_IMPORT_ENTRIES)invalid();
          if(!ts.isIdentifier(entry)) {
            report('component-import-expression-unverified',file,idx);continue;
          }
          if(b.typeOnly.has(entry.text) && !b.runtime.has(entry.text)) {
            failed=true;report('component-import-is-type-only',file,idx);
          } else if(!b.runtime.has(entry.text)) {
            report('component-import-binding-unverified',file,idx);
          }
        }
      }
    }
  }
  findings.sort((a,b)=>a.file.localeCompare(b.file)||a.component_index-b.component_index||a.code.localeCompare(b.code));
  if(checked===0)report('no-angular-component-decorator-observed','',0);
  return {
    schema_version:1,rule_id:'SAC-PRE003',
    status:failed?'fail':'unverified',
    scope:'operator-enumerated-angular-component-metadata-only',
    components_checked:checked,component_metadata_observed:observed,
    import_entries_checked:importEntries,findings,
    aot_verified:false,component_runtime_verified:false,
    root_cause_verified:false,deployment_authorized:false
  };
}

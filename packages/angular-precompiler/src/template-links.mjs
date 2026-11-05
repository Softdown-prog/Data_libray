/**
 * SAC-PRE004: bounded read-only Angular @Component template linkage.
 * A static templateUrl resolving to a supplied HTML file is an observation,
 * never proof that the Angular template compiles or works in a browser.
 * No Angular/project code is loaded or evaluated by this module.
 */
import path from 'node:path';

const MAX_TS=128,MAX_HTML=128,MAX_FILE_BYTES=512*1024,MAX_TOTAL_BYTES=2*1024*1024;
const MAX_COMPONENTS=512,MAX_FINDINGS=256;
const SOURCE_PATH=/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.tsx?$/;
const TEMPLATE_PATH=/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.html$/;
const invalid=()=>{throw new Error('sac-template-links-invalid-input');};
const valid=(p,pattern)=>typeof p==='string'&&p.length<=200&&pattern.test(p)&&
  p.startsWith('src/')&&!p.split('/').some(x=>x==='.'||x==='..'||x==='node_modules');
const key=(node,ts)=>ts.isIdentifier(node)||ts.isStringLiteral(node)?node.text:null;
function validateInput(items,pattern,limit,seen) {
  if(!Array.isArray(items)||items.length>limit)invalid();
  const result=new Map();
  for(const item of items) {
    if(!item||typeof item!=='object'||Array.isArray(item)||
      Object.keys(item).sort().join(',')!=='path,source'||
      !valid(item.path,pattern)||typeof item.source!=='string'||
      seen.has(item.path))invalid();
    seen.add(item.path);
    if(Buffer.byteLength(item.source,'utf8')>MAX_FILE_BYTES)invalid();
    result.set(item.path,item.source);
  }
  return result;
}
function componentSymbols(ts,ast) {
  const direct=new Set(),namespaces=new Set();
  for(const stmt of ast.statements){
    if(!ts.isImportDeclaration(stmt)||
      !ts.isStringLiteralLike(stmt.moduleSpecifier)||
      stmt.moduleSpecifier.text!=='@angular/core')continue;
    const c=stmt.importClause;
    if(!c||c.isTypeOnly||!c.namedBindings)continue;
    const bindings=c.namedBindings;
    if(ts.isNamespaceImport(bindings))namespaces.add(bindings.name.text);
    else if(ts.isNamedImports(bindings))for(const entry of bindings.elements) {
      if(!entry.isTypeOnly&&(entry.propertyName?.text??entry.name.text)==='Component')
        direct.add(entry.name.text);
    }
  }
  return {direct,namespaces};
}
function componentDecorator(ts,dec,bindings) {
  const expression=dec.expression;
  if(!ts.isCallExpression(expression))return false;
  const target=expression.expression;
  if(ts.isIdentifier(target))return bindings.direct.has(target.text);
  return ts.isPropertyAccessExpression(target)&&target.name.text==='Component'&&
    ts.isIdentifier(target.expression)&&bindings.namespaces.has(target.expression.text);
}
function property(ts,meta,name) {
  return meta.properties.filter(p=>ts.isPropertyAssignment(p)&&key(p.name,ts)===name);
}
function templateFile(source,reference) {
  if(typeof reference!=='string'||reference.length===0||reference.length>200||
    !reference.startsWith('./')&&!reference.startsWith('../')||
    reference.includes('\\')||reference.includes('\0')||
    reference.includes('?')||reference.includes('#'))return null;
  const candidate=path.posix.normalize(path.posix.join(path.posix.dirname(source),reference));
  return valid(candidate,TEMPLATE_PATH)?candidate:null;
}

/**
 * Trust boundary: only caller-enumerated .ts/.tsx and .html inputs in memory.
 * HTML is never parsed or evaluated. A missing HTML is UNVERIFIED rather than
 * an error because caller inventory is not proven exhaustive.
 */
export function inspectAngularTemplateLinks({files,templates=[],typescript:ts}={}){
  if(!ts||typeof ts.createSourceFile!=='function'||
    typeof ts.getDecorators!=='function'||typeof ts.isClassDeclaration!=='function')invalid();
  const seen=new Set();
  const sources=validateInput(files,SOURCE_PATH,MAX_TS,seen);
  if(sources.size<1)invalid();
  const html=validateInput(templates,TEMPLATE_PATH,MAX_HTML,seen);
  let bytes=0;
  for(const source of [...sources.values(),...html.values()])
    bytes+=Buffer.byteLength(source,'utf8');
  if(bytes>MAX_TOTAL_BYTES)invalid();
  let components=0,linked=0,inline=0,missing=0;
  const links=[],findings=[];
  const report=(code,file,component_index)=>{
    if(findings.length>=MAX_FINDINGS)invalid();
    findings.push({code,file,component_index});
  };
  for(const [file,source] of [...sources].sort(([a],[b])=>a.localeCompare(b))){
    const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,
      file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    if(ast.parseDiagnostics?.length){report('typescript-parse-unverified',file,0);continue;}
    const bindings=componentSymbols(ts,ast);
    for(const stmt of ast.statements){
      if(!ts.isClassDeclaration(stmt))continue;
      for(const dec of ts.getDecorators(stmt)??[]){
        if(!componentDecorator(ts,dec,bindings))continue;
        if(++components>MAX_COMPONENTS)invalid();
        const component_index=components;
        const args=dec.expression.arguments;
        if(args.length!==1||!ts.isObjectLiteralExpression(args[0])){
          report('component-template-metadata-dynamic',file,component_index);continue;
        }
        const meta=args[0];
        if(meta.properties.some(p=>ts.isSpreadAssignment(p)||
           (ts.isPropertyAssignment(p)&&ts.isComputedPropertyName(p.name)))){
          report('component-template-metadata-spread',file,component_index);continue;
        }
        const urls=property(ts,meta,'templateUrl'),inlines=property(ts,meta,'template');
        if(urls.length>1||inlines.length>1||(urls.length&&inlines.length)){
          report('component-template-ambiguous',file,component_index);continue;
        }
        if(urls.length){
          const value=urls[0].initializer;
          if(!ts.isStringLiteralLike(value)){
            report('component-template-url-dynamic',file,component_index);continue;
          }
          const target=templateFile(file,value.text);
          if(!target){report('component-template-path-unverified',file,component_index);continue;}
          if(!html.has(target)){
            missing++;report('component-template-not-enumerated',file,component_index);continue;
          }
          linked++;
          links.push({component_file:file,template_file:target,component_index});
        }else if(inlines.length){
          if(ts.isStringLiteralLike(inlines[0].initializer))inline++;
          else report('component-inline-template-dynamic',file,component_index);
        }else{
          report('component-template-unspecified',file,component_index);
        }
      }
    }
  }
  links.sort((a,b)=>a.component_file.localeCompare(b.component_file)||
    a.component_index-b.component_index);
  findings.sort((a,b)=>a.file.localeCompare(b.file)||
    a.component_index-b.component_index||a.code.localeCompare(b.code));
  return {
    schema_version:1,rule_id:'SAC-PRE004',
    status:'unverified',
    scope:'operator-enumerated-angular-template-references-only',
    components_checked:components,external_templates_linked:linked,
    inline_templates_observed:inline,external_templates_not_enumerated:missing,
    enumerated_html_files:html.size,links,findings,
    angular_template_parsed:false,aot_verified:false,runtime_verified:false,
    root_cause_verified:false,deployment_authorized:false
  };
}

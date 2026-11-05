/**
 * SAC-PRE005: opt-in bounded Angular template binding/event evidence.
 *
 * The Angular parser and the TypeScript AST are supplied by a trusted caller.
 * Project code and HTML are NEVER imported or evaluated; raw source, member
 * names, compiler errors and template text never enter returned evidence.
 *
 * A parser syntax error is a finding inside an observed template. Undeclared
 * class member hints are UNVERIFIED (inheritance/template locals can be valid).
 */
import {inspectAngularTemplateLinks} from './template-links.mjs';

const MAX_PARSED_TEMPLATES=64,MAX_VISITS=30000,MAX_FINDINGS=256;
const invalid=()=>{throw new Error('sac-template-bindings-invalid-input');};

function memberNames(ts,stmt){
  const names=new Set();
  for(const member of stmt.members){
    const name=member.name;
    if(name && (ts.isIdentifier(name)||ts.isStringLiteral(name)))names.add(name.text);
    if(ts.isConstructorDeclaration(member)){
      for(const parameter of member.parameters){
        const flags=parameter.modifiers??[];
        if(ts.isIdentifier(parameter.name)&&flags.some(f=>[
          ts.SyntaxKind.PublicKeyword,ts.SyntaxKind.PrivateKeyword,
          ts.SyntaxKind.ProtectedKeyword,ts.SyntaxKind.ReadonlyKeyword
        ].includes(f.kind)))names.add(parameter.name.text);
      }
    }
  }
  return names;
}
function sameFileAncestors(ts,stmt,classes){
  // Syntactic evidence only. No imported bases, mixins, getters evaluated,
  // private/static members or TypeScript type-program assumptions.
  const inherited=new Set(),visited=new Set([stmt]);
  let current=stmt;
  for(let depth=0;depth<8;depth++){
    const extendsClause=current.heritageClauses?.find(
      c=>c.token===ts.SyntaxKind.ExtendsKeyword);
    const base=extendsClause?.types?.[0]?.expression;
    if(!base||!ts.isIdentifier(base))break;
    const ancestor=classes.get(base.text);
    if(!ancestor||visited.has(ancestor))break;
    visited.add(ancestor);
    for(const member of ancestor.members){
      const mods=member.modifiers??[];
      if(mods.some(m=>m.kind===ts.SyntaxKind.PrivateKeyword||
        m.kind===ts.SyntaxKind.StaticKeyword))continue;
      const name=member.name;
      if(name && (ts.isIdentifier(name)||ts.isStringLiteral(name)))
        inherited.add(name.text);
      if(ts.isConstructorDeclaration(member)){
        for(const param of member.parameters){
          const flags=param.modifiers??[];
          if(ts.isIdentifier(param.name)&&
            flags.some(m=>m.kind===ts.SyntaxKind.PublicKeyword||
              m.kind===ts.SyntaxKind.ProtectedKeyword)&&
            !flags.some(m=>m.kind===ts.SyntaxKind.PrivateKeyword))
            inherited.add(param.name.text);
        }
      }
    }
    current=ancestor;
  }
  return inherited;
}
function componentSymbols(ts,ast){
  const direct=new Set(),namespaces=new Set();
  for(const stmt of ast.statements){
    if(!ts.isImportDeclaration(stmt)||
       !ts.isStringLiteralLike(stmt.moduleSpecifier)||
       stmt.moduleSpecifier.text!=='@angular/core')continue;
    const clause=stmt.importClause;
    if(!clause||clause.isTypeOnly||!clause.namedBindings)continue;
    const b=clause.namedBindings;
    if(ts.isNamespaceImport(b))namespaces.add(b.name.text);
    else if(ts.isNamedImports(b))for(const entry of b.elements){
      if(!entry.isTypeOnly&&(entry.propertyName?.text??entry.name.text)==='Component')
        direct.add(entry.name.text);
    }
  }
  return {direct,namespaces};
}
function isComponent(ts,dec,aliases){
  const expr=dec.expression;
  if(!ts.isCallExpression(expr))return false;
  const target=expr.expression;
  if(ts.isIdentifier(target))return aliases.direct.has(target.text);
  return ts.isPropertyAccessExpression(target)&&target.name.text==='Component'&&
    ts.isIdentifier(target.expression)&&aliases.namespaces.has(target.expression.text);
}
function classReferences(ts,files){
  // The index must mirror SAC-PRE004: sorted files, decorated classes only.
  // Never merge members of helper classes: an inherited method is not locally
  // declared, and its validity must be decided by AOT, not by this analyzer.
  const byComponent=new Map();
  let componentIndex=0;
  for(const file of [...files].sort((a,b)=>a.path.localeCompare(b.path))){
    const ast=ts.createSourceFile(file.path,file.source,ts.ScriptTarget.Latest,true,
      file.path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    if(ast.parseDiagnostics?.length)continue;
    const aliases=componentSymbols(ts,ast);
    const classes=new Map(ast.statements.filter(stmt=>
      ts.isClassDeclaration(stmt)&&stmt.name).map(stmt=>[stmt.name.text,stmt]));
    for(const stmt of ast.statements){
      if(!ts.isClassDeclaration(stmt))continue;
      for(const dec of ts.getDecorators(stmt)??[]){
        if(!isComponent(ts,dec,aliases))continue;
        componentIndex++;
        byComponent.set(file.path+':'+componentIndex,{
          own:memberNames(ts,stmt),
          inherited:sameFileAncestors(ts,stmt,classes)
        });
      }
    }
  }
  return byComponent;
}
function rootMember(node){
  const expr=node?.ast??node;
  if(!expr || typeof expr!=='object')return null;
  const kind=expr.constructor?.name;
  if(kind==='PropertyRead'&&expr.receiver?.constructor?.name==='ImplicitReceiver')
    return expr.name;
  return null;
}
function directEventMethod(node){
  const expr=node?.ast??node;
  if(expr?.constructor?.name!=='Call')return null;
  return rootMember(expr.receiver);
}
function walkTemplate(nodes,members,totals,missing,limit){
  // Traversal keeps lexical variables inside the branch/template where Angular
  // introduces them. It is intentionally partial, NOT a full Angular binder.
  const visitArray=(items,scope)=>{
    const siblings=new Set(scope);
    for(const node of items){
      visit(node,siblings);
      // @let is visible only after its declaration in the same view.
      if(node?.constructor?.name==='LetDeclaration'&&typeof node.name==='string')
        siblings.add(node.name);
    }
  };
  const visit=(node,parent)=>{
    if(!node||typeof node!=='object')return;
    if(++totals.visited>limit)invalid();
    const kind=node.constructor?.name;
    const scope=new Set(parent);
    if(kind==='ForLoopBlock'){
      if(typeof node.item?.name==='string')scope.add(node.item.name);
      if(Array.isArray(node.contextVariables)){
        for(const variable of node.contextVariables)
          if(typeof variable?.name==='string')scope.add(variable.name);
      }
    }
    if(kind==='Template'&&Array.isArray(node.variables)){
      for(const variable of node.variables)
        if(typeof variable?.name==='string')scope.add(variable.name);
    }
    if(kind==='IfBlockBranch'&&typeof node.expressionAlias?.name==='string')
      scope.add(node.expressionAlias.name);
    // Element refs are only recognized within this element's subtree;
    // cross-sibling/angular-exportAs scope needs the full binder.
    if(kind==='Element'&&Array.isArray(node.references)){
      for(const ref of node.references)
        if(typeof ref?.name==='string')scope.add(ref.name);
    }
    if(kind==='BoundEvent'){
      totals.events++;
      const name=directEventMethod(node.handler);
      if(name){
        if(scope.has(name))totals.templateLocalEventCalls++;
        else if(members.inherited.has(name)&&!members.own.has(name))
          totals.sameFileInheritedEventCalls++;
        else if(!members.own.has(name))missing.event=true;
      }
    }else if(kind==='BoundAttribute'){
      totals.properties++;
      const name=rootMember(node.value);
      if(name){
        if(scope.has(name))totals.templateLocalPropertyReads++;
        else if(members.inherited.has(name)&&!members.own.has(name))
          totals.sameFileInheritedPropertyReads++;
        else if(!members.own.has(name))missing.property=true;
      }
    }else if(kind==='BoundText')totals.interpolations++;
    for(const key of ['children','inputs','outputs','templateAttrs','branches','cases','body']){
      const children=node[key];
      if(Array.isArray(children))visitArray(children,scope);
    }
  };
  visitArray(nodes,new Set());
}

/**
 * Enforces the same bounded inventory contract as SAC-PRE004 and inspects only
 * external HTML templates for which that analyzer proved a static link.
 * The result remains UNVERIFIED even when parser errors are observed, because
 * the AOT builder alone can prove whether a template is compiled in an app.
 */
export function inspectAngularTemplateBindings({files,templates=[],typescript:ts,angularCompiler:ng}={}){
  if(!ng||typeof ng.parseTemplate!=='function'||
     !Array.isArray(files)||!Array.isArray(templates))invalid();
  const links=inspectAngularTemplateLinks({files,templates,typescript:ts});
  if(links.external_templates_linked>MAX_PARSED_TEMPLATES)invalid();
  const html=new Map(templates.map(item=>[item.path,item.source]));
  const byComponent=classReferences(ts,files);
  const totals={visited:0,events:0,properties:0,interpolations:0,
    sameFileInheritedEventCalls:0,sameFileInheritedPropertyReads:0,
    templateLocalEventCalls:0,templateLocalPropertyReads:0};
  const findings=[];
  const report=(code,file,component_index)=>{
    if(findings.length>=MAX_FINDINGS)invalid();
    findings.push({code,file,component_index});
  };
  let parsed=0,syntaxErrors=0,uncertainEvent=0,uncertainProperty=0;
  for(const link of links.links){
    let parsedTemplate;
    try{
      parsedTemplate=ng.parseTemplate(html.get(link.template_file),link.template_file,{
        preserveWhitespaces:false
      });
    }catch{
      report('angular-template-parser-exception-unverified',
        link.component_file,link.component_index);
      continue;
    }
    parsed++;
    if(Array.isArray(parsedTemplate.errors)&&parsedTemplate.errors.length){
      syntaxErrors+=parsedTemplate.errors.length;
      report('angular-template-parser-errors-observed',
        link.component_file,link.component_index);
      continue;
    }
    const members=byComponent.get(link.component_file+':'+link.component_index);
    const potential={event:false,property:false};
    if(!members || !Array.isArray(parsedTemplate.nodes)){
      report('template-expression-ast-unverified',
        link.component_file,link.component_index);
      continue;
    }
    walkTemplate(parsedTemplate.nodes,members,totals,potential,MAX_VISITS);
    if(potential.event){
      uncertainEvent++;
      report('event-handler-member-unverified',
        link.component_file,link.component_index);
    }
    if(potential.property){
      uncertainProperty++;
      report('property-binding-member-unverified',
        link.component_file,link.component_index);
    }
  }
  findings.sort((a,b)=>a.file.localeCompare(b.file)||
    a.component_index-b.component_index||a.code.localeCompare(b.code));
  return {
    schema_version:1,rule_id:'SAC-PRE005',status:'unverified',
    scope:'enumerated-angular-external-html-template-expressions-only',
    component_links_observed:links.external_templates_linked,
    external_templates_parsed:parsed,
    inline_templates_not_inspected:links.inline_templates_observed,
    template_parser_error_count:syntaxErrors,
    bound_events_observed:totals.events,
    bound_properties_observed:totals.properties,
    interpolations_observed:totals.interpolations,
    same_file_inherited_event_calls_observed:totals.sameFileInheritedEventCalls,
    same_file_inherited_property_reads_observed:totals.sameFileInheritedPropertyReads,
    template_local_event_calls_observed:totals.templateLocalEventCalls,
    template_local_property_reads_observed:totals.templateLocalPropertyReads,
    potential_event_handlers_not_declared_locally:uncertainEvent,
    potential_property_bindings_not_declared_locally:uncertainProperty,
    findings,
    complete_template_ast_coverage:false,
    aot_verified:false,runtime_verified:false,
    root_cause_verified:false,deployment_authorized:false
  };
}

/**
 * SAC-CANVAS: bounded source-only walker for large procedural/Canvas2D projects.
 * No import/eval of inspected code. One file's bytes/AST at a time.
 * Indicators are only discovery candidates; never proved bugs or runtime passes.
 */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';

const MiB=1024*1024;
const EXT=new Set(['.js','.mjs','.cjs','.jsx','.ts','.tsx']);
const SKIP=new Set(['.git','.angular','node_modules','dist','out','build',
 'coverage','vendor','.next','.cache','target','.turbo']);
const within=(root,x)=>x===root||x.startsWith(root+path.sep);
const code=x=>typeof x==='string'&&x.length<=128&&/^[a-z][a-z0-9-]*$/.test(x);
const numeric=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const isTS=(ts)=>ts&&typeof ts.createSourceFile==='function'&&
 typeof ts.forEachChild==='function'&&ts.SyntaxKind&&ts.ScriptTarget;

function inspectAST(ts,name,source,maxNodes){
 const kind=name.endsWith('.tsx')?ts.ScriptKind.TSX:
  name.endsWith('.jsx')?ts.ScriptKind.JSX:
  name.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS;
 const ast=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,kind);
 const signals={canvas_context:0,canvas_drawing:0,math_random:0,
  procedural_functions:0,seed_identifiers:0};
 let nodes=0;
 const proc=/^(?:generate|procedural|perlin|simplex|noise|seeded|createTerrain|buildMap|spawnChunk|makeChunk|rng|random|shuffle)/i;
 function walk(node){
  if(++nodes>maxNodes)throw Error('ast-node-budget');
  if(ts.isCallExpression(node)){
   const x=node.expression;
   if(ts.isPropertyAccessExpression(x)){
    const method=x.name.text;
    if(method==='getContext'&&node.arguments.length&&
       ts.isStringLiteral(node.arguments[0])&&
       node.arguments[0].text==='2d')signals.canvas_context++;
    if(['fillRect','strokeRect','clearRect','drawImage','putImageData',
       'getImageData','fillText','strokeText','arc','lineTo','moveTo',
       'setTransform','translate','rotate','scale'].includes(method))
      signals.canvas_drawing++;
    if(method==='random'&&ts.isIdentifier(x.expression)&&
       x.expression.text==='Math')signals.math_random++;
   }
  }
  if(ts.isFunctionDeclaration(node)&&node.name&&proc.test(node.name.text))
   signals.procedural_functions++;
  if(ts.isMethodDeclaration(node)&&node.name&&
     ts.isIdentifier(node.name)&&proc.test(node.name.text))
    signals.procedural_functions++;
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)){
   if(proc.test(node.name.text)&&node.initializer&&
     (ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer)))
     signals.procedural_functions++;
   if(/^(?:seed|rng|randomSeed)$/i.test(node.name.text))
     signals.seed_identifiers++;
  }
  ts.forEachChild(node,walk);
 }
 walk(ast);
 return {signals,parse_errors:ast.parseDiagnostics?.length??0,nodes};
}
export async function scanProceduralCanvasWorkspace({
 workspace,sourceRoot='.',typescript,
 maxFiles=20000,maxBytes=256*MiB,maxFileBytes=512*1024,
 maxDirectories=4096,maxNodesPerFile=100000,maxElapsedMs=180000
}={}){
 if(typeof workspace!=='string'||!path.isAbsolute(workspace)||
    typeof sourceRoot!=='string'||!sourceRoot||
    path.isAbsolute(sourceRoot)||sourceRoot.includes('\\')||
    sourceRoot.split('/').some(x=>!x||x==='..'||x==='.')&&sourceRoot!=='.'||
    !isTS(typescript)||!numeric(maxFiles,1,20000)||
    !numeric(maxBytes,1,256*MiB)||!numeric(maxFileBytes,1,MiB)||
    !numeric(maxDirectories,1,4096)||
    !numeric(maxNodesPerFile,100,200000)||
    !numeric(maxElapsedMs,1000,180000))
   throw Error('invalid-procedural-scan-config');
 const ts=typescript;
 const limits={files:maxFiles,bytes:maxBytes,file_bytes:maxFileBytes};
 const report={
  schema_version:1,kind:'sac-procedural-canvas-source-stream',
  status:'unverified',scan_completed:false,scope:'source-only',
  limits,inventory:{directories:0,files_seen:0,source_files:0,
   source_bytes:0,ast_nodes:0,parse_error_files:0},
  signals:{canvas_context:0,canvas_drawing:0,math_random:0,
   procedural_functions:0,seed_identifiers:0},
  candidate_paths:{canvas:[],procedural:[],unseeded_random:[]},
  findings:[],snapshot_sha256:null,
  compile_verified:false,determinism_verified:false,
  canvas_pixels_verified:false,source_git_revision_verified:false,
  runtime_verified:false,deployment_authorized:false
 };
 const add=label=>{if(code(label)&&report.findings.length<16)
  report.findings.push(label);};
 const start=Date.now();
 let root,scanRoot;
 try{
  root=await realpath(workspace);
  scanRoot=await realpath(path.join(root,sourceRoot));
  if(!within(root,scanRoot))throw Error('source-root-escape');
  if((await lstat(scanRoot)).isSymbolicLink())throw Error('source-root-symlink');
 }catch(e){add(e?.message==='source-root-escape'?'source-root-escape':
  'source-root-unavailable');return report;}
 const digest=createHash('sha256');
 const candidates=(list,name)=>{if(list.length<24)list.push(name);};
 async function traverse(directory,depth){
  if(depth>32)throw Error('directory-depth-limit');
  if(++report.inventory.directories>maxDirectories)
   throw Error('directory-budget');
  if(Date.now()-start>maxElapsedMs)throw Error('scan-time-budget');
  const children=await readdir(directory,{withFileTypes:true});
  children.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  for(const item of children){
   if(Date.now()-start>maxElapsedMs)throw Error('scan-time-budget');
   const absolute=path.join(directory,item.name);
   if(!within(scanRoot,absolute))throw Error('source-root-escape');
   if(item.isSymbolicLink())throw Error('source-symlink-blocked');
   if(item.isDirectory()){
    if(!SKIP.has(item.name))await traverse(absolute,depth+1);
    continue;
   }
   if(!item.isFile())throw Error('source-special-file');
   report.inventory.files_seen++;
   if(!EXT.has(path.extname(item.name))||/\.d\.ts$/.test(item.name)||
      /\.min\.js$/.test(item.name))continue;
   if(report.inventory.source_files>=maxFiles)throw Error('source-file-budget');
   const st=await lstat(absolute);
   if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)
    throw Error('source-not-regular');
   if(st.size>maxFileBytes)throw Error('single-source-budget');
   if(report.inventory.source_bytes+st.size>maxBytes)
    throw Error('source-total-budget');
   const handle=await open(absolute,constants.O_RDONLY|
    constants.O_NOFOLLOW|constants.O_NONBLOCK);
   let buffer;
   try{
    const fdstat=await handle.stat();
    if(!fdstat.isFile()||fdstat.nlink!==1||
       fdstat.size!==st.size)throw Error('source-mutated');
    buffer=Buffer.alloc(fdstat.size);
    let pos=0;
    while(pos<buffer.length){
     const next=await handle.read(buffer,pos,buffer.length-pos,null);
     if(!next.bytesRead)throw Error('source-mutated');
     pos+=next.bytesRead;
    }
   }finally{await handle.close();}
   const rel=path.relative(root,absolute).split(path.sep).join('/');
   digest.update(rel+'\0').update(createHash('sha256').update(buffer).digest());
   const parsed=inspectAST(ts,rel,buffer.toString('utf8'),maxNodesPerFile);
   report.inventory.source_files++;
   report.inventory.source_bytes+=buffer.length;
   report.inventory.ast_nodes+=parsed.nodes;
   if(parsed.parse_errors){
    report.inventory.parse_error_files++;
    add('source-syntax-diagnostic-observed');
   }
   for(const [k,n] of Object.entries(parsed.signals))
    report.signals[k]+=n;
   if(parsed.signals.canvas_context||parsed.signals.canvas_drawing)
    candidates(report.candidate_paths.canvas,rel);
   if(parsed.signals.procedural_functions||parsed.signals.seed_identifiers)
    candidates(report.candidate_paths.procedural,rel);
   if(parsed.signals.math_random)
    candidates(report.candidate_paths.unseeded_random,rel);
  }
 }
 try{
  await traverse(scanRoot,0);
  report.scan_completed=true;
  report.snapshot_sha256=digest.digest('hex');
 }catch(e){
  add(['directory-depth-limit','directory-budget','scan-time-budget',
   'source-root-escape','source-symlink-blocked','source-special-file',
   'source-file-budget','source-not-regular','single-source-budget',
   'source-total-budget','source-mutated','ast-node-budget']
   .includes(e?.message)?e.message:'scan-io-unverified');
 }
 return report;
}

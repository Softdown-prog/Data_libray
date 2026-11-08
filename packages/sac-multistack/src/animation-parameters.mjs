/**
 * SAC animation parameter audit: source-only AST observations plus separately
 * supplied frame samples. Does NOT execute or import inspected application code.
 * architecture/modules.json provides ownership/scope, NOT animation keyframes.
 */
import {createHash} from 'node:crypto';

const ID=/^[a-z][a-z0-9-]{0,63}$/;
const PATH=/^[A-Za-z0-9_.-][A-Za-z0-9_./-]{0,191}$/;
const MODULES=Object.freeze(['renderer','actors','simulation','phaser-game']);
const EXT=/\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const timing=/^(?:duration|interval|windup|cooldown|fps|frameRate|framesPerSecond|frameInterval|durationMs|durationSeconds|fadeTime|fadeMs|attackInterval|attackWindup|attackCooldown|swingDuration)$/i;
const upperTiming=/^(?:[A-Z][A-Z0-9]*_)*(?:DURATION|INTERVAL|COOLDOWN|WINDUP|FPS|FRAME_RATE|FRAME_INTERVAL|FADE_TIME)(?:_[A-Z0-9]+)*$/;
const opacity=/^(?:alpha|opacity|globalAlpha)$/i;
const SHA=text=>createHash('sha256').update(text).digest('hex');
const safeRel=value=>typeof value==='string'&&PATH.test(value)&&
 !value.includes('\\')&&!value.startsWith('/')&&
 value.split('/').every(x=>x&&x!=='.'&&x!=='..'&&
   !['.git','node_modules','.env'].includes(x)&&!x.startsWith('.env.'));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const report=(status,code,details={})=>Object.freeze({
 schema_version:1,kind:'sac-animation-parameters',status,code,
 input_origin:'host-supplied',source_git_revision_verified:false,
 source_executed:false,runtime_execution_verified:false,
 canvas_pixels_verified:false,root_cause_verified:false,
 deployment_authorized:false,...details
});

/** Bound a manifest from the Terrania-like architecture index. */
export function selectAnimationRoots(manifest,moduleIds=MODULES){
 if(!plain(manifest)||manifest.schemaVersion!==1||
    !Array.isArray(manifest.modules)||manifest.modules.length<1||
    manifest.modules.length>128||!Array.isArray(moduleIds)||
    !moduleIds.length||moduleIds.length>8||
    new Set(moduleIds).size!==moduleIds.length||
    moduleIds.some(x=>!ID.test(x)))throw Error('animation-module-manifest-invalid');
 const ids=new Set(),found=new Map();
 for(const item of manifest.modules){
  if(!plain(item)||!ID.test(item.id)||ids.has(item.id)||
     !Array.isArray(item.roots)||item.roots.length>16||
     item.roots.some(x=>!safeRel(x))||
     !['active','experimental','lab'].includes(item.status))
   throw Error('animation-module-manifest-invalid');
  ids.add(item.id);found.set(item.id,item);
 }
 const selected=moduleIds.map(id=>{
  const m=found.get(id);
  if(!m||m.status!=='active'||m.roots.length===0)
   throw Error('animation-modules-unavailable');
  return m;
 });
 const roots=[...new Set(selected.flatMap(m=>m.roots))].sort();
 if(roots.length>24)throw Error('animation-module-manifest-invalid');
 return Object.freeze({modules:moduleIds.slice(),roots});
}
function literal(ts,node,depth=0){
 if(!node||depth>5)return undefined;
 if(ts.isNumericLiteral(node))return Number(node.text);
 if(ts.isParenthesizedExpression(node))return literal(ts,node.expression,depth+1);
 if(ts.isPrefixUnaryExpression(node)){
  const v=literal(ts,node.operand,depth+1);
  if(v===undefined)return undefined;
  if(node.operator===ts.SyntaxKind.MinusToken)return -v;
  if(node.operator===ts.SyntaxKind.PlusToken)return v;
 }
 if(ts.isIdentifier(node)){
  if(node.text==='NaN')return NaN;
  if(node.text==='Infinity')return Infinity;
 }
 if(ts.isBinaryExpression(node)){
  const left=literal(ts,node.left,depth+1),right=literal(ts,node.right,depth+1);
  if(left===undefined||right===undefined)return undefined;
  switch(node.operatorToken.kind){
   case ts.SyntaxKind.PlusToken:return left+right;
   case ts.SyntaxKind.MinusToken:return left-right;
   case ts.SyntaxKind.AsteriskToken:return left*right;
   case ts.SyntaxKind.SlashToken:return left/right;
  }
 }
 return undefined;
}
function isTimer(name){return timing.test(name)||upperTiming.test(name);}
function analyseFile(ts,file,text,maximumNodes){
 const kind=file.endsWith('.tsx')?ts.ScriptKind.TSX:
   file.endsWith('.jsx')?ts.ScriptKind.JSX:
   file.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS;
 const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,kind);
 let nodes=0,parameters=0,dynamic=0,animationCalls=0;
 const findings=[];
 const add=(code,key)=>{if(findings.length<24)findings.push({code,file,key});};
 const inspect=(key,node)=>{
  if(!(isTimer(key)||opacity.test(key)))return;
  parameters++;
  const value=literal(ts,node);
  if(value===undefined){dynamic++;return;}
  if(!finite(value)){add('non-finite-animation-parameter',key);return;}
  if(opacity.test(key)){if(value<0||value>1)add('opacity-outside-zero-one',key);}
  else if(/fps|framerate|framespersecond/i.test(key)){
   if(value<=0||value>240)add('frame-rate-outside-supported-range',key);
  }else if(value<=0)add('non-positive-animation-timing',key);
 };
 const fnName=node=>node?.name&&ts.isIdentifier(node.name)?node.name.text:null;
 function walk(node){
  if(++nodes>maximumNodes)throw Error('animation-ast-node-budget');
  if(ts.isVariableDeclaration(node)&&fnName(node)){
   const parent=node.parent;
   if(parent&&ts.isVariableDeclarationList(parent)&&
      (parent.flags&ts.NodeFlags.Const)!==0)
    inspect(node.name.text,node.initializer);
  }
  if(ts.isPropertyAssignment(node)&&
     (ts.isIdentifier(node.name)||ts.isStringLiteral(node.name)))
   inspect(node.name.text,node.initializer);
  if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&
     ts.isPropertyAccessExpression(node.left)&&
     node.left.name.text==='globalAlpha')
   inspect('globalAlpha',node.right);
  if(ts.isCallExpression(node)){
   if(ts.isIdentifier(node.expression)&&
      ['requestAnimationFrame','setInterval','setTimeout'].includes(node.expression.text))
    animationCalls++;
   if(ts.isPropertyAccessExpression(node.expression)&&
      ['rotate','translate','scale','clearRect','drawImage','fillRect',
       'stroke','fill','requestAnimationFrame'].includes(node.expression.name.text))
    animationCalls++;
  }
  ts.forEachChild(node,walk);
 }
 walk(ast);
 return {nodes,parameters,dynamic,animationCalls,
  parseErrors:ast.parseDiagnostics?.length??0,findings};
}

/** Scopes supplied sources using the module map, records candidate mistakes.
 * No source-only observation ever becomes a runtime pass.
 */
export function inspectAnimationSources({manifest,sources,typescript,moduleIds=MODULES,
 maxNodesPerFile=100000}={}){
 if(!typescript?.createSourceFile||!typescript?.forEachChild||
    !typescript?.SyntaxKind||!typescript?.ScriptTarget||
    !Array.isArray(sources)||!sources.length||sources.length>512||
    !Number.isInteger(maxNodesPerFile)||maxNodesPerFile<100||
    maxNodesPerFile>150000)throw Error('animation-sources-invalid');
 const scope=selectAnimationRoots(manifest,moduleIds);
 let bytes=0,astNodes=0,parseErrors=0,parameters=0,dynamic=0,animationCalls=0;
 const findings=[],paths=[],seen=new Set();
 const digest=createHash('sha256');
 for(const item of [...sources].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)){
  if(!plain(item)||!safeRel(item.path)||!EXT.test(item.path)||
     !scope.roots.some(root=>item.path.startsWith(root+'/'))||
     typeof item.content!=='string'||seen.has(item.path))
   throw Error('animation-source-out-of-scope');
  const size=Buffer.byteLength(item.content);
  if(size>256*1024||(bytes+=size)>16*1024*1024)
   throw Error('animation-source-budget');
  seen.add(item.path);
  digest.update(item.path+'\0').update(SHA(item.content));
  const entry=analyseFile(typescript,item.path,item.content,maxNodesPerFile);
  astNodes+=entry.nodes;parseErrors+=entry.parseErrors;
  parameters+=entry.parameters;dynamic+=entry.dynamic;
  animationCalls+=entry.animationCalls;
  if((entry.parameters||entry.animationCalls)&&paths.length<32)paths.push(item.path);
  for(const finding of entry.findings)
   if(findings.length<48)findings.push(finding);
 }
 return report('unverified','static-animation-candidates-only',{
  modules:scope.modules,roots:scope.roots,source_files:seen.size,
  source_bytes:bytes,ast_nodes:astNodes,parse_error_files:parseErrors,
  parameters_observed:parameters,dynamic_parameters:dynamic,
  render_or_timer_calls:animationCalls,candidate_paths:paths,
  candidate_findings:findings,source_snapshot_sha256:digest.digest('hex')
 });
}

/** Frame samples are supplied by a host, NOT generated or authenticated here.
 * Compare two frame-rate streams at the same timeline checkpoints.
 * A pass means only those samples obey the contract, never the game runtime.
 */
export function assessAnimationFrameSamples({samples,positionTolerance=.5,
 rotationTolerance=.05,scaleTolerance=.03,opacityTolerance=.03}={}){
 if(!Array.isArray(samples)||samples.length<4||samples.length>512||
    ![positionTolerance,rotationTolerance,scaleTolerance,opacityTolerance]
      .every(x=>finite(x)&&x>=0&&x<=2))
  return report('unverified','animation-samples-invalid');
 const keys=['x','y','rotation','scaleX','scaleY','opacity'];
 const streams=new Map();
 for(const item of samples){
  if(!plain(item)||!Number.isInteger(item.fps)||item.fps<1||item.fps>240||
     !Number.isInteger(item.timeMs)||item.timeMs<0||item.timeMs>300000||
     !plain(item.pose)||keys.some(k=>!finite(item.pose[k]))||
     Object.keys(item.pose).some(k=>!keys.includes(k)&&k!=='progress'))
   return report('unverified','animation-samples-invalid');
  if('progress' in item.pose&&(!finite(item.pose.progress)||
     item.pose.progress<0||item.pose.progress>1))
   return report('fail','animation-progress-outside-zero-one');
  if(item.pose.opacity<0||item.pose.opacity>1)
   return report('fail','animation-opacity-outside-zero-one');
  if(item.pose.scaleX===0||item.pose.scaleY===0)
   return report('fail','animation-zero-scale');
  if(!streams.has(item.fps))streams.set(item.fps,new Map());
  const stream=streams.get(item.fps);
  if(stream.has(item.timeMs))return report('unverified','duplicate-animation-timestamp');
  stream.set(item.timeMs,item.pose);
 }
 if(streams.size!==2)return report('unverified','two-frame-rates-required');
 const [left,right]=[...streams.entries()].sort(([a],[b])=>a-b);
 if(left[1].size<2||left[1].size!==right[1].size||
    [...left[1].keys()].some(t=>!right[1].has(t)))
   return report('unverified','animation-checkpoints-not-aligned');
 let compared=0,maximumDelta=0;
 for(const [t,a] of [...left[1]].sort(([x],[y])=>x-y)){
  const b=right[1].get(t);
  const rotation=Math.abs(Math.atan2(Math.sin(a.rotation-b.rotation),
    Math.cos(a.rotation-b.rotation)));
  const deltas=[
   [Math.abs(a.x-b.x),positionTolerance],
   [Math.abs(a.y-b.y),positionTolerance],
   [rotation,rotationTolerance],
   [Math.abs(a.scaleX-b.scaleX),scaleTolerance],
   [Math.abs(a.scaleY-b.scaleY),scaleTolerance],
   [Math.abs(a.opacity-b.opacity),opacityTolerance]
  ];
  if(('progress' in a)!==('progress' in b))
   return report('unverified','animation-progress-schema-inconsistent');
  if('progress' in a)deltas.push([Math.abs(a.progress-b.progress),opacityTolerance]);
  maximumDelta=Math.max(maximumDelta,...deltas.map(([d])=>d));
  compared++;
  if(deltas.some(([delta,limit])=>delta>limit+1e-9))
   return report('fail','animation-frame-rate-drift',{
    checkpoints_checked:compared,first_mismatch_ms:t,frame_rates:[left[0],right[0]]
   });
 }
 return report('pass','supplied-animation-parameters-consistent',{
  checkpoints_checked:compared,frame_rates:[left[0],right[0]],
  maximum_observed_delta:Math.round(maximumDelta*1e6)/1e6
 });
}

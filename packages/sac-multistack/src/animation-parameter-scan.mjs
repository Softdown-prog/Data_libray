/**
 * Read-only, bounded adapter for architecture/modules.json (e.g. Terrania).
 * Only source modules selected by the architecture index are scanned.
 * No npm scripts, dynamic imports of game code, eval, browser or network calls.
 */
import {constants} from 'node:fs';
import {lstat,open,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectAnimationSources,selectAnimationRoots} from './animation-parameters.mjs';

const MiB=1024*1024;
const EXT=/\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP=new Set(['node_modules','.git','dist','build','out','coverage',
  '.angular','.next','.cache','target','vendor','.turbo']);
const within=(root,file)=>file===root||file.startsWith(root+path.sep);
const safeRel=rel=>typeof rel==='string'&&rel.length<=192&&
 /^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(rel)&&
 rel.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!SKIP.has(s)&&
   s!=='.env'&&!s.startsWith('.env.'));
const deny=code=>{throw Error(code);};
const allowedErrors=new Set(['animation-workspace-unavailable',
 'animation-module-manifest-invalid','animation-modules-unavailable',
 'animation-manifest-path-invalid','animation-source-symlink',
 'animation-source-budget','animation-file-budget','animation-dir-budget',
 'animation-special-file','animation-source-unavailable',
 'animation-ast-node-budget','animation-source-out-of-scope']);

/** Check every path segment before opening. Prevent traversal and symlink
 * escape even if final resolved path happens to live inside the checkout.
 */
async function approved(root,rel,limit){
 if(!safeRel(rel))deny('animation-manifest-path-invalid');
 let file=root;
 const parts=rel.split('/');
 for(let i=0;i<parts.length;i++){
  file=path.join(file,parts[i]);
  const st=await lstat(file);
  if(st.isSymbolicLink())deny('animation-source-symlink');
  if(i<parts.length-1&&!st.isDirectory())
   deny('animation-source-unavailable');
 }
 if(!within(root,await realpath(file)))deny('animation-source-symlink');
 const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const st=await h.stat();
  if(!st.isFile()||st.nlink!==1||st.size>limit)
   deny('animation-source-budget');
  const bytes=Buffer.alloc(st.size);
  let read=0;
  while(read<bytes.length){
   const n=await h.read(bytes,read,bytes.length-read,null);
   if(!n.bytesRead)deny('animation-source-unavailable');
   read+=n.bytesRead;
  }
  return bytes.toString('utf8');
 }finally{await h.close();}
}
function unavailable(code){
 return {
  schema_version:1,kind:'sac-terrania-animation-module-scan',
  status:'unverified',scan_completed:false,code,source_git_revision_verified:false,
  source_executed:false,runtime_execution_verified:false,
  canvas_pixels_verified:false,deployment_authorized:false
 };
}
export async function scanAnimationWorkspace({
 workspace,typescript,manifestPath='architecture/modules.json',
 moduleIds=['renderer','actors','simulation','phaser-game'],
 maxFiles=512,maxTotalBytes=16*MiB,maxFileBytes=256*1024,
 maxDirectories=256
}={}){
 if(typeof workspace!=='string'||!path.isAbsolute(workspace)||
   !typescript?.createSourceFile||
   !Number.isInteger(maxFiles)||maxFiles<1||maxFiles>512||
   !Number.isInteger(maxTotalBytes)||maxTotalBytes<1||maxTotalBytes>16*MiB||
   !Number.isInteger(maxFileBytes)||maxFileBytes<1||maxFileBytes>256*1024||
   !Number.isInteger(maxDirectories)||maxDirectories<1||maxDirectories>512)
  throw Error('animation-scan-configuration-invalid');
 if(!safeRel(manifestPath))return unavailable('animation-manifest-path-invalid');
 try{
  const stat=await lstat(workspace);
  if(!stat.isDirectory()||stat.isSymbolicLink())
   deny('animation-workspace-unavailable');
  const root=await realpath(workspace);
  const manifestText=await approved(root,manifestPath,64*1024);
  let manifest;
  try{manifest=JSON.parse(manifestText);}
  catch{deny('animation-module-manifest-invalid');}
  const selected=selectAnimationRoots(manifest,moduleIds);
  const sources=[],seen=new Set();
  let bytes=0,dirs=0,sourceCount=0;
  async function walk(rel,depth){
   if(depth>16||++dirs>maxDirectories)deny('animation-dir-budget');
   const dir=path.join(root,rel);
   if(!within(root,dir))deny('animation-source-symlink');
   // Enforce non-symlink directory components, including module roots.
   let checked=root;
   for(const segment of rel.split('/')){
    checked=path.join(checked,segment);
    const st=await lstat(checked);
    if(st.isSymbolicLink())deny('animation-source-symlink');
    if(!st.isDirectory())deny('animation-source-unavailable');
   }
   const entries=await readdir(dir,{withFileTypes:true});
   entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
   for(const item of entries){
    const name=rel+'/'+item.name,abs=path.join(root,name);
    if(!within(root,abs))deny('animation-source-symlink');
    if(item.isSymbolicLink())deny('animation-source-symlink');
    if(item.isDirectory()){
     if(!SKIP.has(item.name))await walk(name,depth+1);
     continue;
    }
    if(!item.isFile())deny('animation-special-file');
    if(!EXT.test(item.name)||/\.d\.ts$|\.min\.js$/.test(item.name))continue;
    if(!safeRel(name))deny('animation-source-unavailable');
    if(seen.has(name))continue;
    if(++sourceCount>maxFiles)deny('animation-file-budget');
    const content=await approved(root,name,maxFileBytes);
    bytes+=Buffer.byteLength(content);
    if(bytes>maxTotalBytes)deny('animation-source-budget');
    seen.add(name);sources.push({path:name,content});
   }
  }
  for(const rel of selected.roots){
   if(!safeRel(rel))deny('animation-module-manifest-invalid');
   // Missing declared roots mean incomplete coverage; never silently skip.
   await walk(rel,0);
  }
  if(!sources.length)deny('animation-source-unavailable');
  const observed=inspectAnimationSources({
   manifest,sources,typescript,moduleIds,maxNodesPerFile:100000
  });
  return {
   ...observed,kind:'sac-terrania-animation-module-scan',
   scan_completed:true,manifest_path:manifestPath,
   module_manifest_sha256:createHash('sha256').update(manifestText).digest('hex'),
   directories_scanned:dirs
  };
 }catch(error){
  const code=allowedErrors.has(error?.message)?error.message:
   error?.code==='ENOENT'?'animation-source-unavailable':'animation-source-unavailable';
  return unavailable(code);
 }
}

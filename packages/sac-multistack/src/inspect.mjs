// SAC multistack metadata preflight: bounded, read-only, no source execution.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { getModule } from './registry.mjs';

const safe=s=>typeof s==='string'&&s.length<=240&&
  /^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(s)&&
  s.split('/').every(x=>x&&x!=='.'&&x!=='..'&&x!=='.git'&&
    x!=='node_modules'&&x!=='.env'&&!x.startsWith('.env.'));
const within=(root,file)=>file===root||file.startsWith(root+path.sep);
async function readApproved(root,rel,limit,asText=false){
  let file=root;
  for(const component of rel.split('/')){
    file=path.join(file,component);
    const stat=await lstat(file);
    if(stat.isSymbolicLink())throw Error('source-symlink-blocked');
  }
  if(!within(root,await realpath(file)))throw Error('source-escape');
  const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=await fd.stat();
    if(!stat.isFile()||stat.nlink!==1||stat.size>limit)
      throw Error('source-budget-exceeded');
    if(!asText)return stat.size;
    const buffer=Buffer.alloc(stat.size+1);
    let offset=0;
    while(offset<buffer.length){
      const x=await fd.read(buffer,offset,buffer.length-offset,null);
      if(!x.bytesRead)break;
      offset+=x.bytesRead;
    }
    if(offset!==stat.size)throw Error('manifest-changed');
    return buffer.subarray(0,offset).toString('utf8');
  }finally{await fd.close();}
}
export async function inspectModule({workspace,moduleId,sourceFiles}={}){
  const module=getModule(moduleId);
  if(typeof workspace!=='string'||!path.isAbsolute(workspace)||
    !Array.isArray(sourceFiles)||sourceFiles.length>64||
    new Set(sourceFiles).size!==sourceFiles.length||
    sourceFiles.some(f=>!safe(f)))throw Error('unsafe-sac-module-input');
  const report={schema_version:1,module_id:module.id,status:'unverified',
    preflight:{status:'unverified',findings:[],selected_sources:sourceFiles.length},
    gates:module.gates.map(g=>({id:g.id,phase:g.phase,tool:g.tool,
      status:'not-run',reason:'requires-isolated-toolchain'})),
    source_sha_verified:false,runtime_verified:false,deployment_authorized:false};
  const findings=report.preflight.findings;
  const add=(code,subject=null)=>{
    if(findings.length<16)findings.push({code,subject});
  };
  let root;
  try{root=await realpath(workspace);}
  catch{add('workspace-unavailable');return report;}
  if(!sourceFiles.length){add('source-manifest-empty');return report;}
  let total=0;
  for(const file of sourceFiles){
    if(!module.extensions.some(ext=>file.endsWith(ext))){
      add('source-extension-incompatible');continue;
    }
    try{total+=await readApproved(root,file,1024*1024);}
    catch(err){
      if(err?.code==='ENOENT')add('source-file-missing');
      else if(err?.message==='source-symlink-blocked')add('source-symlink-blocked');
      else add('source-unreadable');
    }
    if(total>8*1024*1024)add('source-budget-exceeded');
  }
  for(const file of module.required_files){
    try{await readApproved(root,file,128*1024);}
    catch{add('required-manifest-unavailable',file);}
  }
  if(module.required_packages.length){
    let json;
    try{json=JSON.parse(await readApproved(root,'package.json',128*1024,true));}
    catch{add('package-manifest-invalid','package.json');}
    if(json!==undefined){
      const obj=x=>x===undefined||(x&&typeof x==='object'&&!Array.isArray(x));
      if(!json||typeof json!=='object'||Array.isArray(json)||
        !obj(json.dependencies)||!obj(json.devDependencies)){
        add('package-manifest-invalid','package.json');
      }else{
        const declared={...(json.dependencies||{}),...(json.devDependencies||{})};
        for(const name of module.required_packages){
          const v=declared[name];
          if(typeof v!=='string'||!v||v.length>256){
            add('required-package-undeclared',name);
          }
        }
      }
    }
  }
  if(findings.length){report.preflight.status='fail';report.status='fail';}
  else report.preflight.status='pass';
  // A clean manifest is not evidence of successful typecheck, build or browser.
  return report;
}

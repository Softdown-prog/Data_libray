/**
 * SAC bounded stress adapter against real public GitHub sources, no compilation.
 * Deterministic reviewed allowlist; never clones repositories, invokes tools,
 * imports source files or interprets package.json scripts. A partial successful
 * scan is NEVER a full project pass.
 */
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {inspectModule} from './inspect.mjs';
import {getModule} from './registry.mjs';
import {PUBLIC_STRESS_TARGETS,PUBLIC_STRESS_LIMITS} from './public-stress-targets.mjs';

const SHA=/^[0-9a-f]{40}$/;
const REPO=/^[a-zA-Z0-9-]+\/[a-zA-Z0-9.-]+$/;
const safePath=v=>typeof v==='string'&&v.length<=240&&
 /^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(v)&&
 v.split('/').every(s=>s&&s!=='.'&&s!=='..'&&s!=='.git'&&
 s!=='node_modules'&&s!=='.env'&&!s.startsWith('.env.'));
const status=['pass','fail','unverified'];
const hash=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const API='https://api.github.com/repos/';
function reject(msg){throw Error(msg);}
export function eligibleGitBlob(entry,extensions,limit=32768){
 return entry&&entry.type==='blob'&&entry.mode==='100644'&&
 SHA.test(entry.sha)&&Number.isInteger(entry.size)&&entry.size>=0&&
 entry.size<=limit&&safePath(entry.path)&&
 extensions.some(ext=>entry.path.endsWith(ext));
}
export function checkGitBlob(bytes,expectedSHA,maxBytes=32768){
 if(!Buffer.isBuffer(bytes)||!SHA.test(expectedSHA)||bytes.length>maxBytes)
   return false;
 return hash(bytes)===expectedSHA;
}
export function stableCandidates(tree,prefix,extensions,limit=32768){
 if(!Array.isArray(tree)||!safePath(prefix))throw Error('invalid-tree-data');
 return tree.filter(x=>eligibleGitBlob(x,extensions,limit))
   .sort((a,b)=>a.path.localeCompare(b.path,'en'))
   .map(x=>({path:prefix+'/'+x.path,sha:x.sha,size:x.size}))
   .filter(x=>safePath(x.path));
}
async function readLimitedResponse(response,maxBytes){
 if(!response.ok)throw Error('upstream-http-error');
 const len=Number(response.headers.get('content-length')||'0');
 if(len>maxBytes)throw Error('upstream-response-budget');
 let total=0;
 const chunks=[];
 if(!response.body)throw Error('upstream-no-body');
 for await(const bytes of response.body){
   total+=bytes.length;
   if(total>maxBytes){
     await response.body.cancel?.().catch(()=>{});
     throw Error('upstream-response-budget');
   }
   chunks.push(Buffer.from(bytes));
 }
 return Buffer.concat(chunks,total);
}
async function gitAPI(repo,route,{http,token,limits},size=limits.api_bytes_per_request){
 if(!REPO.test(repo)||!/^\/[A-Za-z0-9_./-]+$/.test(route)||
    route.split('/').includes('..'))reject('unsafe-upstream-url');
 const headers={'Accept':'application/vnd.github+json',
    'User-Agent':'SAC-public-repo-stress/1','X-GitHub-Api-Version':'2022-11-28'};
 if(typeof token==='string'&&token.length<1000&&token)
   headers.Authorization='Bearer '+token;
 const res=await http(API+repo+route,{
   headers,redirect:'error',signal:AbortSignal.timeout(10000)
 });
 return JSON.parse((await readLimitedResponse(res,size)).toString('utf8'));
}
async function fetchGitBlob(repo,sha,options){
 if(!SHA.test(sha))throw Error('invalid-git-blob-ref');
 const data=await gitAPI(repo,'/git/blobs/'+sha,options,98304);
 if(data.encoding!=='base64'||typeof data.content!=='string'||
    data.content.length>50000)throw Error('untrusted-git-blob-encoding');
 const bytes=Buffer.from(data.content.replace(/\s/g,''),'base64');
 if(!checkGitBlob(bytes,sha,options.limits.max_blob_bytes))
   throw Error('untrusted-git-blob-digest');
 return bytes;
}
async function runOne(target,options){
 const {limits}=options;
 const result={
   repository:target.repo,module_id:target.module,
   repository_size_kb:null,source_sha:null,
   sampled_directory:target.directory,tree_entries_scanned:0,
   tree_requests:0,blob_files_verified:0,blob_bytes_verified:0,
   metadata_status:'unverified',preflight_status:'not-run',
   overall_audit:'unverified',build:'not-run',tests:'not-run',
   browser:'not-run',deployment_authorized:false,
   finding:'not-checked'
 };
 const started=Date.now();
 try{
   const repo=await gitAPI(target.repo,'',options);
   if(repo.full_name!==target.repo||repo.private!==false||
      repo.default_branch!==target.branch||
      !Number.isInteger(repo.size)||repo.size<0)throw Error('repo-metadata');
   result.repository_size_kb=repo.size;
   const commit=await gitAPI(target.repo,'/commits/'+target.branch,options);
   const commitSHA=commit.sha,rootSHA=commit.commit?.tree?.sha;
   if(!SHA.test(commitSHA)||!SHA.test(rootSHA))
     throw Error('repo-sha-missing');
   result.source_sha=commitSHA;
   let treeSHA=rootSHA,entries,rootEntries;
   const components=[null,...target.directory.split('/')];
   for(let i=0;i<components.length;i++){
     if(++result.tree_requests>limits.max_tree_requests_per_repo)
       throw Error('tree-request-budget');
     const raw=await gitAPI(target.repo,'/git/trees/'+treeSHA,options);
     if(raw.truncated!==false||!Array.isArray(raw.tree)||
       raw.tree.length>limits.max_tree_entries)throw Error('tree-budget');
     result.tree_entries_scanned+=raw.tree.length;
     entries=raw.tree;
     if(i===0)rootEntries=entries;
     if(i<components.length-1){
       const next=components[i+1],item=entries.find(e=>e.path===next);
       if(item?.type!=='tree'||!SHA.test(item?.sha))
         throw Error('sample-directory-unavailable');
       treeSHA=item.sha;
     }
     if(Date.now()-started>limits.max_elapsed_ms_per_repo)
       throw Error('elapsed-budget');
   }
   const module=getModule(target.module);
   const sources=stableCandidates(entries,target.directory,module.extensions,
     limits.max_blob_bytes).slice(0,limits.max_blobs_per_repo);
   if(!sources.length){
     result.metadata_status='observed';
     result.finding='no-supported-sources-in-sample';
     return result;
   }
   const rootManifest=[];
   for(const filename of module.required_files){
     const item=rootEntries.find(e=>e.path===filename);
     if(!eligibleGitBlob(item,['.json','.toml','.mod'],
        limits.max_blob_bytes)){
       result.metadata_status='observed';
       result.finding='required-root-manifest-unavailable';
       return result;
     }
     rootManifest.push({...item,path:filename});
   }
   const stage=await mkdtemp(path.join(os.tmpdir(),'sac-public-stress-'));
   try{
     const files=[...sources,...rootManifest];
     for(const file of files){
       const bytes=await fetchGitBlob(target.repo,file.sha,options);
       result.blob_files_verified++;
       result.blob_bytes_verified+=bytes.length;
       if(result.blob_bytes_verified>limits.max_total_blob_bytes_per_repo)
         throw Error('blob-total-budget');
       const finalPath=path.join(stage,file.path);
       await mkdir(path.dirname(finalPath),{recursive:true});
       await writeFile(finalPath,bytes,{mode:0o444,flag:'wx'});
     }
     const inspected=await inspectModule({
       workspace:stage,moduleId:target.module,
       sourceFiles:sources.map(s=>s.path)
     });
     if(!status.includes(inspected.preflight.status)||
       inspected.runtime_verified!==false||
       inspected.deployment_authorized!==false||
       inspected.gates.some(g=>g.status!=='not-run'))
       throw Error('sac-evidence-contract-violation');
     result.metadata_status='observed';
     result.preflight_status=inspected.preflight.status;
     // Passing a few files is *not* a successful full repository audit.
     result.finding=inspected.preflight.status==='pass'?
       'bounded-preflight-only':'sample-preflight-incompatible';
   }finally{await rm(stage,{recursive:true,force:true});}
 }catch(error){
   result.finding=error?.message==='sac-evidence-contract-violation'?
     'sac-evidence-contract-violation':'limited-or-unavailable';
 }
 return result;
}
export async function runPublicRepoStress({http=fetch,token,targets=PUBLIC_STRESS_TARGETS,
 limits=PUBLIC_STRESS_LIMITS}={}){
 if(!Array.isArray(targets)||targets.length===0||targets.length>5||
   targets.some(t=>!PUBLIC_STRESS_TARGETS.some(a=>a===t)))
   throw Error('unapproved-public-stress-targets');
 const results=[];
 for(const target of targets)
   results.push(await runOne(target,{http,token,limits}));
 return {
  schema_version:1,kind:'sac-huge-public-repository-bounded-stress',
  execution:'public-git-metadata-and-verified-blob-samples-only',
  full_clone:false,third_party_code_executed:false,
  deployment_authorized:false,
  repositories:results
 };
}

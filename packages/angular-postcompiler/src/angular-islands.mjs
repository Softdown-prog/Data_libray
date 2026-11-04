/**
 * Opt-in static Angular-islands extension for compiled HTML documents.
 * This is NOT SAC-P001 v1, authenticated Angular ownership, runtime mounting,
 * full dependency coverage, gameplay certification or deploy approval.
 */
import path from 'node:path';
import {realpath,lstat,readFile} from 'node:fs/promises';
import {parse} from 'parse5';

const RULE='SAC-P001-ISLAND-EXT';
const MAX_HTML=2*1024*1024,MAX_FILE=16*1024*1024,MAX_TOTAL=64*1024*1024;
const MAX_FILES=128;
const idPattern=/^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const assetPattern=/^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\\%?#:\s])(?!.*\/\/)(?!.*\/$)[A-Za-z0-9_./-]+$/;
const mountPattern=/^\/(?:[A-Za-z0-9_-]+\/)*$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=code=>{const e=new Error(code);e.isSACFinding=true;throw e;};
const hasKeys=(o,keys)=>plain(o)&&Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
const distinct=(a,limit,pattern,min=0)=>
  Array.isArray(a)&&a.length>=min&&a.length<=limit&&
  a.every(v=>typeof v==='string'&&pattern.test(v))&&new Set(a).size===a.length;
const field=(node,name)=>node.attrs?.find(a=>a.name===name)?.value;
function contractCheck(c){
  if(!hasKeys(c,[
    'schema_version','index','mount','host_ids','required_elements','forbidden_tags',
    'entrypoint_scripts','required_resources','allowed_resources','required_files','query_policy'
  ])||c.schema_version!==1||c.index!=='index.html'||!mountPattern.test(c.mount)||
    c.mount.length>128||!distinct(c.host_ids,128,idPattern,1)||
    !distinct(c.forbidden_tags,32,/^[a-z][a-z0-9-]{0,79}$/)||
    !distinct(c.entrypoint_scripts,32,assetPattern,1)||
    !distinct(c.required_resources,128,assetPattern,1)||
    !distinct(c.allowed_resources,128,assetPattern,1)||
    !distinct(c.required_files,128,assetPattern)||
    !['none','hex12'].includes(c.query_policy)||
    !Array.isArray(c.required_elements)||c.required_elements.length>32||
    !c.required_elements.every(x=>hasKeys(x,['tag','id'])&&
      /^[a-z][a-z0-9-]{0,79}$/.test(x.tag)&&idPattern.test(x.id))||
    new Set(c.required_elements.map(x=>x.id)).size!==c.required_elements.length||
    c.host_ids.some(id=>c.required_elements.some(x=>x.id===id))||
    !c.entrypoint_scripts.every(x=>c.required_resources.includes(x))||
    !c.required_resources.every(x=>c.allowed_resources.includes(x))||
    !c.required_files.every(x=>c.allowed_resources.includes(x)))
    fail('contract-invalid');
}
function reference(raw,c){
  if(typeof raw!=='string'||raw.length>256||/[\\%\x00-\x20\x7f]/.test(raw))
    fail('resource-url-invalid');
  let url;
  try{url=new URL(raw,'https://sac.invalid'+c.mount);}
  catch{fail('resource-url-invalid');}
  if(url.origin!=='https://sac.invalid'||!url.pathname.startsWith(c.mount)||
      url.hash|| (url.search&&!(
        c.query_policy==='hex12'&&/^\?v=[a-f0-9]{12}$/.test(url.search)
      )))fail('resource-url-outside-contract');
  const rel=url.pathname.slice(c.mount.length);
  if(!c.allowed_resources.includes(rel))fail('resource-not-allowed');
  return rel;
}
function activeNodes(html){
  const nodes=[];
  const visit=n=>{
    if(n.tagName==='template')return;
    nodes.push(n);
    for(const child of n.childNodes??[])visit(child);
  };
  visit(parse(html));
  return nodes;
}
async function readBounded(root,rel,limit,ledger){
  if(!assetPattern.test(rel)||++ledger.files>MAX_FILES)fail('resource-budget-exceeded');
  const absolute=path.join(root,rel);
  let real;
  try{real=await realpath(absolute);}
  catch(e){if(['ENOENT','ENOTDIR'].includes(e?.code))fail('resource-missing');throw e;}
  if(!real.startsWith(root+path.sep))fail('resource-outside-dist');
  const before=await lstat(absolute);
  if(!before.isFile()||before.isSymbolicLink()||before.size===0||
     before.size>limit||ledger.bytes+before.size>MAX_TOTAL)fail('resource-budget-or-type-invalid');
  const data=await readFile(absolute);
  const after=await lstat(absolute);
  if(data.length!==before.size||after.size!==before.size||
      after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)
    fail('resource-changed-during-read');
  ledger.bytes+=data.length;
  return data;
}
export async function verifyAngularIslands(dist,contract){
  try{
    contractCheck(contract);
    const root=await realpath(dist);
    const ledger={files:0,bytes:0};
    const html=(await readBounded(root,contract.index,MAX_HTML,ledger)).toString('utf8');
    const nodes=activeNodes(html);
    const ids=new Map();
    const tags=new Set();
    for(const n of nodes){
      if(n.tagName)tags.add(n.tagName);
      const id=field(n,'id');
      if(id){
        const found=ids.get(id);
        if(found)fail('duplicate-dom-id');
        ids.set(id,n.tagName);
      }
    }
    if(contract.host_ids.some(id=>!ids.has(id)))fail('host-id-coverage-invalid');
    if(contract.required_elements.some(({tag,id})=>ids.get(id)!==tag))
      fail('required-element-missing');
    if(contract.forbidden_tags.some(tag=>tags.has(tag)))fail('forbidden-tag');
    const bases=nodes.filter(n=>n.tagName==='base'&&field(n,'href')!==undefined);
    if(bases.length>1||(bases.length===1&&field(bases[0],'href')!==contract.mount))
      fail('base-href-invalid');
    const refs=[],scriptRefs=[];
    for(const n of nodes){
      const script=n.tagName==='script';
      const css=n.tagName==='link'&&(field(n,'rel')??'').toLowerCase().split(/\s+/).includes('stylesheet');
      const preload=n.tagName==='link'&&(field(n,'rel')??'').toLowerCase().split(/\s+/).includes('modulepreload');
      if(!script&&!css&&!preload)continue;
      const raw=field(n,script?'src':'href');
      if(!raw)fail('inline-or-missing-resource');
      if(script&&!['module','text/javascript','application/javascript',''].includes(
        (field(n,'type')??'').toLowerCase()))fail('script-type-unsupported');
      const rel=reference(raw,contract);
      if(script&&!rel.endsWith('.js')||css&&!rel.endsWith('.css')||preload&&!rel.endsWith('.js'))
        fail('resource-type-invalid');
      refs.push(rel);
      if(script)scriptRefs.push(rel);
    }
    if(new Set(refs).size!==refs.length||
       !contract.required_resources.every(x=>refs.includes(x))||
       !contract.entrypoint_scripts.every(x=>scriptRefs.includes(x)))
      fail('entrypoint-or-resource-coverage-invalid');
    for(const rel of new Set([...refs,...contract.required_files]))
      await readBounded(root,rel,MAX_FILE,ledger);
    return {schema_version:1,rule_id:RULE,status:'pass',
      host_count:contract.host_ids.length,entrypoint_count:contract.entrypoint_scripts.length,
      resource_count:refs.length,p001_v1_covered:false,
      runtime_mount_verified:false,deployment_authorized:false};
  }catch(e){
    return {schema_version:1,rule_id:RULE,
      status:e?.isSACFinding?'fail':'infra-error',
      code:e?.isSACFinding?e.message:'runtime-or-filesystem-error',
      p001_v1_covered:false,runtime_mount_verified:false,deployment_authorized:false};
  }
}

/**
 * Conservative, read-only Bun text-lock v1 parser for SAC-PRE001.
 * Handles JSONC comments/trailing commas, executes no project code.
 * Only pinned versions for direct registry packages are exposed.
 */
import semver from 'semver';
const NAME=/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const validName=x=>typeof x==='string'&&x.length<=160&&NAME.test(x);
const fail=code=>Object.freeze({status:'unverified',code,lookup:()=>null});
function cleanJSONC(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>4*1024*1024)return null;
 let stage='',string=false,escape=false,line=false,block=false;
 for(let i=0;i<raw.length;i++){
  const c=raw[i],n=raw[i+1];
  if(line){if(c==='\n'||c==='\r'){line=false;stage+=c;}else stage+=' ';continue;}
  if(block){
   if(c==='*'&&n==='/'){stage+='  ';i++;block=false;}
   else stage+=(c==='\n'||c==='\r')?c:' ';
   continue;
  }
  if(string){
   stage+=c;
   if(escape)escape=false;
   else if(c==='\\')escape=true;
   else if(c==='"')string=false;
   continue;
  }
  if(c==='"'){string=true;stage+=c;continue;}
  if(c==='/'&&n==='/'){line=true;stage+='  ';i++;continue;}
  if(c==='/'&&n==='*'){block=true;stage+='  ';i++;continue;}
  stage+=c;
 }
 if(string||block)return null;
 let output='',quoted=false,escaped=false;
 for(let i=0;i<stage.length;i++){
  const c=stage[i];
  if(quoted){
   output+=c;
   if(escaped)escaped=false;
   else if(c==='\\')escaped=true;
   else if(c==='"')quoted=false;
   continue;
  }
  if(c==='"'){quoted=true;output+=c;continue;}
  if(c===','){
   let j=i+1;
   while(j<stage.length&&/\s/.test(stage[j]))j++;
   if(stage[j]===']'||stage[j]==='}') {output+=' ';continue;}
  }
  output+=c;
 }
 return output;
}
export function parseBunTextLock(raw,{manifest,workspace=''}={}){
 const prepared=cleanJSONC(raw);
 if(prepared===null)return fail('bun-lock-jsonc-unsupported');
 let data;
 try{data=JSON.parse(prepared);}catch{return fail('bun-lock-jsonc-invalid');}
 if(!plain(data)||data.lockfileVersion!==1||!plain(data.workspaces)||
    !plain(data.packages)||Object.keys(data.workspaces).length>256||
    Object.keys(data.packages).length>12000)return fail('bun-lock-v1-unsupported');
 if(workspace!==''||!plain(manifest))
   return fail('bun-workspace-scope-unverified');
 const root=data.workspaces[''];
 if(!plain(root)||!validName(manifest.name)||root.name!==manifest.name)
   return fail('bun-root-workspace-mismatch');
 for(const field of ['dependencies','devDependencies','optionalDependencies']){
  const declared=manifest[field]??{},locked=root[field]??{};
  if(!plain(declared)||!plain(locked)||Object.keys(declared).length>1024||
     Object.keys(locked).length>1024)
    return fail('bun-workspace-declarations-unsupported');
  const keys=Object.keys(declared);
  if(keys.length!==Object.keys(locked).length||
     keys.some(name=>!validName(name)||typeof declared[name]!=='string'||
      declared[name].length>160||locked[name]!==declared[name]))
    return fail('bun-lock-declaration-drift');
 }
 const lookup=name=>{
  if(!validName(name)||!Object.hasOwn(data.packages,name))return null;
  const record=data.packages[name];
  if(!Array.isArray(record)||record.length<1||record.length>8||
     typeof record[0]!=='string'||record[0].length>240||
     !record[0].startsWith(name+'@'))return null;
  return semver.valid(record[0].slice(name.length+1));
 };
 return Object.freeze({status:'parsed',code:'bun-lock-v1-observed',lookup});
}

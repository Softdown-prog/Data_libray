/**
 * Stable, bounded rustc JSON error-code extraction.
 * Caller must invoke rustc with --error-format=json and verify subprocess status.
 * No untrusted compiler message, spans, paths, source or freeform fix suggestions
 * leave this module.
 */
const ERROR_CODE=/^E[0-9]{4}$/;
export function collectRustcErrorCodes({stderr,exitCode}={}){
 if(typeof stderr!=='string'||stderr.length>32768||
   !Number.isInteger(exitCode)||exitCode<=0||exitCode>255)return null;
 const lines=stderr.split(/\r?\n/).filter(Boolean);
 if(lines.length>64)return null;
 const codes=new Set();
 for(const line of lines){
   if(line.length>16384)return null;
   let item;
   try{item=JSON.parse(line);}catch{return null;}
   if(!item||typeof item!=='object'||Array.isArray(item)||
      typeof item.level!=='string')return null;
   if(item.level==='error'){
     const code=item.code?.code;
     if(typeof code==='string'&&ERROR_CODE.test(code))codes.add(code);
   }
 }
 return Object.freeze([...codes].slice(0,8));
}

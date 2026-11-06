import alpinejs from '../profiles/alpinejs.mjs';
import vue from '../profiles/vue.mjs';
import nestjs from '../profiles/nestjs.mjs';
import python from '../profiles/python.mjs';
import javascript from '../profiles/javascript.mjs';
import css from '../profiles/css.mjs';
import html5 from '../profiles/html5.mjs';
import react from '../profiles/react.mjs';
import nextjs from '../profiles/nextjs.mjs';
import astro from '../profiles/astro.mjs';
import rust from '../profiles/rust.mjs';
import cpp20 from '../profiles/cpp20.mjs';
import go from '../profiles/go.mjs';
const entries=[alpinejs,vue,nestjs,python,javascript,css,html5,react,nextjs,astro,rust,cpp20,go];
const ID=/^[a-z][a-z0-9-]{0,63}$/;
const STAGES=new Set(['syntax','typecheck','lint','build','test','integration','browser']);
const TOOLS=new Set(['html-validate','playwright','vue-tsc','vite','tsc','nest',
 'supertest','python3','pytest','node','stylelint','project-bundler',
 'next','astro','cargo','cargo-clippy','g++','gofmt','go']);
function validate(p) {
 if(!p||p.schema_version!==1||!ID.test(p.id)||
   !['framework','language','standard'].includes(p.family)||
   !Array.isArray(p.required_files)||!Array.isArray(p.required_packages)||
   !Array.isArray(p.extensions)||p.extensions.length===0||
   !Array.isArray(p.gates)||p.gates.length===0||
   p.required_files.some(x=>!['package.json','Cargo.toml','go.mod'].includes(x))||
   p.required_packages.some(x=>typeof x!=='string'||!/^(@[a-z0-9-]+\/)?[a-z0-9._-]{1,128}$/.test(x))||
   p.extensions.some(x=>typeof x!=='string'||!/^\.[a-z0-9]{1,8}$/.test(x))||
   p.gates.some(g=>!g||!ID.test(g.id)||!TOOLS.has(g.tool)||!STAGES.has(g.phase))||
   new Set(p.gates.map(g=>g.id)).size!==p.gates.length)throw Error('invalid-module-profile');
 return Object.freeze({...p,
  required_files:Object.freeze([...p.required_files]),
  required_packages:Object.freeze([...p.required_packages]),
  extensions:Object.freeze([...p.extensions]),
  gates:Object.freeze(p.gates.map(g=>Object.freeze({...g})))});
}
const REGISTRY=new Map(entries.map(p=>[p.id,validate(p)]));
if(REGISTRY.size!==13)throw Error('invalid-module-registry');
export function listModules(){return [...REGISTRY.values()];}
export function getModule(id){
 if(typeof id!=='string'||!REGISTRY.has(id))throw Error('unknown-sac-module');
 return REGISTRY.get(id);
}

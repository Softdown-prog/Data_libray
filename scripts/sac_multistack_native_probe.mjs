// First-party synthetic native diagnostics. Never run third-party workspace code.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root=await mkdtemp(path.join(os.tmpdir(),'sac-native-negative-'));
const probes=[
 {module:'python',tool:'python3',name:'probe.py',
  positive:'answer: int = 42\n',negative:'def broken(:\n    pass\n',
  args:file=>['-m','py_compile',file]},
 {module:'javascript',tool:'node',name:'probe.js',
  positive:'const answer = 42;\n',negative:'const answer = ;\n',
  args:file=>['--check',file]},
 {module:'go',tool:'go',name:'probe.go',
  positive:'package probe\nvar Answer int = 42\n',
  negative:'package probe\nvar Answer int = "wrong"\n',
  args:file=>['tool','compile','-e','-o',path.join(root,'go.o'),file]},
 {module:'rust',tool:'rustc',name:'probe.rs',
  positive:'pub fn answer() -> i32 { 42 }\n',
  negative:'pub fn answer() -> i32 { "wrong" }\n',
  args:file=>['--edition=2021','--crate-type=lib','--emit=metadata',
    '-o',path.join(root,'rust.rmeta'),file]},
 {module:'cpp20',tool:'g++',name:'probe.cpp',
  positive:'consteval int answer(){return 42;}\nstatic_assert(answer()==42);\n',
  negative:'int answer = "wrong";\n',
  args:file=>['-std=c++20','-fsyntax-only','-Wall','-Wextra','-Wpedantic',
    '-Werror',file]}
];
const report={schema_version:1,kind:'first-party-negative-compiler-probes',
  deployment_authorized:false,checks:[]};
let valid=true;
try{
  for(const probe of probes){
    const file=path.join(root,probe.name);
    const run=source=>{
      // rustup is usually a proxy: preserve its installed toolchain home,
      // while disabling installs and keeping the synthetic source disposable.
      const env={PATH:process.env.PATH||'/usr/bin:/bin',HOME:root,
        CARGO_HOME:root,GOENV:'off',CI:'true'};
      if(probe.module==='rust'){
        env.RUSTUP_HOME=process.env.RUSTUP_HOME||path.join(os.homedir(),'.rustup');
        env.RUSTUP_AUTO_INSTALL='0';
      }
      const r=spawnSync(probe.tool,probe.args(file),{
        encoding:'utf8',timeout:20000,maxBuffer:8192,shell:false,
        cwd:root,env
      });
      return r.error?{kind:'unverified'}:
        r.signal?{kind:'unverified'}:{kind:r.status===0?'pass':'fail'};
    };
    await writeFile(file,probe.positive);
    const good=run();
    await writeFile(file,probe.negative);
    const bad=run();
    const status=good.kind==='pass'&&bad.kind==='fail'?'pass':
      good.kind==='unverified'||bad.kind==='unverified'?'unverified':'fail';
    report.checks.push({module_id:probe.module,tool:probe.tool,
      positive:good.kind,negative:bad.kind,status});
    if(status!=='pass')valid=false;
  }
}finally{
  await rm(root,{recursive:true,force:true});
}
assert.equal(report.deployment_authorized,false);
process.stdout.write(JSON.stringify(report)+'\n');
if(!valid)process.exitCode=1;

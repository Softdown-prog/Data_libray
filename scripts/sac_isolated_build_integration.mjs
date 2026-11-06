// SAC-008D: a real Angular official build happens only in a constrained Docker
// container. CI host reads the sources and signs the resulting dist (not build).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, symlink, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedAngularBuild } from './sac_sandbox_builder.mjs';
import { makeBuildTechnicalReport } from './sac_technical_report.mjs';
import { prepareBuild, sealBuild, auditPipeline } from '../packages/angular-pipeline/src/index.mjs';
import { verifyPipelineBrowserSandbox } from '../packages/angular-guardian/src/sandbox.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = path.join(root,'packages/angular-guardian/smoke');
const sourceSha = process.env.GITHUB_SHA ?? spawnSync('git',['rev-parse','HEAD'],
  { cwd:root, encoding:'utf8' }).stdout.trim();
const image = process.env.SAC_SANDBOX_IMAGE;
assert.match(sourceSha, /^[a-f0-9]{40}$/);
const key = randomBytes(32);
const profile = { schema_version:1, profile_id:'isolated-builder-ci', angular_version:'22.0.0',
  capabilities:['angular','workspace','static-dist'], mode:'angular-only', mount:'/',
  bundle_hints:{index:'index.html',angular_host:'sac-smoke',angular_entrypoints:['main.js'],
    assets:['styles.css'],legacy_react_entrypoints:[]},
  rules:['SAC-PRE001','SAC-P001'].map(rule_id=>({
    rule_id,version:'1.0.0',required:true,enforcement:'blocking'
  })) };
const resources = {workspace,dist:'dist/browser',
  sourceFiles:['package.json','package-lock.json','angular.json','tsconfig.json',
    'src/main.ts','src/mode.ts','src/index.html','src/styles.css']};
const guardian = {schema_version:1,timeout_ms:2000,cases:[{
  id:'click',path:'/',expect_visible:['h1'],actions:[{click:'button',expect_visible:'.done'}]
}]};
await writeFile(path.join(workspace,'src/mode.ts'),"export const mode: string = 'positive';\n");
await writeFile(path.join(workspace,'src/index.html'),
  '<html><head><base href="/"></head><body><sac-smoke></sac-smoke></body></html>');
await rm(path.join(workspace,'dist'),{recursive:true,force:true});
const setup = {profile,resources,key,sourceSha};
const {session,report:pre} = await prepareBuild(setup);
assert.ok(session,JSON.stringify(pre));

// Negative: untrusted project string must never become a shell/container command.
const denied = await isolatedAngularBuild({resources,projectName:'smoke;id',image});
assert.equal(denied.built,false);
assert.equal(denied.deployment_authorized,false);

const build = await isolatedAngularBuild({resources,projectName:'smoke',image,timeoutMs:120000});
assert.equal(build.status,'pass',JSON.stringify(build));
assert.equal(build.network,'none');
assert.equal(build.deployment_authorized,false);

const receipt = await sealBuild({...setup,session,buildStatus:'pass'});
const staticReport = await auditPipeline({...setup,receipt});
assert.equal(staticReport.static_pipeline_pass,true,JSON.stringify(staticReport));
const browser = await verifyPipelineBrowserSandbox({pipeline:{...setup,receipt},
  guardian,timeoutMs:60000,image});
assert.equal(browser.static_pipeline_pass,true,JSON.stringify(browser));
assert.equal(browser.browser_pass,true,JSON.stringify(browser));
assert.equal(browser.network_isolation,'container-network-none');
assert.equal(browser.deployment_authorized,false);
const altered = await auditPipeline({...setup,receipt:{...receipt,authentication:'0'.repeat(64)}});
assert.equal(altered.static_pipeline_pass,false);

// A pre-existing output cannot be replaced, even with a previously verified CI build.
const repeat = await isolatedAngularBuild({resources,projectName:'smoke',image});
assert.equal(repeat.status,'infra-error');
assert.equal(repeat.code,'dist-already-exists');

// A symlink destination parent cannot send output outside the workspace.
const temp = await mkdtemp(path.join(os.tmpdir(),'sac-builder-parent-'));
try {
  await symlink(temp,path.join(workspace,'linked-dist'));
  const bad = await isolatedAngularBuild({resources:{...resources,dist:'linked-dist/browser'},
    projectName:'smoke',image});
  assert.equal(bad.status,'infra-error');
  assert.equal(bad.code,'dist-parent-unsafe');
} finally {
  await rm(path.join(workspace,'linked-dist'),{force:true});
  await rm(temp,{force:true,recursive:true});
}
// Execute a second, fresh build through the actual One Worker inbox and gated
// Python supervisor, rather than invoking the isolated helper directly.
await rm(path.join(workspace,'dist'),{recursive:true,force:true});
const hostState = await mkdtemp(path.join(os.tmpdir(),'sac-008d-worker-'));
try {
  const write = async (name, content) => {
    const filename = path.join(hostState,name);
    await writeFile(filename, Buffer.isBuffer(content) || typeof content === 'string'
      ? content : JSON.stringify(content));
    return filename;
  };
  const manifestFile = await write('manifest.json',{
    schema_version:1,project_id:'synthetic-app',profile_id:'isolated-builder-ci',
    workspace,profile_file:await write('profile.json',profile),
    resources_file:await write('resources.json',resources),
    receipt_file:path.join(hostState,'receipt-not-used.json'),
    guardian_file:await write('guardian.json',guardian),
    trust_key_file:await write('hmac-secret',key),
    sandbox_image:image, build:{project_name:'smoke'}
  });
  const python = `
import json,sys
from pathlib import Path
from scripts import sac_job_queue as queue
from scripts import sac_execution as execution
state=Path(sys.argv[1])/"worker"
job={"schema_version":1,"job_id":"gha-456-1","project_id":"synthetic-app",
     "profile_id":"isolated-builder-ci","source_sha":sys.argv[3],"kind":"angular-validate"}
policy={"schema_version":1,"projects":[{"project_id":"synthetic-app","profile_id":"isolated-builder-ci"}]}
registry={"schema_version":1,"projects":[{"project_id":"synthetic-app",
   "profile_id":"isolated-builder-ci","manifest":sys.argv[2]}]}
queue.enqueue(state,job,policy)
assert queue.receive_pending(state,policy)["received"]==1
result=execution.execute_received(state,policy,registry,executor=sys.argv[4],
                                  enable_build=True,timeout=150)
assert result["processed"]==1,result
stored=json.loads((state/"sac-results"/"gha-456-1.json").read_text())
assert stored["status"]=="pass" and stored["execution"]=="sac-build-audit",stored
assert stored["code"]=="isolated-build-browser-pass" and stored["browser_pass"]==True,stored
assert stored["deployment_authorized"]==False,stored
assert execution.execute_received(state,policy,registry,enable_build=True)["processed"]==0
print("SAC_WORKER_ISOLATED_BUILD_PASS")
`;
  const worker = spawnSync('python3',['-c',python,hostState,manifestFile,sourceSha,process.execPath],{
    cwd:root,encoding:'utf8',timeout:190000,maxBuffer:20000,
    env:{PATH:process.env.PATH,HOME:os.tmpdir()}
  });
  assert.equal(worker.status,0,worker.stderr?.slice(0,3000));
  assert.match(worker.stdout,/SAC_WORKER_ISOLATED_BUILD_PASS/);
} finally {
  await rm(hostState,{recursive:true,force:true});
}
// Actual Angular negative build inside Docker, with no raw compiler log published.
const modeFile=path.join(workspace,'src/mode.ts');
try {
  await writeFile(modeFile,"export const mode: string = 123;\n");
  await rm(path.join(workspace,'dist'),{recursive:true,force:true});
  const failed=await isolatedAngularBuild({resources,projectName:'smoke',image,timeoutMs:120000});
  assert.equal(failed.status,'fail',JSON.stringify(failed));
  assert.equal(failed.code,'angular-compiler-failed');
  assert.equal(failed.built,false);
  assert.equal(failed.deployment_authorized,false);
  const evidence=failed.compiler_evidence;
  assert.equal(evidence.schema_version,2);
  assert.equal(evidence.phase,'build');
  assert.equal(evidence.status,'fail');
  assert.equal(evidence.exit_code,1);
  assert.equal(evidence.findings[0]?.code,'TS2322');
  assert.equal(evidence.findings[0]?.file,'src/mode.ts');
  assert.equal(evidence.findings[0]?.line,1);
  assert.ok(evidence.findings[0]?.column>0);
  assert.equal(evidence.findings[0]?.location_verified,true);
  assert.equal(evidence.post_status,'not-run');
  assert.equal(evidence.browser_status,'not-run');
  assert.equal(evidence.root_cause_verified,false);
  assert.equal(evidence.deployment_authorized,false);
  assert.ok(!JSON.stringify(evidence).includes('/opt/sac-work'));
  // Transport the same synthetic failure through the REAL supervised Worker
  // into its immutable result store, without touching the Panel or VPS.
  const negativeHost=await mkdtemp(path.join(os.tmpdir(),'sac-v2-negative-worker-'));
  try {
    const save=async (name,value)=>{
      const file=path.join(negativeHost,name);
      await writeFile(file,Buffer.isBuffer(value)||typeof value==='string'
        ?value:JSON.stringify(value));
      return file;
    };
    const manifest=await save('manifest.json',{
      schema_version:1,project_id:'synthetic-app',
      profile_id:'isolated-builder-ci',workspace,
      profile_file:await save('profile.json',profile),
      resources_file:await save('resources.json',resources),
      receipt_file:path.join(negativeHost,'receipt-unused.json'),
      guardian_file:await save('guardian.json',guardian),
      trust_key_file:await save('hmac-key',key),
      sandbox_image:image,build:{project_name:'smoke'}
    });
    const py=String.raw`
import json,sys
from pathlib import Path
from scripts import sac_job_queue as q, sac_execution as e
state=Path(sys.argv[1])/"state"
job={"schema_version":1,"job_id":"gha-990-1","project_id":"synthetic-app",
     "profile_id":"isolated-builder-ci","source_sha":sys.argv[3],
     "kind":"angular-validate"}
policy={"schema_version":1,"projects":[{"project_id":"synthetic-app",
 "profile_id":"isolated-builder-ci"}]}
registry={"schema_version":1,"projects":[{"project_id":"synthetic-app",
 "profile_id":"isolated-builder-ci","manifest":sys.argv[2]}]}
q.enqueue(state,job,policy)
assert q.receive_pending(state,policy)["received"]==1
result=e.execute_received(state,policy,registry,executor=sys.argv[4],
 enable_build=True,timeout=175)
assert result["processed"]==1,result
saved=json.loads((state/"sac-results"/"gha-990-1.json").read_text())
assert saved["schema_version"]==1 and saved["status"]=="fail",saved
assert saved["code"]=="angular-compiler-failed",saved
assert saved["diagnostic"]["status"]=="fail",saved
assert saved["technical_report"]["schema_version"]==2,saved
assert saved["technical_report"]["source_sha"]==sys.argv[3],saved
assert saved["technical_report"]["findings"][0]["code"]=="TS2322",saved
assert saved["technical_report"]["findings"][0]["file"]=="src/mode.ts",saved
assert saved["technical_report"]["findings"][0]["line"]==1,saved
assert saved["technical_report"]["post_status"]=="not-run",saved
assert saved["technical_report"]["browser_status"]=="not-run",saved
assert saved["technical_report"]["root_cause_verified"]==False,saved
assert saved["deployment_authorized"]==False,saved
assert e.execute_received(state,policy,registry,enable_build=True)["processed"]==0
print("SAC_V2_WORKER_REPORT_PERSISTED_PASS")
`;
    const p=spawnSync('python3',['-c',py,negativeHost,manifest,sourceSha,process.execPath],{
      cwd:root,encoding:'utf8',timeout:190000,maxBuffer:20000,
      env:{PATH:process.env.PATH,HOME:os.tmpdir()}
    });
    assert.equal(p.status,0,p.stderr?.slice(0,3000));
    assert.match(p.stdout,/SAC_V2_WORKER_REPORT_PERSISTED_PASS/);
    const resultPath=path.join(negativeHost,'state','sac-results','gha-990-1.json');
    const saved=JSON.parse(await readFile(resultPath,'utf8'));
    assert.match(saved.technical_report.text,/TS2322/);
    assert.match(saved.technical_report.text,/src\/mode.ts, linha 1/);
    assert.ok(!saved.technical_report.text.includes('Causa provável'));
    // Only a synthetic, validated example may become an Actions artifact.
    if(process.env.RUNNER_TEMP){
      await writeFile(path.join(process.env.RUNNER_TEMP,'sac-v2-technical-report.synthetic.txt'),
        saved.technical_report.text+'\n');
      await writeFile(path.join(process.env.RUNNER_TEMP,'sac-v2-technical-report.synthetic.json'),
        JSON.stringify(saved)+'\n');
    }
    console.log('SAC_V2_WORKER_TO_TEXT_PASS');
  } finally {
    await rm(negativeHost,{recursive:true,force:true});
  }
  console.log('SAC_BUILD_FAILURE_EVIDENCE_PASS');
} finally {
  await writeFile(modeFile,"export const mode: string = 'positive';\n");
  await rm(path.join(workspace,'dist'),{recursive:true,force:true});
}

// Angular-owned NG8002 must also be recognized as source failure, not Docker failure.
const mainFile=path.join(workspace,'src/main.ts');
const originalMain=await readFile(mainFile,'utf8');
const externalTemplate=path.join(workspace,'src/invalid-template.html');
try {
  const brokenMain=originalMain.replace(/template: '[^']*'/,
    "templateUrl: './invalid-template.html'");
  assert.notEqual(brokenMain,originalMain,'fixture template was not replaced');
  await writeFile(mainFile,brokenMain);
  await writeFile(externalTemplate,'<button [notAnAngularButtonInput]="true">Run</button>\\n');
  await rm(path.join(workspace,'dist'),{recursive:true,force:true});
  const ngResources={...resources,
    sourceFiles:[...resources.sourceFiles,'src/invalid-template.html']};
  const failure=await isolatedAngularBuild({
    resources:ngResources,projectName:'smoke',image,timeoutMs:120000
  });
  assert.equal(failure.status,'fail',JSON.stringify(failure));
  assert.equal(failure.code,'angular-compiler-failed');
  const item=failure.compiler_evidence.findings.find(f=>f.code==='NG8002');
  assert.ok(item,JSON.stringify(failure.compiler_evidence));
  assert.equal(item.tool,'angular');
  assert.equal(item.file,'src/invalid-template.html');
  assert.equal(item.location_verified,true);
  const report=makeBuildTechnicalReport({
    schema_version:1,job_id:'gha-991-1',project_id:'synthetic-app',
    profile_id:'isolated-builder-ci',source_sha:sourceSha,kind:'angular-validate'
  },failure.compiler_evidence);
  assert.match(report.text,/NG8002/);
  assert.ok(!report.text.includes('notAnAngularButtonInput'));
  assert.equal(report.deployment_authorized,false);
  console.log('SAC_NG8002_OFFICIAL_AOT_NEGATIVE_PASS');
} finally {
  await writeFile(mainFile,originalMain);
  await rm(externalTemplate,{force:true});
  await rm(path.join(workspace,'dist'),{recursive:true,force:true});
}

console.log('SAC-008D real Angular AOT isolated Docker build + authenticated SAC + Chromium PASS');

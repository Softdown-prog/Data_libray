/**
 * CI-only adapter: convert two sanitized pinned-LHS probes into a read-only
 * SAC Core observation report. No remote fetch, writes or deployment.
 */
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {makeLhsObservationReport} from '../packages/angular-core/src/lhs-observation-report.mjs';

const expectedCommit='9537faa65c35b357bec49d9a9d76f85311f3be0c';
const expectedFiles=['sac-lhs-dynamic-evidence.json','sac-lhs-browser-evidence.json'];
const root=process.env.RUNNER_TEMP;
if(!root||!path.isAbsolute(root)||process.argv.length!==4)
  throw new Error('sac-core-observation-ci-arguments-invalid');
async function boundedJson(filepath,basename){
  const location=path.resolve(filepath);
  if(path.basename(location)!==basename||path.dirname(location)!==path.resolve(root))
    throw new Error('sac-core-observation-ci-path-invalid');
  const info=await lstat(location);
  if(!info.isFile()||info.isSymbolicLink()||info.size>65536||info.size<16)
    throw new Error('sac-core-observation-ci-size-invalid');
  return JSON.parse(await readFile(location,'utf8'));
}
const a=await boundedJson(process.argv[2],expectedFiles[0]);
const b=await boundedJson(process.argv[3],expectedFiles[1]);
const report=makeLhsObservationReport({
  sourceCommit:expectedCommit,artifactEvidence:a,browserEvidence:b
});
if(report.promotion_allowed||report.deployment_authorized||
   Object.values(report.checks).some(c=>c.approval!=='unverified'))
  throw new Error('sac-core-observation-policy-mismatch');
console.log(JSON.stringify(report,null,2));

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixedBrowserDockerArgs} from '../packages/sac-multistack/src/browser-docker.mjs';
const props={image:'mcr.microsoft.com/playwright@sha256:'+'a'.repeat(64),
 seccomp:'/tmp/guardian-seccomp.json',runtime:'/tmp/sac-runtime',
 dist:'/tmp/sac-dist',input:'/tmp/sac-input.json',
 name:'sac-multistack-'+'a'.repeat(20)};
test('browser command always uses no network, read-only, limited rootless identity',()=>{
 const a=fixedBrowserDockerArgs(props).join(' ');
 for(const required of ['--network none','--read-only','--user 1000:1000',
 '--cap-drop ALL','--security-opt no-new-privileges',
 '--security-opt seccomp=/tmp/guardian-seccomp.json',
 '--memory 768m','--pids-limit 128','--pull never',
 'dst=/opt/sac-dist,readonly'])assert.ok(a.includes(required),required);
 assert.ok(a.endsWith('node /opt/sac-runtime/src/entry.mjs'));
});
test('invalid images and mount injection are rejected',()=>{
 for(const change of [
  {image:'playwright:latest'},{name:'../unsafe'},
  {runtime:'/tmp/a,privileged'},{input:'relative.json'},
  {seccomp:'/tmp/a,ignored'}
 ])assert.throws(()=>fixedBrowserDockerArgs({...props,...change}));
});

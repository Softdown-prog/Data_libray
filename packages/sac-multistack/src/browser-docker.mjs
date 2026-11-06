// SAC multistack: fixed restrictive Docker policy, no project-provided commands.
import path from 'node:path';
const pinned=/^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/;
const volume=x=>typeof x==='string'&&path.isAbsolute(x)&&!x.includes(',');
export function fixedBrowserDockerArgs({image,seccomp,runtime,dist,input,name}){
 if(!pinned.test(image)||![seccomp,runtime,dist,input].every(volume)||
   !/^sac-multistack-[0-9a-f]{20}$/.test(name))
   throw Error('invalid-multistack-docker-config');
 return [
   'run','--rm','--init','--pull','never','--name',name,
   '--network','none','--read-only','--user','1000:1000',
   '--cap-drop','ALL','--cap-add','SYS_CHROOT',
   '--security-opt','no-new-privileges','--security-opt','seccomp='+seccomp,
   '--pids-limit','128','--cpus','1','--memory','768m','--memory-swap','768m',
   '--shm-size','256m','--tmpfs','/tmp:rw,nosuid,nodev,size=128m,mode=1777',
   '--mount','type=bind,src='+runtime+',dst=/opt/sac-runtime,readonly',
   '--mount','type=bind,src='+dist+',dst=/opt/sac-dist,readonly',
   '--mount','type=bind,src='+input+',dst=/opt/sac-input.json,readonly',
   '--env','HOME=/tmp','--env','PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
   image,'node','/opt/sac-runtime/src/entry.mjs'
 ];
}

// Bounded SAC driver of *production* Lan House Simulator engine and scene.
// The original simulation and renderer run only in the isolated browser.
import {createGame} from './sim/simulationState.ts';
import {stepGame,isValidSave} from './sim/engine.ts';
import {SceneRenderer} from './render/scene.ts';

const canvas=document.getElementById('scene');
if(!(canvas instanceof HTMLCanvasElement))throw Error('lhs-simulation-canvas-missing');
function run(seed,minutes){
 if(!Number.isInteger(seed)||seed<0||seed>4294967295||
    !Number.isInteger(minutes)||minutes<0||minutes>180)
  throw Error('invalid-simulation-scenario');
 const s=createGame(seed);
 const renderer=new SceneRenderer(canvas.getContext('2d',{willReadFrequently:true}));
 canvas.width=1000;canvas.height=610;
 const initial={minute:s.totalMinutes,customers:s.customers.length,
  nextCustomerId:s.nextCustomerId,served:s.served,rng:s.rng};
 renderer.draw(s,0);
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 const before=ctx.getImageData(0,0,1000,610).data.slice();
 for(let left=minutes;left>0;){
  const chunk=Math.min(left,30);
  stepGame(s,chunk);
  left-=chunk;
 }
 const state={
  minute:s.totalMinutes,customers:s.customers.length,
  nextCustomerId:s.nextCustomerId,served:s.served,
  rng:s.rng,cash:s.cash,reputation:s.reputation,
  totalActiveAndDeparted:s.customers.length+s.served+s.lostCustomers
 };
 renderer.draw(s,0);
 let changed=0,nontransparent=0;
 const after=ctx.getImageData(0,0,1000,610).data;
 for(let i=0;i<after.length;i+=4){
  if(after[i+3])nontransparent++;
  if(before[i]!==after[i]||before[i+1]!==after[i+1]||
    before[i+2]!==after[i+2]||before[i+3]!==after[i+3])changed++;
 }
 return {initial,state,changed,nontransparent,
  save_valid:isValidSave(s),width:canvas.width,height:canvas.height};
}
window.__sacLive=Object.freeze({kind:'lhs',run});

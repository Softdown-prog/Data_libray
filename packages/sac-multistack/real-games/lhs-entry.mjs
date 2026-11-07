// Bundled against a pinned Lan House Simulator revision; production modules only.
import {SceneRenderer} from './render/scene.ts';
import {createGame,random} from './sim/simulationState.ts';
const canvas=document.getElementById('scene');
if(!(canvas instanceof HTMLCanvasElement))throw Error('lhs-canvas-absent');
function render(seed,variation=0){
 canvas.width=1000;canvas.height=610;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw Error('lhs-canvas2d-absent');
 const state=createGame(seed);
 state.furniture.poster=variation?1:0;
 const renderer=new SceneRenderer(ctx);
 renderer.draw(state,0);
 return {width:canvas.width,height:canvas.height};
}
function sample(seed){
 const state=createGame(seed);
 return Array.from({length:32},()=>random(state));
}
window.__sacRealGame=Object.freeze({game:'lhs',render,sample});

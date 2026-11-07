// Bundled against pinned Terrania production WorldRenderer and world algorithms.
import {WorldRenderer} from './render/WorldRenderer.ts';
import {getTile,CHUNK_TILES,TILE_SIZE,CHUNK_PIXELS,isWalkable,chunkOf} from './world/terrain.ts';
const canvas=document.getElementById('scene');
if(!(canvas instanceof HTMLCanvasElement))throw Error('terrania-canvas-absent');
function render(seed,variation=0){
 canvas.width=512;canvas.height=512;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw Error('terrania-canvas2d-absent');
 ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,512,512);
 const world=new WorldRenderer(seed);
 const x=variation?CHUNK_PIXELS*2:CHUNK_PIXELS;
 world.render(ctx,x,0,512,512,0,false);
 const cached=world.getCachedCount();
 world.clear();
 return {width:canvas.width,height:canvas.height,cached,
  chunk_limit:24};
}
function sample(seed){
 const arr=[];
 // Samples across chunk boundaries, including negative global positions.
 for(const y of [-17,-16,-1,0,15,16,31])
  for(const x of [-17,-16,-1,0,15,16,31]){
   const tile=getTile(x,y,seed);
   if(!Number.isFinite(tile.decoration)||tile.decoration<0||tile.decoration>=1)
    throw Error('invalid-tile-decoration');
   if(!['grass','forest','path','sand','water'].includes(tile.ground))
    throw Error('unknown-ground');
   if(isWalkable(x,y,seed)!==(tile.ground!=='water'&&!tile.tree&&!tile.rock))
    throw Error('walkability-inconsistent');
   arr.push([tile.ground,tile.tree,tile.rock,tile.decoration]);
  }
 if(chunkOf(-1)!==-1||chunkOf(-CHUNK_PIXELS-1)!==-2||
    CHUNK_PIXELS!==TILE_SIZE*CHUNK_TILES)
  throw Error('chunk-boundary-invariant');
 return arr;
}
window.__sacRealGame=Object.freeze({game:'terrania',render,sample});

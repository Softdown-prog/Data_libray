/**
 * SAC procedural-property contracts on samples supplied by a trusted host.
 * Does not execute generators or import third-party game source.
 * Runtime origin is a host claim, not authenticated by this function.
 */
import {createHash} from 'node:crypto';
const SHA=data=>createHash('sha256').update(data).digest('hex');
const BASE={schema_version:1,kind:'sac-seeded-grid-properties',
  input_origin:'host-supplied-samples',runtime_execution_verified:false,
  git_revision_verified:false,canvas_pixel_verified:false,
  root_cause_verified:false,deployment_authorized:false};
const result=(status,code,details={})=>Object.freeze({
 ...BASE,status,code,...details
});
const integer=(x,a,b)=>Number.isInteger(x)&&x>=a&&x<=b;
export function assessProceduralGridSamples({
 width,height,maxTile,samples,requireSeedDiversity=false
}={}){
 if(!integer(width,1,512)||!integer(height,1,512)||
    width*height>65536||!integer(maxTile,1,255)||
    !Array.isArray(samples)||samples.length<2||samples.length>32||
    samples.length%2!==0||typeof requireSeedDiversity!=='boolean')
   return result('unverified','sample-contract-invalid');
 const seen=new Map();
 const size=width*height;
 let bytes=0;
 for(const item of samples){
  if(!item||!integer(item.seed,0,4294967295)||
    !integer(item.trial,0,1)||!(item.grid instanceof Uint8Array)||
    item.grid.byteLength!==size||
    (bytes+=size)>2*1024*1024)
   return result('unverified','sample-contract-invalid');
  if(!seen.has(item.seed))seen.set(item.seed,new Map());
  const pair=seen.get(item.seed);
  if(pair.has(item.trial))return result('unverified','duplicate-seed-trial');
  pair.set(item.trial,item.grid);
 }
 if(seen.size<1||seen.size>16||
    [...seen.values()].some(pair=>pair.size!==2||
      !pair.has(0)||!pair.has(1)))
   return result('unverified','missing-seed-repetition');
 const fingerprints=new Set();
 for(const pair of seen.values()){
  for(const grid of pair.values()){
   for(let i=0;i<grid.length;i++){
    if(grid[i]>maxTile)
     return result('fail','tile-out-of-range',{
      seeds_checked:seen.size,tiles_per_sample:size
     });
   }
  }
  const a=SHA(pair.get(0)),b=SHA(pair.get(1));
  if(a!==b)return result('fail','same-seed-nondeterministic',{
   seeds_checked:seen.size,tiles_per_sample:size
  });
  fingerprints.add(a);
 }
 if(requireSeedDiversity&&seen.size>=2&&fingerprints.size===1)
  return result('unverified','seed-diversity-unobserved',{
   seeds_checked:seen.size,tiles_per_sample:size
  });
 return result('pass','seed-and-tile-contracts-observed',{
  seeds_checked:seen.size,tiles_per_sample:size,
  repeated_samples:seen.size*2,
  distinct_grid_digests:fingerprints.size
 });
}

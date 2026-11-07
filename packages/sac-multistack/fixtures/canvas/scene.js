// First-party Canvas2D fixture, not a user game or external application.
const canvas=document.getElementById('scene');
const ctx=canvas.getContext('2d',{willReadFrequently:true});
if(!ctx)throw Error('canvas2d-not-supported');
const W=256,H=128;
const resize=()=>{
 const dpr=window.devicePixelRatio||1;
 canvas.style.width=W+'px';canvas.style.height=H+'px';
 canvas.width=Math.floor(W*dpr);canvas.height=Math.floor(H*dpr);
 ctx.setTransform(dpr,0,0,dpr,0,0);
 return dpr;
};
function render(seed){
 resize();
 let state=seed>>>0;
 const next=()=>{
  state^=state<<13;state^=state>>>17;state^=state<<5;
  return state>>>0;
 };
 ctx.clearRect(0,0,W,H);
 ctx.fillStyle='#101820';ctx.fillRect(0,0,W,H);
 ctx.save();
 for(let i=0;i<64;i++){
  const x=next()%W,y=next()%H;
  const size=2+(next()%12);
  ctx.fillStyle=i%2?'#52d6c5':'#ec8b48';
  ctx.fillRect(x,y,size,size);
 }
 ctx.restore();
 ctx.strokeStyle='#e1f0ff';ctx.lineWidth=2;
 ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(W,H);ctx.stroke();
 return {width:canvas.width,height:canvas.height};
}
function broken(){
 resize();
 ctx.clearRect(0,0,W,H); // synthetic negative: a blank frame
 return {width:canvas.width,height:canvas.height};
}
window.__sacCanvasFixture=Object.freeze({render,broken});

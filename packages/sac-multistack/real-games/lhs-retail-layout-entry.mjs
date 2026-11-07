// Original LHS queue, layout editing, customer movement and collision.
// Each layout uses the same 8-client synthetic *initial state* and production
// simulation, so regressions cannot hide behind random arrival statistics.
import {createGame,stepGame} from './sim/engine.ts';
import {purchaseApproach} from './sim/layout.ts';
import {retailQueueSlots} from './sim/retailQueue.ts';
import {counterQueueSlot,CUSTOMER_COLLISION_RADIUS} from './sim/checkoutQueue.ts';
import {expandDirection} from './sim/room.ts';
import {moveLayoutObject} from './sim/editableObjects.ts';
import {canTraverseLocalStep} from './sim/navigation.ts';

const IDS=new Set(Array.from({length:8},(_,i)=>i+1));
function scenario(layout,item){
 const s=createGame(1933);
 s.pricePerHour=40;s.reputation=10;s.inventory={soda:50,candy:50,snacks:50};
 s.cash=20000;s.nextCustomerId=100;
 let edited=true;
 if(layout==='east-expanded'){
  edited=expandDirection(s,'east').ok &&
   moveLayoutObject(s,'soda',{x:8.5,y:3},2).ok;
 }else if(layout==='interior-partition'){
  s.interiorWalls=[{axis:'x',x:5,y:3}];
 }
 const goal=purchaseApproach(item,s);
 s.customers=Array.from({length:8},(_,i)=>({
  id:i+1,stage:'shopping',x:2.6+(i%4)*.55,y:3.7+Math.floor(i/4)*.55,
  target:{...goal},route:[],pcIndex:null,costume:'regular',usedMinutes:0,
  waitingMinutes:0,offlineWait:0,happy:true,wallet:30,desiredItem:item,
  needs:{hunger:item==='soda'?0:100,thirst:item==='soda'?100:0,energy:60}
 }));
 const slots=retailQueueSlots(s,item);
 let slotsSeparated=true,counterSlotConflict=false;
 for(let i=0;i<slots.length;i++){
  for(let j=i+1;j<slots.length;j++)
   if(Math.hypot(slots[i].x-slots[j].x,slots[i].y-slots[j].y)<.64)
    slotsSeparated=false;
  for(let q=0;q<10;q++){
   const counter=counterQueueSlot(q,s);
   if(Math.hypot(slots[i].x-counter.x,slots[i].y-counter.y)<
     CUSTOMER_COLLISION_RADIUS)counterSlotConflict=true;
  }
 }
 let overlapCount=0,wallCrossings=0,teleports=0,movementCount=0;
 // Expansion/layout editing already debited the ledger before this trial.
 // Compare only transactions posted while the customers are simulated.
 const startCash=s.cash,startRevenue=s.revenue,startExpenses=s.expenses;
 let ticks=0;
 for(;ticks<360&&s.customers.some(c=>IDS.has(c.id));ticks++){
  const before=new Map(s.customers.filter(c=>IDS.has(c.id))
   .map(c=>[c.id,{x:c.x,y:c.y,stage:c.stage}]));
  stepGame(s,1);
  const group=s.customers.filter(c=>IDS.has(c.id));
  for(const c of group){
   const old=before.get(c.id);
   if(!old)continue;
   const distance=Math.hypot(c.x-old.x,c.y-old.y);
   if(distance>.001)movementCount++;
   if(distance>.55)teleports++;
   if(distance>0.00001&&!canTraverseLocalStep(s,old,c))wallCrossings++;
  }
  for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++)
   if(Math.hypot(group[i].x-group[j].x,group[i].y-group[j].y)<
     CUSTOMER_COLLISION_RADIUS-1e-6)overlapCount++;
 }
 return {layout,item,edited,slots_available:slots.length,
  slots_separated:slotsSeparated,counter_slot_conflict:counterSlotConflict,
  duration_minutes:ticks,remaining:s.customers.filter(c=>IDS.has(c.id)).length,
  purchases:s.purchases,revenue:s.revenue,expenses:s.expenses,
  cash_balanced:Math.abs(s.cash-startCash-(s.revenue-startRevenue)+
   (s.expenses-startExpenses))<1e-6,
  overlap_count:overlapCount,wall_crossings:wallCrossings,teleports,
  movement_count:movementCount};
}
function run(){
 return [
  scenario('default','soda'),
  scenario('east-expanded','soda'),
  scenario('interior-partition','candy')
 ];
}
window.__sacStress=Object.freeze({game:'lhs',run});

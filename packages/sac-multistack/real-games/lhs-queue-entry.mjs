// Pinned LHS production simulation: observe actual queue flow, not fake paths.
import {createGame,stepGame,isValidSave,entrance} from './sim/engine.ts';
import {counterQueueCustomers,counterQueueSlot,queueSlotsAreSeparated,MAX_COUNTER_QUEUE} from './sim/checkoutQueue.ts';
const run=(seed,minutes)=>{
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||!Number.isInteger(minutes)||minutes<1||minutes>360)
  throw Error('invalid-queue-scenario');
 const state=createGame(seed), seen=new Map();
 const summary={minutes:0,unique_visitors:0,queue_seen:false,
  max_counter_queue:0,moved_customer_ids:0,stage_changes:0,
  counter_slot_violations:0,invalid_positions:0,duplicate_ids:0,
  queue_slots_separated:queueSlotsAreSeparated(),saved_state_valid:false,
  entrance_available:entrance(state)};
 const moved=new Set();
 for(let tick=0;tick<minutes;tick++){
  stepGame(state,1);
  const queued=counterQueueCustomers(state);
  summary.max_counter_queue=Math.max(summary.max_counter_queue,queued.length);
  if(queued.length)summary.queue_seen=true;
  if(queued.length>MAX_COUNTER_QUEUE)summary.counter_slot_violations++;
  const ids=new Set();
  for(let i=0;i<queued.length;i++){
   const c=queued[i],slot=counterQueueSlot(i,state);
   if(!Number.isFinite(slot.x)||!Number.isFinite(slot.y))summary.counter_slot_violations++;
   if(c.stage!=='arriving'&&c.stage!=='waiting')summary.counter_slot_violations++;
  }
  for(const c of state.customers){
   if(ids.has(c.id))summary.duplicate_ids++;
   ids.add(c.id);
   if(!Number.isFinite(c.x)||!Number.isFinite(c.y)||!Number.isFinite(c.target.x)||
      !Number.isFinite(c.target.y))summary.invalid_positions++;
   const last=seen.get(c.id);
   if(last){
    if(Math.hypot(last.x-c.x,last.y-c.y)>.05)moved.add(c.id);
    if(last.stage!==c.stage)summary.stage_changes++;
   }
   seen.set(c.id,{x:c.x,y:c.y,stage:c.stage});
  }
 }
 summary.minutes=state.totalMinutes;
 summary.unique_visitors=state.nextCustomerId-1;
 summary.moved_customer_ids=moved.size;
 summary.saved_state_valid=isValidSave(state);
 summary.served=state.served;
 summary.customers_present=state.customers.length;
 summary.lost_customers=state.lostCustomers;
 return summary;
};
window.__sacBehavior=Object.freeze({game:'lhs',run});

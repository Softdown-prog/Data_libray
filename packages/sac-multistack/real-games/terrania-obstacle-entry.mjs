// Imported directly from the pinned Terrania production engine.
// All combat, collision, pathfinding and monster logic remain unchanged.
import {Player} from './actors/Player.ts';
import {Slime} from './actors/Slime.ts';
import {ClassicPursuit,inClassicAttackPosition} from './engine/ClassicPursuit.ts';
import {ClassicCombat} from './engine/ClassicCombat.ts';
import {OfflineSimulation} from './engine/OfflineSimulation.ts';
import {clearPath} from './world/collision.ts';

const DT=1/60,STILL={x:0,y:0};
const OPEN={canMove:()=>true};
const WALL={canMove:(x,y)=>!(x>=64&&x<=106&&y>=-32&&y<=48)};
const SEALED={canMove:(x)=>x<70||x>105};

function chase(kind,world,frames){
 const hero=new Player();hero.x=16;hero.y=16;
 const mob=new Slime('target',180,16);
 const mobs=new Map([[mob.id,mob]]);
 const follow=new ClassicPursuit();
 const initiallyBlocked=!clearPath(hero,mob,world);
 let walked=false,forbidden=0,reached=false;
 for(let i=0;i<frames;i++){
  const movement=follow.direction(DT,hero,mob.id,mobs,world);
  if(Math.hypot(movement.x,movement.y)>.05)walked=true;
  hero.update(DT,movement,world);
  if(!world.canMove(hero.x,hero.y))forbidden++;
  if(inClassicAttackPosition(hero,mob,world)){reached=true;break;}
 }
 return {kind,initiallyBlocked,walked,forbidden,reached,
  final_x:hero.x,final_y:hero.y,clear_after:clearPath(hero,mob,world)};
}
function switchTarget(){
 const hero=new Player();
 const one=new Slime('one',240,16),two=new Slime('two',16,215);
 const mobs=new Map([[one.id,one],[two.id,two]]);
 const follow=new ClassicPursuit();
 follow.direction(DT,hero,one.id,mobs,OPEN);
 const first=follow.destination;
 one.x=265;
 follow.direction(DT,hero,one.id,mobs,OPEN);
 const moved=follow.destination;
 const swapped=follow.direction(DT,hero,two.id,mobs,OPEN);
 const second=follow.destination;
 follow.suspend();
 return {first_destination_x:first?.x??null,
  moved_target_destination_x:moved?.x??null,
  new_target_destination_y:second?.y??null,
  new_direction_y:swapped.y,
  suspended_destination_cleared:follow.destination===null};
}
function combat(){
 const sim=new OfflineSimulation(842136);
 sim.update(0,STILL,false);
 sim.slimes.clear();
 const focus=new Slime('focus',50,16),other=new Slime('other',44,16);
 sim.slimes.set(focus.id,focus);sim.slimes.set(other.id,other);
 const fight=new ClassicCombat();
 const selected=fight.select(focus.id,sim.slimes);
 let strikes=0,otherDamaged=false;
 for(let i=0;i<190;i++){
  const attack=fight.tick(DT,sim.player,sim.slimes,sim.collision);
  if(attack)strikes++;
  sim.update(DT,STILL,attack,fight.strikeTargetId);
  if(other.hp!==2)otherDamaged=true;
 }
 const invalidSelection=fight.select('not-a-real-monster',sim.slimes);
 const corpseSelection=fight.select(focus.id,sim.slimes);
 const final={selected,strikes,focus_hp:focus.hp,bystander_hp:other.hp,
  bystander_damaged:otherDamaged,kills:sim.kills,
  experience:sim.experience,focus_defeated:sim.defeated.has(focus.id),
  invalid_rejected:!invalidSelection,dead_target_rejected:!corpseSelection};
 return final;
}
function run(){
 return {passable_wall:chase('wall',WALL,400),
  impassable_wall:chase('sealed',SEALED,100),
  selected_target_switch:switchTarget(),focused_combat:combat()};
}
window.__sacStress=Object.freeze({game:'terrania',run});

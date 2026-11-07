// Pinned Terrania actual Phaser Game: battle-selection callback, pursuit,
// walking, attack and XP come from production modules, never mocked.
import {mountGame} from './game/PhaserGame.ts';
const parent=document.getElementById('mount');
if(!(parent instanceof HTMLElement))throw Error('terrania-parent-missing');
const SEED=842136,ID='-2,-2,0';
localStorage.setItem('terrania-origins-v1',JSON.stringify({
 seed:SEED,x:-660,y:-1008,hp:100,kills:0,defeated:[],experience:20
}));
localStorage.setItem('terrania-preferences-v1',JSON.stringify({
 zoom:1,effects:false,cameraMotion:false
}));
const trace={updates:0,hero:null,creatures:[],target:null,online:false};
let choose=null,stop=null,dispose=null;
const noop=()=>{};
const hud={
 menuOpen:false,loadPreferences:()=>({zoom:1,effects:false,cameraMotion:false}),
 onPreferences:noop,onNewWorld:noop,onTalk:noop,onPotionTrade:noop,
 onPotionUse:noop,onSwordPurchase:noop,onWeaponEquip:noop,onGearEquip:noop,
 onRespawn:noop,updateInventory:noop,updateLoadout:noop,updateGear:noop,
 setInventoryFeedback:noop,
 updateHero:hero=>{trace.updates++;trace.hero={
  hp:hero.hp,tileX:hero.tileX,tileY:hero.tileY,awaitingRespawn:hero.awaitingRespawn
 };},
 setOnline:flag=>{trace.online=flag;},
 setStatus:noop,setTargetCombat:noop,
 setCombatTarget:label=>{trace.target=label;},
 onStopCombat:fn=>{stop=fn;},
 onBattleSelect:fn=>{choose=fn;},
 setBattleCreatures:creatures=>{trace.creatures=creatures.map(c=>c.id);},
 setSeed:noop,setPlayerCount:noop,setNearbyAction:noop,
 showNpcDialogue:noop,setInterior:noop
};
function state(){
 return {updates:trace.updates,hero:trace.hero,
  creature_visible:trace.creatures.includes(ID),target:trace.target,
  online:trace.online,canvas_created:document.querySelector('canvas#game')!==null};
}
function select(id){if(!choose)throw Error('select-not-bound');choose(id);return state();}
function cancel(){if(!stop)throw Error('stop-not-bound');stop();return state();}
function saved(){
 window.dispatchEvent(new Event('pagehide'));
 return JSON.parse(localStorage.getItem('terrania-origins-v1')??'null');
}
function destroy(){if(dispose){dispose();dispose=null;}return !document.getElementById('game');}
window.__sacBehavior=Object.freeze({game:'terrania',state,select,cancel,saved,destroy,slimeId:ID});
dispose=mountGame(parent,hud,'');

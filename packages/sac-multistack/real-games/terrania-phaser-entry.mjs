// First-party SAC adapter for the actual Terrania PhaserGame -> Game -> Input.
// No Angular UI nor multiplayer; fixed fake HUD implementing documented port.
import {mountGame} from './game/PhaserGame.ts';

const parent=document.getElementById('mount');
if(!(parent instanceof HTMLElement))throw Error('phaser-parent-missing');
let dispose=null;
const trace={updates:0,hero:null,status:null,seed:null,online:false,
 rows:0,combatTarget:null,gameCreated:false};
const noop=()=>{};
const hud={
 menuOpen:false,loadPreferences:()=>({zoom:1,effects:false,cameraMotion:false}),
 onPreferences:noop,onNewWorld:noop,onTalk:noop,onPotionTrade:noop,
 onPotionUse:noop,onSwordPurchase:noop,onWeaponEquip:noop,onGearEquip:noop,
 onRespawn:noop,updateInventory:noop,updateLoadout:noop,updateGear:noop,
 setInventoryFeedback:noop,
 updateHero:hero=>{trace.updates++;trace.hero={
  hp:hero.hp,tileX:hero.tileX,tileY:hero.tileY,
  awaitingRespawn:hero.awaitingRespawn
 };},
 setOnline:online=>{trace.online=online;},
 setStatus:status=>{trace.status=status;},
 setTargetCombat:noop,
 setCombatTarget:label=>{trace.combatTarget=label;},
 onStopCombat:noop,onBattleSelect:noop,
 setBattleCreatures:creatures=>{trace.rows=creatures.length;},
 setSeed:seed=>{trace.seed=seed;},
 setPlayerCount:noop,setNearbyAction:noop,
 showNpcDialogue:noop,setInterior:noop
};
function state(){
 const canvas=document.getElementById('game');
 const canvasRect=canvas?.getBoundingClientRect();
 return {...trace,gameCreated:!!canvas,
  width:canvas?.width??0,height:canvas?.height??0,
  cssWidth:Math.round(canvasRect?.width??0),
  cssHeight:Math.round(canvasRect?.height??0)};
}
function destroy(){
 if(dispose){dispose();dispose=null;}
 return document.getElementById('game')===null;
}
window.__sacLive=Object.freeze({kind:'terrania',state,destroy});
dispose=mountGame(parent,hud,''); // offline, URL mode=classico on runner

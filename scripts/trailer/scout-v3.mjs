import * as THREE from 'three';
import { PhysicsGame } from '../../src/physics.js';
import { buildEnvironment } from '../../src/environments.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Scout control schedules in the shipped PhysicsGame, never alter body poses,
// velocities, collision geometry, forces, or damage. The final recipes were
// verified in Chrome with normal keyboard events using scout-v2.mjs; the full
// capture pipeline likewise replays those events and records the live HUD.
const args = Object.fromEntries(process.argv.slice(2).map(x => { const [k,...v]=x.replace(/^--/,'').split('=');return[k,v.join('=')||true]; }));
const kind=args.level||'garage';
const ctx=new Proxy({}, {get:(_,k)=>k==='measureText'?()=>({width:200}):k==='createRadialGradient'?()=>({addColorStop(){}}):()=>{},set:()=>true});
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>ctx})};
let rand=74291;Math.random=()=>{rand=(1664525*rand+1013904223)>>>0;return rand/4294967296;};
let events=[];
const p=new PhysicsGame({onImpact:e=>events.push({kind:'player',t:p.time,speed:e.speed,damage:e.damage,body:e.body?.userData?.label}),onRivalImpact:e=>events.push({kind:'rival',t:p.time,speed:e.speed,damage:e.damage})});
p.setLevel(kind);const env=buildEnvironment(kind,new THREE.Scene(),p);
const map={ArrowUp:'throttle',ArrowRight:'steer',ArrowLeft:'steer',ArrowDown:'brake',Space:'boost',KeyQ:'q',KeyW:'w',KeyO:'o',KeyP:'p'};
function run(shot){
 p.reset();events=[];let rows=[],minUp=1,maxY=0,crash=null,rivalCrash=null,maxRoll=0,crashPos=null;
 for(let frame=0;frame<Math.round(shot.duration*30);frame++){
  const t=frame/30,input={};for(const[s,e,keys]of shot.keys)if(!p.outcome&&t>=s&&t<e)for(const k of keys)input[map[k]]=k==='ArrowLeft'?-1:1;
  p.step(1/30,input);
  const q=p.body.quaternion,u=new THREE.Vector3(0,1,0).applyQuaternion(q);
  minUp=Math.min(minUp,u.y);maxY=Math.max(maxY,p.body.position.y);maxRoll=Math.max(maxRoll,Math.abs(u.x));
  if(!crash&&p.crashed){crash=t;crashPos=p.body.position.toArray();}
  if(!rivalCrash&&p.rival?.crashed)rivalCrash=t;
  if(p.outcome&&p.outcome!=='wrecked')break;
  if(frame%9===0)rows.push({t,p:p.body.position.toArray(),up:u.toArray(),d:p.damage,r:p.rival?.body.position.toArray(),rd:p.rival?.damage});
 }
 const props=p.props.filter(b=>b.position.distanceTo(b.userData.initialPosition)>1).length;
 const clutter=p.props.filter(b=>b.userData.initialPosition.z>4&&b.position.distanceTo(b.userData.initialPosition)>.6).length;
 return{shot,outcome:p.outcome,crash,rivalCrash,crashPos,minUp,maxY,maxRoll,props,clutter,damage:p.damage,rivalDamage:p.rival?.damage,events,rows};
}
let shots=[];
if(args.recipes)shots=JSON.parse(await readFile(args.recipes,'utf8'));
else if(kind==='garage'){
 let i=0;
 for(const boost of [false,true])for(const roll of [['KeyQ','KeyO'],['KeyW','KeyP']])for(const start of [.1,.2,.3,.4,.5,.6,.7,.8,1,1.2])for(const dur of [.35,.6,1,2,5]){
  shots.push({name:`garage-v3-${i++}`,level:0,duration:8,hud:'controls',camera:{offset:[7,3.6,-9],fov:53},keys:[[0,8,boost?['ArrowUp','Space']:['ArrowUp']],[start,start+dur,roll]]});
 }
}else{
 let i=0;
 for(const base of [
  [[0,9,['ArrowUp']],[0,9,['Space']],[.3,1,['ArrowRight']],[1,1.6,['ArrowLeft']]],
  [[0,9,['ArrowUp']],[1.3,9,['Space']],[1.2,1.9,['ArrowRight']]],
  [[0,9,['ArrowUp']],[.7,9,['Space']],[.6,.9,['ArrowRight']]],
  [[0,9,['ArrowUp']],[2.7,9,['Space']],[.6,1.1,['ArrowRight']],[1.1,1.5,['ArrowLeft']]],
 ])for(const roll of [['KeyQ','KeyO'],['KeyW','KeyP'],['KeyQ','KeyW']])for(const start of [.5,.8,1.1,1.4,1.7,2,2.3,2.6,3,3.3,3.6,4])for(const dur of [.25,.5,.8,1.2,3]){
  shots.push({name:`porsche-v3-${i++}`,level:1,duration:8,hud:'controls',camera:{follow:'rival',offset:[-9,4.5,-10],fov:55},keys:[...base,[start,start+dur,roll]]});
 }
}
const results=[];let i=0;const begin=Date.now();
for(const shot of shots){const r=run(shot);if(args.all||(kind==='garage'&&r.crash&&r.minUp<-.3&&r.clutter>0)||(kind==='drag'&&r.rivalCrash&&r.minUp<-.3))results.push(r);if(++i%100===0)process.stderr.write(`${i}/${shots.length} ${results.length} matches ${((Date.now()-begin)/1000).toFixed(1)}s\n`);}
results.sort(kind==='garage'?(a,b)=>b.clutter-a.clutter||b.props-a.props||Math.abs(a.crashPos?.[2]-8)-Math.abs(b.crashPos?.[2]-8):(a,b)=>(a.rivalCrash-b.rivalCrash));
await mkdir('reference/qa/trailer/scout-v3',{recursive:true});
await writeFile(`reference/qa/trailer/scout-v3/${kind}-search.json`,JSON.stringify(results,null,2));
await writeFile(args.output||`reference/qa/trailer/scout-v3/${kind}-candidate-recipes.json`,JSON.stringify(results.slice(0,12).map(r=>r.shot),null,2));
console.log(JSON.stringify(results.slice(0,18).map(({rows,events,...r})=>({...r,events:events.filter(e=>e.kind==='rival'||e.damage>30)})),null,2));env.dispose();

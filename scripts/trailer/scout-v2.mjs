import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Recipe scouting drives only public key events. Camera and capture clock are
// controlled for repeatability; every collision uses the shipped game physics.
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=') || true];
}));
const recipes = JSON.parse(await readFile(args.recipes, 'utf8'));
const out = path.resolve(args.output || 'reference/qa/trailer/scout-v2');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-webgl', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling'] });
try {
  for (const shot of recipes) {
    const page = await browser.newPage({ viewport: { width: 768, height: 432 }, deviceScaleFactor: 1 });
    await page.addInitScript(({ seed }) => {
      localStorage.setItem('roadster-settings', JSON.stringify({ quality:'high', safeGraphics:false, muted:true, music:false, haptics:false, shake:true }));
      localStorage.setItem('roadster-manual-seen','true');
      sessionStorage.removeItem('roadster-graphics-active');
      let next = 1, now = 0;
      const queue = new Map();
      window.requestAnimationFrame = cb => { const id=next++; queue.set(id,cb);return id; };
      window.cancelAnimationFrame = id => queue.delete(id);
      Object.defineProperty(performance,'now',{value:()=>now});
      let randomState=seed;
      Math.random=()=>{randomState=(1664525*randomState+1013904223)>>>0;return randomState/4294967296;};
      window.__captureTick=()=>{now+=1000/30;const callbacks=[...queue.values()];queue.clear();for(const callback of callbacks)callback(now);};
    }, {seed:shot.seed||74291});
    await page.goto('http://localhost:5173/', {waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__roadster,null,{polling:100});
    await page.addStyleTag({content:'#loading,.topbar,#hangar,#hud,#dialog,#toast,.impact-vignette,.explosion-flash{display:none!important}'});
    await page.evaluate(shot=>{
      const g=window.__roadster;g.graphics.observeFrame=()=>false;g.renderer.domElement.focus();
      window.__events=[];
      for(const name of ['onImpact','onRivalImpact']){const original=g.physics[name];g.physics[name]=e=>{window.__events.push({type:name,time:g.physics.time,speed:e.speed,damage:e.damage,point:e.position});original?.(e);};}
      const render=g.graphics.render.bind(g.graphics);
      g.graphics.render=()=>{
        g.camera.clearViewOffset();
        const s=g.physics.state, r=g.physics.rival?.state;
        if(shot.camera){
          const target=shot.camera.target==='rival'&&r?r.position:s.position;
          const o=shot.camera.offset||[10,4,-8];
          g.camera.position.set(target.x+o[0],Math.max(1.4,target.y+o[1]),target.z+o[2]);
          g.camera.lookAt(target.x,target.y+(shot.camera.targetHeight??.3),target.z);
          g.camera.fov=shot.camera.fov||48;g.camera.updateProjectionMatrix();
        }
        g.cameraVisibility?.update(g.camera,g.car.group,1/30);render();
      };
      g.startLevel(shot.level);
      for(let i=0;i<60&&!g.input.enabled;i++)window.__captureTick();
    },shot);
    const rows=[];let hadCrash=false;
    for(let frame=0;frame<Math.round(shot.duration*30);frame++){
      const t=frame/30;
      const keys=[...new Set((shot.keys||[]).filter(([s,e])=>t>=s&&t<e).flatMap(([, ,k])=>k))];
      const row=await page.evaluate(({keys,t})=>{
        const g=window.__roadster, before=window.__keys||[];
        for(const code of before)if(!keys.includes(code))window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));
        for(const code of keys)if(!before.includes(code))window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));
        window.__keys=keys;window.__captureTick();
        const p=g.physics.state,r=g.physics.rival?.state;
        return {t,time:p.time,position:{...p.position},quaternion:{...p.quaternion},damage:p.damage,outcome:p.outcome,ringCount:p.ringCount,collectedRings:p.collectedRings,rival:r?{position:{...r.position},quaternion:{...r.quaternion},damage:r.damage,crashed:r.crashed,exploded:r.exploded}:null};
      },{keys,t});
      rows.push(row);
      const crashNow=!!row.rival?.exploded;
      if(frame%15===0||crashNow!==hadCrash){
        await page.screenshot({path:path.join(out,`${shot.name}-${String(frame).padStart(4,'0')}.jpg`),type:'jpeg',quality:86});
      }
      hadCrash=crashNow;
    }
    const events=await page.evaluate(()=>window.__events);
    const summary={shot,rows,events};
    await writeFile(path.join(out,`${shot.name}.json`),JSON.stringify(summary,null,2));
    console.log(JSON.stringify({name:shot.name,playerCrash:rows.find(r=>r.damage>=100)?.t,rivalCrash:rows.find(r=>r.rival?.exploded)?.t,rivalDamage:Math.max(0,...rows.map(r=>r.rival?.damage||0)),rings:Math.max(0,...rows.map(r=>r.ringCount||0)),events}));
    await page.close();
  }
}finally{await browser.close();}

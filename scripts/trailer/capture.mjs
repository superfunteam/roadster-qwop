import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

// Real game frames, driven by normal keyboard events. Only capture timing,
// presentation, and camera framing change; vehicle/props use the shipped physics.
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const width = Number(args.width || 1920), height = Number(args.height || 1080);
const fps = Number(args.fps || 30);
const output = path.resolve(args.output || 'reference/qa/trailer/raw');
await mkdir(output, { recursive: true });
const recipes = args.recipes ? JSON.parse(await readFile(args.recipes, 'utf8')) : [
  { name: 'garage-rocket-exit', level: 0, duration: 12, keys: [
    [0, 2, ['ArrowUp', 'Space']], [2, 2.6, ['KeyQ', 'Space']],
  ] },
];
const selected = args.shot ? recipes.filter((shot) => shot.name === args.shot) : args.match ? recipes.filter((shot) => new RegExp(args.match).test(shot.name)) : recipes;
if (!selected.length) throw new Error(`No shot ${args.shot}`);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling'],
});
try {
  for (const shot of selected) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    // Editing another file must not hot-reload a deterministic recording.
    await page.routeWebSocket('**', () => {});
    const cdp = shot.hud ? await page.context().newCDPSession(page) : null;
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(({ fps, seed }) => {
      localStorage.setItem('roadster-settings', JSON.stringify({ quality: 'high', safeGraphics: false, muted: true, music: false, haptics: false, shake: true }));
      localStorage.setItem('roadster-manual-seen', 'true');
      sessionStorage.removeItem('roadster-graphics-active');
      let next = 1, now = 0;
      const queue = new Map();
      window.requestAnimationFrame = (callback) => { const id = next++; queue.set(id, callback); return id; };
      window.cancelAnimationFrame = (id) => queue.delete(id);
      Object.defineProperty(performance, 'now', { value: () => now });
      let randomState = seed;
      Math.random = () => { randomState = (1664525 * randomState + 1013904223) >>> 0; return randomState / 4294967296; };
      window.__captureTick = () => {
        now += 1000 / fps;
        const callbacks = [...queue.values()]; queue.clear();
        for (const callback of callbacks) callback(now);
      };
    }, { fps, seed: shot.seed || 74291 });
    await page.goto(args.url || 'http://localhost:5173/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__roadster, null, { polling: 100 });
    await page.addStyleTag({ content: shot.hud === 'controls'
      ? `#loading,.topbar,#hangar,#dialog,#toast,.impact-vignette,.explosion-flash,
          #game-message,.game-toolbar,.flight-tip,.hud-top .icon-button,
          #hud-level-number,#hud-level-name,#hud-goal { display:none!important }
         .booster-console { bottom:110px; transform:translateX(-50%) scale(1.15); transform-origin:center bottom }
         .drive-controls { bottom:130px; transform:scale(1.15); transform-origin:right bottom }
         .telemetry { bottom:130px } .flight-status { bottom:264px }
         .hud-top { justify-content:flex-end }
         .mission-title { position:absolute; right:0; top:72px }
         #ring-objective { margin-top:0 }
         #hud::before { background:linear-gradient(0deg,#05090dcc,transparent 34%) }`
      : shot.hud
        ? '#loading,#hangar,#dialog,#toast{display:none!important}'
        : '#loading,.topbar,#hangar,#hud,#dialog,#toast,.impact-vignette,.explosion-flash{display:none!important}' });
    await page.evaluate(({ shot, fps }) => {
      const game = window.__roadster;
      game.graphics.observeFrame = () => false; // Offline frame time is not a GPU benchmark.
      game.renderer.domElement.focus();
      window.__captureEvents = [];
      const impact = game.physics.onImpact;
      game.physics.onImpact = (event) => {
        window.__captureEvents.push({ type: 'impact', time: game.physics.time, intensity: event.intensity, point: event.point });
        impact(event);
      };
      const rivalImpact = game.physics.onRivalImpact;
      game.physics.onRivalImpact = (event) => {
        window.__captureEvents.push({ type: 'rival-impact', time: game.physics.time, intensity: event.intensity, speed: event.speed, damage: event.damage, point: event.point });
        rivalImpact?.(event);
      };
      const render = game.graphics.render.bind(game.graphics);
      game.graphics.render = () => {
        game.camera.clearViewOffset();
        if (shot.camera && game.mode === 'game') {
          const player = game.physics.state;
          const rival = game.physics.rival?.state;
          const s = { ...(shot.camera.follow === 'rival' && rival ? rival : player) };
          if (shot.camera.follow === 'both' && rival) {
            s.position = { x: (player.position.x + rival.position.x) / 2, y: (player.position.y + rival.position.y) / 2, z: (player.position.z + rival.position.z) / 2 };
          }
          const o = shot.camera.offset || [6, 4, -10];
          game.camera.position.set(s.position.x + o[0], Math.max(1.4, s.position.y + o[1]), s.position.z + o[2]);
          game.camera.lookAt(s.position.x, s.position.y + (shot.camera.targetHeight ?? 0.3), s.position.z);
          game.camera.fov = shot.camera.fov || 48;
          game.camera.updateProjectionMatrix();
        }
        // The cinematic camera is applied after the normal camera update.
        // Re-evaluate the shipped garage cutaway from its final position.
        game.cameraVisibility?.update(game.camera, game.car.group, 1 / fps);
        render();
      };
      if (shot.level !== null) {
        game.startLevel(shot.level);
        for (let i = 0; i < 60 && !game.input.enabled; i++) window.__captureTick();
      } else {
        for (let i = 0; i < 60; i++) window.__captureTick();
      }
    }, { shot, fps });
    const filename = path.join(output, `${shot.name}.mp4`);
    const encoder = spawn('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'mjpeg', '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', filename], { stdio: ['pipe', 'ignore', 'pipe'] });
    let encoderErrors = '';
    encoder.stderr.on('data', (data) => { encoderErrors += data.toString(); });
    const frames = Math.round(shot.duration * fps);
    const telemetry = [];
    const started = Date.now();
    for (let frame = 0; frame < frames; frame++) {
      const time = frame / fps;
      const keys = [...new Set((shot.keys || []).filter(([start, end]) => time >= start && time < end).flatMap(([, , keys]) => keys))];
      const result = await page.evaluate(({ keys, frame, fps, shotHud }) => {
        const game = window.__roadster;
        const before = window.__captureKeys || [];
        for (const code of before) if (!keys.includes(code)) window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
        for (const code of keys) if (!before.includes(code)) window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        window.__captureKeys = keys;
        window.__captureTick();
        const state = game.physics.state;
        return {
          image: game.renderer.domElement.toDataURL('image/jpeg', 0.97).split(',')[1],
          state: { frame, videoTime: frame / fps, physicsTime: state.time, position: { ...state.position }, quaternion: { ...state.quaternion }, speed: state.speed, altitude: state.altitude, damage: state.damage, crashed: state.crashed, outcome: state.outcome, controls: shotHud ? { held: [...document.querySelectorAll('#hud [data-control].held')].map(e => e.dataset.control), firing: [...document.querySelectorAll('#hud .jet-button.firing')].map(e => e.dataset.control) } : null, rampStage: state.rampStage, ringCount: state.ringCount, collectedRings: state.collectedRings, rival: game.physics.rival ? { ...game.physics.rival.state, position: { ...game.physics.rival.state.position }, quaternion: { ...game.physics.rival.state.quaternion }, velocity: { ...game.physics.rival.state.velocity } } : null, keys },
        };
      }, { keys, frame, fps, shotHud: Boolean(shot.hud) });
      telemetry.push(result.state);
      const image = cdp
        ? (await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 96, fromSurface: true })).data
        : result.image;
      const buffer = Buffer.from(image, 'base64');
      if (!encoder.stdin.write(buffer)) await once(encoder.stdin, 'drain');
      if (frame % (fps * 3) === 0) {
        await writeFile(path.join(output, `${shot.name}-${String(frame).padStart(4, '0')}.jpg`), buffer);
        console.log(`${shot.name} ${frame}/${frames}, video ${time.toFixed(1)}s, wall ${((Date.now() - started) / 1000).toFixed(1)}s, damage ${result.state.damage?.toFixed(0)}, altitude ${result.state.altitude?.toFixed(1)}`);
      }
    }
    encoder.stdin.end();
    const [code] = await once(encoder, 'exit');
    if (code) throw new Error(`ffmpeg exited ${code}: ${encoderErrors}`);
    const events = await page.evaluate(() => window.__captureEvents);
    const summary = { shot, width, height, fps, frames, elapsedSeconds: (Date.now() - started) / 1000, errors, events, telemetry };
    await writeFile(path.join(output, `${shot.name}.json`), JSON.stringify(summary, null, 2));
    console.log(`DONE ${filename}; ${summary.elapsedSeconds.toFixed(1)}s wall; errors ${errors.length}`);
    await page.close();
  }
} finally { await browser.close(); }

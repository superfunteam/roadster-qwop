import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

// Branded showroom animation only. This deliberately does not run or alter
// gameplay physics. Gameplay sequences are recorded separately via capture.mjs.
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const width = Number(args.width || 1920), height = Number(args.height || 1080);
const fps = Number(args.fps || 30);
const output = path.resolve(args.output || 'reference/qa/trailer/raw');
await mkdir(output, { recursive: true });
const shots = [
  { name: 'v3-hero-hover-intro', duration: 6, layout: 'intro' },
  { name: 'v3-hero-hover-end', duration: 9, layout: 'end' },
].filter(shot => !args.shot || shot.name === args.shot);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling'],
});
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.routeWebSocket('**', () => {});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ fps }) => {
      localStorage.setItem('roadster-settings', JSON.stringify({ quality: 'high', safeGraphics: false, muted: true, music: false, haptics: false, shake: false }));
      localStorage.setItem('roadster-manual-seen', 'true');
      sessionStorage.removeItem('roadster-graphics-active');
      let next = 1, now = 0, seed = 74291;
      const queue = new Map();
      window.requestAnimationFrame = callback => { const id = next++; queue.set(id, callback); return id; };
      window.cancelAnimationFrame = id => queue.delete(id);
      Object.defineProperty(performance, 'now', { value: () => now });
      Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
      window.__heroTick = () => {
        now += 1000 / fps;
        const callbacks = [...queue.values()]; queue.clear();
        for (const callback of callbacks) callback(now);
      };
    }, { fps });
    await page.goto(args.url || 'http://localhost:5173/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__roadster, null, { polling: 100 });
    await page.addStyleTag({ content: '#loading,.topbar,#hangar,#hud,#dialog,#toast,.impact-vignette,.explosion-flash{display:none!important}' });
    await page.evaluate(({ shot, width, height, fps }) => {
      const game = window.__roadster;
      game.graphics.observeFrame = () => false;
      const render = game.graphics.render.bind(game.graphics);
      window.__heroTime = -1;
      window.__heroStates = [];
      game.graphics.render = () => {
        const t = window.__heroTime;
        const bob = Math.sin(t * 1.55) * .045 + Math.sin(t * 2.8) * .012;
        const thrust = .71 + Math.sin(t * 2.8) * .035;
        game.car.group.position.set(0, 1.68 + bob, 0);
        game.car.group.rotation.set(Math.sin(t * .7) * .008, 0, Math.sin(t * 1.1) * .009);
        game.car.update(1 / fps, { speed: 0, steer: 0, boosters: [thrust, thrust, thrust, thrust] });
        game.car.group.updateMatrixWorld(true);
        game.effects.update(1 / fps, { boosterLevels: [thrust, thrust, thrust, thrust], rearBoost: 0, pressure: 1, velocity: { x: 0, y: 0, z: 0 } });
        // A showroom has clean air: retain the shipped exhaust, but use a fine
        // low-density mist so wheel clearance and all four jet cores stay legible.
        for (let i = 0; i < game.effects.alpha.length; i++) {
          game.effects.alpha[i] *= .22;
          game.effects.sizes[i] *= .6;
        }
        game.effects.geometry.attributes.aAlpha.needsUpdate = true;
        game.effects.geometry.attributes.aSize.needsUpdate = true;
        const angle = (shot.layout === 'end' ? .98 : .69) + t * .035;
        const distance = shot.layout === 'end' ? 10 : 8.8;
        game.camera.clearViewOffset();
        game.camera.position.set(Math.sin(angle) * distance, shot.layout === 'end' ? 3.1 : 3.2, Math.cos(angle) * distance);
        game.camera.lookAt(0, 1.4, 0);
        game.camera.fov = shot.layout === 'end' ? 38 : 38;
        if (shot.layout === 'end') game.camera.setViewOffset(width, height, -width * .19, -height * .025, width, height);
        else game.camera.setViewOffset(width, height, 0, height * .075, width, height);
        game.camera.updateProjectionMatrix();
        render();
      };
      // Let exhaust vapor settle before recording the clean showroom loop.
      for (let i = 0; i < fps; i++) { window.__heroTime = -1 + i / fps; window.__heroTick(); }
    }, { shot, width, height, fps });
    const filename = path.join(output, `${shot.name}.mp4`);
    const encoder = args.preview ? null : spawn('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'mjpeg', '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', filename], { stdio: ['pipe', 'ignore', 'pipe'] });
    let encoderErrors = '';
    encoder?.stderr.on('data', data => { encoderErrors += data.toString(); });
    const frames = args.preview ? 1 : Math.round(shot.duration * fps);
    const started = Date.now();
    const telemetry = [];
    for (let frame = 0; frame < frames; frame++) {
      const time = args.preview ? Number(args.at || 3) : frame / fps;
      const result = await page.evaluate(({ time }) => {
        window.__heroTime = time;
        window.__heroTick();
        const game = window.__roadster;
        return {
          image: game.renderer.domElement.toDataURL('image/jpeg', .98).split(',')[1],
          state: { time, presentation: 'branded-showroom', gameplay: false, position: game.car.group.position.toArray(), boosterLevels: [...game.effects.levels] },
        };
      }, { time });
      telemetry.push(result.state);
      const buffer = Buffer.from(result.image, 'base64');
      if (encoder && !encoder.stdin.write(buffer)) await once(encoder.stdin, 'drain');
      if (frame % (fps * 3) === 0 || args.preview) {
        await writeFile(path.join(output, `${shot.name}-${String(frame).padStart(4, '0')}.jpg`), buffer);
        console.log(`${shot.name} ${frame}/${frames}, ${(Date.now() - started) / 1000}s wall`);
      }
    }
    if (encoder) {
      encoder.stdin.end();
      const [code] = await once(encoder, 'exit');
      if (code) throw new Error(`ffmpeg exited ${code}: ${encoderErrors}`);
      await writeFile(path.join(output, `${shot.name}.json`), JSON.stringify({ shot, presentation: 'branded-showroom', width, height, fps, frames, errors, telemetry }, null, 2));
    }
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close();
    console.log(`DONE ${filename}`);
  }
} finally { await browser.close(); }

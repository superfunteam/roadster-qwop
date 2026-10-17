import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('reference/qa/trailer/design');
await mkdir(output, { recursive: true });
const roadster = await readFile('public/art/roadster-wordmark.svg', 'utf8');
const ui = await readFile('src/ui.js', 'utf8');
const teslaPath = ui.match(/const wordmark = `.*?<path fill="currentColor" d="([^"]+)"/s)[1];
const tesla = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 24"><path fill="#f5f5f5" d="${teslaPath}"/></svg>`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.setContent('<html><body style="margin:0;background:transparent"><canvas width="1920" height="1080"></canvas></body></html>');
for (const design of ['intro','garage','drag','ramp','factory','porsche','controls','freeze','freeze-hud','montage','end']) {
  const data = await page.evaluate(async ({ design, roadster, tesla }) => {
    const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 1920, 1080);
    const white = '#f3f4f6', muted = '#c1c8d0', red = '#e82127';
    async function logo(svg, x, y, w, h) {
      const image = new Image(); image.src = 'data:image/svg+xml;base64,' + btoa(svg);
      await image.decode(); ctx.drawImage(image, x, y, w, h);
    }
    function text(value, x, y, size = 40, weight = 400, color = white, spacing = 0, center = false) {
      ctx.font = `${weight} ${size}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = color; ctx.textBaseline = 'top';
      const measure = ctx.measureText(value).width + Math.max(0, value.length - 1) * spacing;
      if (center) x -= measure / 2;
      for (const letter of value) { ctx.fillText(letter, x, y); x += ctx.measureText(letter).width + spacing; }
    }
    function gradient(top, bottom, a, b) {
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, `rgba(4,7,12,${a})`); g.addColorStop(1, `rgba(4,7,12,${b})`);
      ctx.fillStyle = g; ctx.fillRect(0, top, 1920, bottom - top);
    }
    if (design === 'intro') {
      gradient(0, 350, .5, 0); gradient(700, 1080, 0, .95);
      await logo(tesla, 96, 82, 260, 34.67);
      text('FLIGHT TEST / 2026', 1500, 91, 19, 500, muted, 3);
      await logo(roadster, 360, 800, 1200, 72.63);
      text('BUT CAN IT FLY?', 960, 918, 44, 400, white, 8, true);
    } else if (['garage','drag','ramp','factory','porsche'].includes(design)) {
      gradient(0, 360, .88, 0);
      const data = { garage: ['01 / ORIENTATION', 'THE GARAGE', 'JUST BACK IT OUT.'], drag: ['02 / ACCELERATION', 'THE QUARTER MILE', 'STRAIGHT LINES. OPTIONAL.'], ramp: ['03 / FLIGHT CONTROL', 'THE INVERSION', 'NAIL THE LANDING.'], factory: ['04 / PRECISION FLIGHT', 'THE GIGAFACTORY', 'TEN RINGS. FIVE TO SURVIVE.'], porsche: ['RIVAL DETECTED', 'FRIENDLY COMPETITION.', 'CONTACT IS NOT ENCOURAGED.'] }[design];
      ctx.fillStyle = red; ctx.fillRect(96, 84, 44, 4);
      text('TEST ' + data[0], 160, 76, 20, 500, white, 3);
      text(data[1], 92, 121, 64, 500, white, 2);
      text(data[2], 96, 208, 25, 400, muted, 3);
    } else if (design === 'controls') {
      gradient(0, 330, .75, 0);
      text('FOUR BOOSTERS.', 96, 90, 54, 500, white, 2);
      text('ZERO FLIGHT ASSISTANCE.', 98, 158, 24, 400, muted, 3);
      for (const [i,key] of [...'QWOP'].entries()) {
        const x = 1460 + i * 88;
        ctx.fillStyle = '#0b1119dd'; ctx.fillRect(x, 84, 70, 70);
        ctx.strokeStyle = '#d9e0e666'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, 84.5, 70, 70);
        text(key, x + 35, 100, 37, 400, white, 0, true);
      }
    } else if (['freeze','freeze-hud'].includes(design)) {
      gradient(0, 1080, .12, .5);
      ctx.fillStyle = '#e82127'; ctx.fillRect(96, 90, 12, 12);
      text('ORIENTATION: QUESTIONABLE', 129, 82, 23, 500, white, 3);
      text('THIS IS FINE.', 960, design === 'freeze-hud' ? 330 : 770, 98, 500, white, 3, true);
    } else if (design === 'montage') {
      gradient(0, 300, .72, 0);
      text('FULL SELF-DESTRUCTION.', 96, 92, 55, 500, white, 2);
    } else if (design === 'end') {
      ctx.fillStyle = '#060a10ed'; ctx.fillRect(0, 0, 1920, 1080);
      await logo(tesla, 810, 156, 300, 40);
      await logo(roadster, 310, 354, 1300, 78.68);
      text('BUT CAN IT FLY?', 960, 481, 42, 400, white, 9, true);
      ctx.fillStyle = red; ctx.fillRect(916, 582, 88, 4);
      text('PLAY FREE', 960, 643, 29, 500, white, 5, true);
      text('roadster.superfun.games', 960, 716, 55, 400, white, 1, true);
      text('DESKTOP + MOBILE  /  NO DOWNLOAD REQUIRED', 960, 823, 20, 400, muted, 3, true);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, { design, roadster, tesla });
  await writeFile(path.join(output, `${design}.png`), Buffer.from(data, 'base64'));
}
await browser.close();
console.log('Trailer graphics exported using existing vector logos.');

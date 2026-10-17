import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Transparent brand graphics for the hovering showroom hero shots. The end
// layout leaves the entire right-hand half open for the live model and jets.
const output = path.resolve('reference/qa/trailer/design');
await mkdir(output, { recursive: true });
const roadster = await readFile('public/art/roadster-wordmark.svg', 'utf8');
const ui = await readFile('src/ui.js', 'utf8');
const teslaPath = ui.match(/const wordmark = `.*?<path fill="currentColor" d="([^"]+)"/s)[1];
const tesla = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 24"><path fill="#f5f5f5" d="${teslaPath}"/></svg>`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent('<html><body style="margin:0;background:transparent"><canvas width="1920" height="1080"></canvas></body></html>');
  for (const design of ['intro-v3', 'end-v3']) {
    const data = await page.evaluate(async ({ design, roadster, tesla }) => {
      const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 1920, 1080);
      const white = '#f3f4f6', muted = '#b9c0c8', red = '#e82127';
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
      function vertical(top, bottom, a, b) {
        const g = ctx.createLinearGradient(0, top, 0, bottom);
        g.addColorStop(0, `rgba(4,7,12,${a})`); g.addColorStop(1, `rgba(4,7,12,${b})`);
        ctx.fillStyle = g; ctx.fillRect(0, top, 1920, bottom - top);
      }
      if (design === 'intro-v3') {
        vertical(0, 330, .45, 0); vertical(740, 1080, 0, .88);
        await logo(tesla, 96, 82, 260, 34.67);
        text('FLIGHT TEST / 2026', 1500, 91, 19, 500, muted, 3);
        await logo(roadster, 360, 800, 1200, 72.63);
        text('BUT CAN IT FLY?', 960, 918, 44, 400, white, 8, true);
      } else {
        const left = ctx.createLinearGradient(0, 0, 1400, 0);
        left.addColorStop(0, 'rgba(4,7,12,.88)');
        left.addColorStop(.56, 'rgba(4,7,12,.72)');
        left.addColorStop(.79, 'rgba(4,7,12,.16)');
        left.addColorStop(1, 'rgba(4,7,12,0)');
        ctx.fillStyle = left; ctx.fillRect(0, 0, 1920, 1080);
        vertical(0, 230, .3, 0); vertical(850, 1080, 0, .5);
        await logo(tesla, 110, 128, 238, 31.73);
        ctx.fillStyle = red; ctx.fillRect(110, 305, 42, 4);
        text('FLIGHT TEST / OPEN TO EVERYONE', 170, 297, 17, 500, muted, 2.5);
        await logo(roadster, 110, 372, 815, 49.33);
        text('BUT CAN IT FLY?', 113, 463, 30, 400, white, 5.5);
        ctx.fillStyle = white; ctx.fillRect(110, 622, 352, 80);
        text('PLAY FREE', 142, 647, 26, 500, '#080b10', 3);
        ctx.strokeStyle = '#080b10'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(397, 662); ctx.lineTo(427, 662);
        ctx.moveTo(417, 652); ctx.lineTo(427, 662); ctx.lineTo(417, 672); ctx.stroke();
        text('roadster.superfun.games', 110, 746, 34, 400, white, .4);
        text('GOOD LUCK.', 113, 824, 17, 500, muted, 3);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    }, { design, roadster, tesla });
    await writeFile(path.join(output, `${design}.png`), Buffer.from(data, 'base64'));
  }
} finally { await browser.close(); }
console.log('V3 transparent title and closing graphics exported.');

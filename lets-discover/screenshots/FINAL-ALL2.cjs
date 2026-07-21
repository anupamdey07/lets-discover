const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.js');
const { chromium } = req('playwright');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BEST = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67';
(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, BEST);
const page = await ctx.newPage();
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(2200);

const box = () => page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });

// 1. FRONT face
const f = await page.evaluate(() => {
  const c = document.querySelector('.front-chat').getBoundingClientRect();
  const i = document.querySelector('.front-bottom').getBoundingClientRect();
  return { chatTop: Math.round(c.top), chatBot: Math.round(c.bottom), inputBot: Math.round(i.bottom), bubbles: document.querySelectorAll('.front-bubble').length };
});
console.log('FRONT:', JSON.stringify(f));

// 2. Flip F->B (hard)
let b = await box();
await page.mouse.move(b.x+b.w/2, b.y+b.h/2); await page.mouse.down();
for(let i=1;i<=10;i++){ await page.mouse.move(b.x+b.w/2-i*10, b.y+b.h/2); await sleep(8); }
await page.mouse.up(); await sleep(800);
console.log('F->B committed:', await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible')));

// 3. Persona sheet peek
const s = await page.evaluate(() => { const sh = document.querySelector('.persona-sheet'); const sr = sh.getBoundingClientRect(); return { cls: sh.className, top: Math.round(sr.top), bottom: Math.round(sr.bottom), vh: window.innerHeight }; });
console.log('PEEK:', JSON.stringify(s));

// 4. Open sheet, check overlay
const h = await page.evaluate(() => { const el = document.querySelector('.ps-handle'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; });
await page.mouse.move(h.x, h.y); await page.mouse.down();
for(let i=1;i<=12;i++){ await page.mouse.move(h.x, h.y-i*30); await sleep(22); }
await page.mouse.up(); await sleep(700);
const o = await page.evaluate(() => {
  const disc = document.querySelector('.top-discovery');
  return { discTop: disc ? Math.round(disc.getBoundingClientRect().top) : null, sheetTop: Math.round(document.querySelector('.persona-sheet').getBoundingClientRect().top) };
});
console.log('OPEN overlay check:', JSON.stringify(o));

// 5. Close sheet, then B->F edge drag
await page.click('.ps-collapse'); await sleep(700);
console.log('sheet collapsed:', await page.evaluate(() => document.querySelector('.persona-sheet').classList.contains('ps-peek')));
b = await box();
await page.mouse.move(8, b.y+b.h/2); await page.mouse.down();
for(let i=1;i<=10;i++){ await page.mouse.move(8+i*10, b.y+b.h/2); await sleep(8); }
await page.mouse.up(); await sleep(800);
console.log('B->F committed front:', await page.evaluate(() => !document.querySelector('.flip-back').classList.contains('flip-visible')));

// 6. Snap-back test
await page.evaluate(() => { window.__flipDbg = null; });
b = await box();
await page.mouse.move(b.x+b.w/2, b.y+b.h/2); await page.mouse.down();
for(let i=1;i<=6;i++){ await page.mouse.move(b.x+b.w/2-i*12, b.y+b.h/2); await sleep(30); } // 72px < 80 threshold
await page.mouse.up(); await sleep(600);
console.log('Snap-back (stayed front):', await page.evaluate(() => !document.querySelector('.flip-back').classList.contains('flip-visible')));

console.log('ALL OK');
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

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

// 1. FRONT FACE — chat in lower half
const front = await page.evaluate(() => {
  const ff = document.querySelector('.front-face').getBoundingClientRect();
  const chat = document.querySelector('.front-chat').getBoundingClientRect();
  const input = document.querySelector('.front-bottom').getBoundingClientRect();
  const bubbles = document.querySelectorAll('.front-bubble').length;
  return { ffH: ff.height, chatTop: Math.round(chat.top), chatBottom: Math.round(chat.bottom), inputTop: Math.round(input.top), inputBottom: Math.round(input.bottom), bubbles };
});
console.log('FRONT:', JSON.stringify(front));
await page.screenshot({ path: 'screenshots/70-front.png' });

// 2. FLIP front->back (hard flick), check spring + commit
let b = await box();
await page.mouse.move(b.x+b.w/2, b.y+b.h/2); await page.mouse.down();
for(let i=1;i<=10;i++){ await page.mouse.move(b.x+b.w/2-i*10, b.y+b.h/2); await sleep(8); }
await page.mouse.up(); await sleep(800);
const fb = await page.evaluate(() => ({
  backVisible: document.querySelector('.flip-back').classList.contains('flip-visible'),
  transform: getComputedStyle(document.querySelector('.flip-card')).transform.slice(0,30),
}));
console.log('F->B:', JSON.stringify(fb));
await page.screenshot({ path: 'screenshots/71-back.png' });

// 3. PERSONA SHEET (peek)
const peek = await page.evaluate(() => {
  const sheet = document.querySelector('.persona-sheet');
  const r = sheet?.getBoundingClientRect();
  return { cls: sheet?.className, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, contentPe: getComputedStyle(document.querySelector('.ps-content')).pointerEvents };
});
console.log('PEEK:', JSON.stringify(peek));
await page.screenshot({ path: 'screenshots/72-peek.png' });

// 4. Swipe sheet open + check overlay
const h = await page.evaluate(() => { const el = document.querySelector('.ps-handle'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; });
await page.mouse.move(h.x, h.y); await page.mouse.down();
for(let i=1;i<=12;i++){ await page.mouse.move(h.x, h.y-i*30); await sleep(22); }
await page.mouse.up(); await sleep(700);
const open = await page.evaluate(() => {
  const sheet = document.querySelector('.persona-sheet');
  const disc = document.querySelector('.top-discovery');
  const sr = sheet.getBoundingClientRect();
  const dr = disc?.getBoundingClientRect();
  return { cls: sheet.className, top: Math.round(sr.top), discTop: dr ? Math.round(dr.top) : null, contentPe: getComputedStyle(document.querySelector('.ps-content')).pointerEvents };
});
console.log('OPEN:', JSON.stringify(open));
await page.screenshot({ path: 'screenshots/73-open-overlay.png' });

// 5. Back->front via edge drag
await page.mouse.move(8, b.y+b.h/2); await page.mouse.down();
for(let i=1;i<=10;i++){ await page.mouse.move(8+i*10, b.y+b.h/2); await sleep(8); }
await page.mouse.up(); await sleep(800);
const bf = await page.evaluate(() => ({
  onFront: !document.querySelector('.flip-back').classList.contains('flip-visible'),
  transform: getComputedStyle(document.querySelector('.flip-card')).transform.slice(0,30),
}));
console.log('B->F:', JSON.stringify(bf));

console.log('DONE');
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

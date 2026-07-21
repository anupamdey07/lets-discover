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

// 1. Front face (populated, lower half)
await page.screenshot({ path: 'screenshots/60-front-lower-half.png' });
const fpos = await page.evaluate(() => {
  const ff = document.querySelector('.front-face').getBoundingClientRect();
  const chat = document.querySelector('.front-chat').getBoundingClientRect();
  const input = document.querySelector('.front-bottom').getBoundingClientRect();
  const spacer = document.querySelector('.front-spacer');
  const sr = spacer?.getBoundingClientRect();
  return {
    ff: { top: Math.round(ff.top), bottom: Math.round(ff.bottom), h: Math.round(ff.height) },
    chat: { top: Math.round(chat.top), bottom: Math.round(chat.bottom), h: Math.round(chat.height) },
    input: { top: Math.round(input.top), bottom: Math.round(input.bottom), h: Math.round(input.height) },
    spacerH: sr ? Math.round(sr.height) : 0,
    spacerExists: !!spacer,
    vh: window.innerHeight,
    bubbles: document.querySelectorAll('.front-bubble').length,
  };
});
console.log('FRONT:', JSON.stringify(fpos));

// 2. Flip to back (via swipe)
const box = await page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
await page.mouse.move(box.x + box.w/2, box.y + box.h/2); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(box.x + box.w/2 - i*10, box.y + box.h/2); await sleep(8); }
await page.mouse.up(); await sleep(800);
await page.screenshot({ path: 'screenshots/61-back-peek.png' });

// 3. Sheet open (swipe up)
const handle = await page.evaluate(() => { const h = document.querySelector('.ps-handle').getBoundingClientRect(); return { x: Math.round(h.x + h.width/2), y: Math.round(h.y + h.height/2) }; });
await page.mouse.move(handle.x, handle.y); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(handle.x, handle.y - i*30); await sleep(20); }
await page.mouse.up(); await sleep(700);
await page.screenshot({ path: 'screenshots/62-sheet-open-overlay.png' });

// 4. Overlay check: discovery position unchanged
const overlay = await page.evaluate(() => {
  const disc = document.querySelector('.top-discovery');
  const sheet = document.querySelector('.persona-sheet');
  const sd = disc?.getBoundingClientRect();
  const ss = sheet?.getBoundingClientRect();
  return {
    discTop: sd ? Math.round(sd.top) : null,
    sheetTop: ss ? Math.round(ss.top) : null,
    cls: sheet?.className,
  };
});
console.log('OVERLAY:', JSON.stringify(overlay));

await browser.close(); console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });

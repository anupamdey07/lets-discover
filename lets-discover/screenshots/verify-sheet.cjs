const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.js');
const { chromium } = req('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BEST = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67';
(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, BEST);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEEXC:', e.message));
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(2000);

// Flip to back
const b0 = await page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
await page.mouse.move(b0.x + b0.w/2, b0.y + b0.h/2); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(b0.x + b0.w/2 - i*10, b0.y + b0.h/2); await sleep(8); }
await page.mouse.up(); await sleep(700);
console.log('on back:', await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible')));
await page.screenshot({ path: 'screenshots/40-back-peek.png' });

// PEEK state probe
const peek = await page.evaluate(() => {
  const sheet = document.querySelector('.persona-sheet');
  if (!sheet) return { found: false };
  const r = sheet.getBoundingClientRect();
  const vh = window.innerHeight;
  return {
    found: true,
    cls: sheet.className,
    bottom: Math.round(r.bottom),
    top: Math.round(r.top),
    height: Math.round(r.height),
    visiblePx: Math.round(r.bottom - r.top), // sheet is anchored bottom; peek shows peekHeight
    viewportH: vh,
    handleVisible: !!document.querySelector('.ps-handle'),
    teaser: document.querySelector('.ps-teaser-summary')?.textContent?.slice(0, 50),
    contentPointerEvents: getComputedStyle(document.querySelector('.ps-content')).pointerEvents,
    personaTraitsVisible: document.querySelectorAll('.persona-trait').length,
  };
});
console.log('PEEK:', JSON.stringify(peek, null, 1));

// SWIPE UP on handle
const handle = await page.evaluate(() => { const h = document.querySelector('.ps-handle').getBoundingClientRect(); return { x: h.x + h.width/2, y: h.y + h.height/2 }; });
console.log('swiping up from handle at', handle);
await page.mouse.move(handle.x, handle.y); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(handle.x, handle.y - i*30); await sleep(22); }
await page.mouse.up(); await sleep(700);

const opened = await page.evaluate(() => {
  const sheet = document.querySelector('.persona-sheet');
  const r = sheet.getBoundingClientRect();
  return { cls: sheet.className, top: Math.round(r.top), height: Math.round(r.height), contentPe: getComputedStyle(document.querySelector('.ps-content')).pointerEvents, traits: document.querySelectorAll('.persona-trait').length, fields: document.querySelectorAll('.persona-field').length, hobbies: document.querySelectorAll('.hobby-tag').length };
});
console.log('OPENED:', JSON.stringify(opened, null, 1));
await page.screenshot({ path: 'screenshots/41-sheet-open.png' });

// Swipe DOWN to collapse
const handle2 = await page.evaluate(() => { const h = document.querySelector('.ps-handle').getBoundingClientRect(); return { x: h.x + h.width/2, y: h.y + h.height/2 }; });
await page.mouse.move(handle2.x, handle2.y); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(handle2.x, handle2.y + i*30); await sleep(22); }
await page.mouse.up(); await sleep(700);
const collapsed = await page.evaluate(() => { const s = document.querySelector('.persona-sheet'); return { cls: s.className, top: Math.round(s.getBoundingClientRect().top) }; });
console.log('COLLAPSED:', JSON.stringify(collapsed));
await page.screenshot({ path: 'screenshots/42-sheet-collapsed.png' });

// Tap (click) handle toggles open
await page.click('.ps-handle'); await sleep(600);
console.log('after tap:', await page.evaluate(() => document.querySelector('.persona-sheet').className));
await page.screenshot({ path: 'screenshots/43-sheet-tap-open.png' });

await browser.close(); console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });

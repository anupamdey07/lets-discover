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
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(2000);
// 1. FRONT FACE — chat in lower half
const front = await page.evaluate(() => {
  const fc = document.querySelector('.front-chat');
  const fb = document.querySelector('.front-bottom');
  const ff = document.querySelector('.front-face');
  const fcr = fc.getBoundingClientRect();
  const fbr = fb.getBoundingClientRect();
  const vh = window.innerHeight;
  const spacer = document.querySelector('.front-spacer');
  return {
    chatTop: Math.round(fcr.top),
    chatBottom: Math.round(fcr.bottom),
    inputTop: Math.round(fbr.top),
    vh,
    chatCenterPct: Math.round(((fcr.top + fcr.bottom)/2) / vh * 100),
    spacerExists: !!spacer,
    spacerStyle: spacer ? getComputedStyle(spacer).flex : null,
    chatFlex: getComputedStyle(fc).flex,
    chatMaxH: getComputedStyle(fc).maxHeight,
  };
});
console.log('FRONT:', JSON.stringify(front, null, 1));
await page.screenshot({ path: 'screenshots/50-front-lower-half.png' });

// 2. FLIP to back, check persona sheet overlays (no push)
const b0 = await page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
await page.mouse.move(b0.x + b0.w/2, b0.y + b0.h/2); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(b0.x + b0.w/2 - i*10, b0.y + b0.h/2); await sleep(8); }
await page.mouse.up(); await sleep(700);
await page.screenshot({ path: 'screenshots/51-back-peek-overlay.png' });

const back = await page.evaluate(() => {
  const discovery = document.querySelector('.top-discovery');
  const themeSel = document.querySelector('.theme-selector, .theme-chips, [class*="theme"]');
  const sheet = document.querySelector('.persona-sheet');
  const appMain = document.querySelector('.app-main');
  const sheets = sheet.getBoundingClientRect();
  const dr = discovery?.getBoundingClientRect();
  const ar = appMain?.getBoundingClientRect();
  return {
    sheetTop: Math.round(sheets.top), sheetHeight: Math.round(sheets.height), cls: sheet.className,
    discoveryTop: dr ? Math.round(dr.top) : null,
    appMainBottom: ar ? Math.round(ar.bottom) : null,
    appMainH: ar ? Math.round(ar.height) : null,
    sheetOverlapsDiscovery: dr && sheets.top < dr.bottom,
    viewportH: window.innerHeight,
  };
});
console.log('BACK PEEK:', JSON.stringify(back, null, 1));

// swipe sheet open
const handle = await page.evaluate(() => { const h = document.querySelector('.ps-handle').getBoundingClientRect(); return { x: Math.round(h.x + h.width/2), y: Math.round(h.y + h.height/2) }; });
await page.mouse.move(handle.x, handle.y); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(handle.x, handle.y - i*30); await sleep(22); }
await page.mouse.up(); await sleep(700);
await page.screenshot({ path: 'screenshots/52-sheet-open-overlay.png' });
const sheetOpen = await page.evaluate(() => {
  const sheet = document.querySelector('.persona-sheet');
  const discovery = document.querySelector('.top-discovery');
  const ar = document.querySelector('.app-main').getBoundingClientRect();
  const dr = discovery?.getBoundingClientRect();
  const sr = sheet?.getBoundingClientRect();
  return {
    cls: sheet.className,
    sheetTop: Math.round(sr.top), sheetBottom: Math.round(sr.bottom),
    discoveryTop: dr ? Math.round(dr.top) : null,
    discoveryPosUnchanged: dr ? dr.top < 300 : null, // still near the top where it belongs
    appMainBottom: Math.round(ar.bottom),
  };
});
console.log('SHEET OPEN:', JSON.stringify(sheetOpen, null, 1));

await browser.close(); console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });

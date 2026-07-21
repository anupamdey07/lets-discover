const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.js');
const { chromium } = req('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BEST = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67';
(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, BEST);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
const onFront = () => page.evaluate(() => !document.querySelector('.flip-back').classList.contains('flip-visible'));
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(2000);
// read exactly which elements receive touchstart for a point over the back content
// first flip to back via button
await page.click('.front-explore-btn'); await sleep(800);
console.log('on back:', !await onFront());
// listen for touchstart targets
await page.evaluate(() => {
  window.__ts = [];
  document.addEventListener('touchstart', (e) => { window.__ts.push({ target: e.target.tagName+'.'+(e.target.className||'').slice(0,25), bubbles: e.bubbles, cancelable: e.cancelable }); }, { capture: true });
}, );
const b = await page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { y: c.y, h: c.height }; });
const cy = Math.round(b.y + b.h/2);
// dispatch one touchstart at (8, cy)
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: 8, y: cy, radiusX: 1, radiusY: 1, force: 1 }], modifiers: 0, timestamp: Date.now() });
await sleep(50);
console.log('touchstart events captured:', JSON.stringify(await page.evaluate(() => window.__ts)));
// also check: is there a touchstart listener on window? (the hook adds touchmove/touchend on window, but touchstart is via React on the div)
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id: 1, x: 8, y: cy, radiusX: 1, radiusY: 1, force: 1 }], modifiers: 0, timestamp: Date.now() });
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

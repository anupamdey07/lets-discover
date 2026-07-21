const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.js');
const { chromium } = req('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, '4d000fb8-fb41-4bf2-b5f9-6d7629171c67');
const page = await ctx.newPage();
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(2000);
// flip to back
const b0 = await page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
await page.mouse.move(b0.x + b0.w/2, b0.y + b0.h/2); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(b0.x + b0.w/2 - i*10, b0.y + b0.h/2); await sleep(8); }
await page.mouse.up(); await sleep(700);
const dbg = await page.evaluate(() => window.__sheet);
console.log('INITIAL peek dbg:', JSON.stringify(dbg, null, 1));
const rect = await page.evaluate(() => { const s = document.querySelector('.persona-sheet'); const r = s.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, offsetParent: s.offsetParent?.tagName + '.' + (s.offsetParent?.className||'').slice(0,20), opHeight: s.offsetParent?.getBoundingClientRect().height }; });
console.log('sheet rect:', JSON.stringify(rect));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

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
const b = await page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
const cy = b.y + b.h/2;
// swipe front->back (hard)
await page.mouse.move(b.x + b.w/2, cy); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(b.x + b.w/2 - i*10, cy); await sleep(8); }
await page.mouse.up(); await sleep(700);
console.log('after F->B: backVisible=', await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible')));
console.log('  elem@(8,cy):', await page.evaluate(([x,y]) => { const e = document.elementFromPoint(x,y); return e ? e.tagName+'.'+(e.className||'').slice(0,30) : 'null'; }, [8, cy]));
console.log('  flip-back pe:', await page.evaluate(() => getComputedStyle(document.querySelector('.flip-back')).pointerEvents));
console.log('  flip-front pe:', await page.evaluate(() => getComputedStyle(document.querySelector('.flip-front')).pointerEvents));
console.log('  dragStart before B->F:', JSON.stringify(await page.evaluate(() => window.__dragStart)));
console.log('  flipDbg before B->F:', JSON.stringify(await page.evaluate(() => window.__flipDbg)));
// swipe back->front (hard) from edge
await page.evaluate(() => { window.__dragStart = null; window.__flipDbg = null; });
await page.mouse.move(8, cy); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(8 + i*10, cy); await sleep(8); }
await page.mouse.up(); await sleep(700);
console.log('after B->F: dragStart=', JSON.stringify(await page.evaluate(() => window.__dragStart)));
console.log('  flipDbg=', JSON.stringify(await page.evaluate(() => window.__flipDbg)));
console.log('  committed front=', await page.evaluate(() => !document.querySelector('.flip-back').classList.contains('flip-visible')));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

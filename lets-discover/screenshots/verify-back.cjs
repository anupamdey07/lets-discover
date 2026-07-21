const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = req('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, '4d000fb8-fb41-4bf2-b5f9-6d7629171c67');
const page = await ctx.newPage();
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(1800);
const b = await page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
// go to back via button
await page.click('.front-explore-btn'); await sleep(900);
console.log('flipped/backVisible:', await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible')));
console.log('flip-front pointer-events:', await page.evaluate(() => getComputedStyle(document.querySelector('.flip-front')).pointerEvents));
console.log('flip-back pointer-events:', await page.evaluate(() => getComputedStyle(document.querySelector('.flip-back')).pointerEvents));
// what element is at (8, cy)?
const cy = b.y + b.h/2;
const hit = await page.evaluate(([x,y]) => { const el = document.elementFromPoint(x,y); return el ? (el.tagName + '.' + el.className + ' #'+(el.id||'')) : 'null'; }, [8, cy]);
console.log('element at (8, cy):', hit);
// clear flags, do edge drag
await page.evaluate(() => { window.__backDown = null; window.__frontDown = null; });
await page.mouse.move(8, cy); await page.mouse.down();
await page.mouse.move(60, cy); await sleep(20);
await page.mouse.up(); await sleep(400);
console.log('backDown flag:', await page.evaluate(() => window.__backDown));
console.log('frontDown flag:', await page.evaluate(() => window.__frontDown));
console.log('flipDbg:', JSON.stringify(await page.evaluate(() => window.__flipDbg)));
console.log('committed to front:', await page.evaluate(() => !document.querySelector('.flip-back').classList.contains('flip-visible')));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

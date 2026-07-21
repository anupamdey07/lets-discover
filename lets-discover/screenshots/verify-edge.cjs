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
// go to back
await page.click('.front-explore-btn'); await sleep(900);
console.log('on back:', await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible')));
// edge drag right
await page.mouse.move(8, b.y + b.h/2); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(8 + i * 30, b.y + b.h/2); await sleep(20); }
await page.mouse.up();
await sleep(500); // let spring settle + onFlip
console.log('dbg:', JSON.stringify(await page.evaluate(() => window.__flipDbg)));
console.log('committed to front:', await page.evaluate(() => !document.querySelector('.flip-back').classList.contains('flip-visible')));
console.log('card transform:', await page.evaluate(() => getComputedStyle(document.querySelector('.flip-card')).transform.slice(0, 40)));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

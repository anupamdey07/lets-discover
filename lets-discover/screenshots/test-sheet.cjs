const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.js');
const { chromium } = req('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, '4d000fb8-fb41-4bf2-b5f9-6d7629171c67');
const page = await ctx.newPage();
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(2000);
// flip to back
const b = await page.evaluate(() => document.querySelector('.flip-container').getBoundingClientRect());
await page.mouse.move(b.x+b.width/2, b.y+b.height/2); await page.mouse.down();
for(let i=1;i<=10;i++){ await page.mouse.move(b.x+b.width/2-i*10, b.y+b.height/2); await sleep(8); }
await page.mouse.up(); await sleep(900);
console.log('on back:', await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible')));
// try sheet open
const h = await page.evaluate(() => { const el = document.querySelector('.ps-handle'); const r = el.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2, top: r.top, bottom: r.bottom }; });
console.log('handle:', JSON.stringify(h));
await page.mouse.move(h.x, h.y); await page.mouse.down();
for(let i=1;i<=15;i++){ await page.mouse.move(h.x, h.y-i*40); await sleep(20); }
await page.mouse.up(); await sleep(1000);
const sheet = await page.evaluate(() => { const s = document.querySelector('.persona-sheet'); const r = s.getBoundingClientRect(); return { cls: s.className, top: r.top }; });
console.log('sheet after swipe:', JSON.stringify(sheet));
// try click
await page.mouse.click(h.x, h.y); await sleep(800);
const sheet2 = await page.evaluate(() => { const s = document.querySelector('.persona-sheet'); const r = s.getBoundingClientRect(); return { cls: s.className, top: r.top }; });
console.log('sheet after click:', JSON.stringify(sheet2));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

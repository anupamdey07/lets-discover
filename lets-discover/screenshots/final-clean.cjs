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
// chat screenshot (2-3 bubbles)
await page.screenshot({ path: 'screenshots/20-chat-final.png' });
const chat = await page.evaluate(() => ({ n: document.querySelectorAll('.front-bubble').length, pad: getComputedStyle(document.querySelector('.front-chat')).padding, classes: [...document.querySelectorAll('.front-bubble')].map(b => b.className.replace('front-bubble ','')) }));
console.log('CHAT:', JSON.stringify(chat));
// flip front->back (hard) and capture mid-spring + back
const b = await page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
await page.mouse.move(b.x + b.w/2, b.y + b.h/2); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(b.x + b.w/2 - i*10, b.y + b.h/2); await sleep(8); }
await page.mouse.up();
await sleep(180); // mid-spring overshoot
await page.screenshot({ path: 'screenshots/21-flip-midspring.png' });
await sleep(600);
await page.screenshot({ path: 'screenshots/22-back-final.png' });
console.log('backVisible:', await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible')));
// flip back->front (hard) via edge
await page.mouse.move(8, b.y + b.h/2); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(8 + i*10, b.y + b.h/2); await sleep(8); }
await page.mouse.up();
await sleep(800);
await page.screenshot({ path: 'screenshots/23-front-after-backflip.png' });
console.log('committed to front:', await page.evaluate(() => !document.querySelector('.flip-back').classList.contains('flip-visible')));
await browser.close(); console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });

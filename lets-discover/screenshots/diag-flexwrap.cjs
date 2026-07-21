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
// Try making the wrapper a flex container
const before = await page.evaluate(() => document.querySelector('.front-face').getBoundingClientRect().top);
await page.evaluate(() => document.querySelector('.front-wrapper').style.display = 'flex');
await page.evaluate(() => document.querySelector('.front-wrapper').style.flexDirection = 'column');
await sleep(50);
const afterFlex = await page.evaluate(() => document.querySelector('.front-face').getBoundingClientRect().top);
// Now also remove the fluid-bg
await page.evaluate(() => document.querySelector('.fluid-bg').remove());
await sleep(50);
const afterRemove = await page.evaluate(() => document.querySelector('.front-face').getBoundingClientRect().top);
console.log(`before: ${before}, wrapper=flex: ${afterFlex}, +remove fluid: ${afterRemove}`);
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

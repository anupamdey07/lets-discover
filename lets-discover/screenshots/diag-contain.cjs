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
const fbc = await page.evaluate(() => {
  const el = document.querySelector('.fluid-bg');
  const cs = getComputedStyle(el);
  return { contain: cs.contain, top: cs.top, left: cs.left, w: cs.width, h: cs.height };
});
console.log(JSON.stringify(fbc));
// Try removing all abs children to confirm it works
const before = await page.evaluate(() => document.querySelector('.front-chat').getBoundingClientRect().top);
await page.evaluate(() => {
  document.querySelector('.weather-bg').remove();
  document.querySelector('.fluid-bg').remove();
  document.querySelector('.particles').remove();
});
await sleep(50);
const after = await page.evaluate(() => document.querySelector('.front-chat').getBoundingClientRect().top);
console.log(`before: ${before}, after all removed: ${after}`);
// If before != after, fluid-bg removal individually
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

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
// Remove all absolute children and see if chat position normalizes
await page.evaluate(() => {
  const ff = document.querySelector('.front-face');
  // Remove weather, fluid, particles
  ff.querySelectorAll('.weather-bg, .fluid-bg, .particles').forEach(el => el.remove());
});
await sleep(150);
const after = await page.evaluate(() => {
  const ff = document.querySelector('.front-face');
  const chat = document.querySelector('.front-chat');
  const children = Array.from(ff.children).map(c => c.className);
  return { top: chat.getBoundingClientRect().top, children, marginTop: getComputedStyle(chat).marginTop };
});
console.log(JSON.stringify(after));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

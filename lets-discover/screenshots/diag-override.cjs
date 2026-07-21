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
// Test: if we force justify-content: flex-end via JS, does it work?
const before = await page.evaluate(() => {
  const ff = document.querySelector('.front-face');
  const chat = document.querySelector('.front-chat');
  const input = document.querySelector('.front-bottom');
  return {
    jc: getComputedStyle(ff).justifyContent,
    chatBottom: chat.getBoundingClientRect().bottom,
    inputBottom: input.getBoundingClientRect().bottom,
    ffBottom: ff.getBoundingClientRect().bottom,
  };
});
console.log('BEFORE:', JSON.stringify(before));
// Now force flex-end explicitly
await page.evaluate(() => {
  document.querySelector('.front-face').style.justifyContent = 'flex-end !important';
  document.querySelector('.front-face').style.justifyContent = 'flex-end';
});
await sleep(100);
const after = await page.evaluate(() => {
  const ff = document.querySelector('.front-face');
  const chat = document.querySelector('.front-chat');
  const input = document.querySelector('.front-bottom');
  return {
    jc: getComputedStyle(ff).justifyContent,
    chatBottom: chat.getBoundingClientRect().bottom,
    inputBottom: input.getBoundingClientRect().bottom,
    ffBottom: ff.getBoundingClientRect().bottom,
  };
});
console.log('AFTER JS override:', JSON.stringify(after));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

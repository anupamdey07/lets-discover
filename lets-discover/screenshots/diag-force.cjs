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
const before = await page.evaluate(() => {
  const ff = document.querySelector('.front-face');
  const chat = document.querySelector('.front-chat');
  const input = document.querySelector('.front-bottom');
  return {
    jc: getComputedStyle(ff).justifyContent,
    chat: { top: chat.getBoundingClientRect().top, bottom: chat.getBoundingClientRect().bottom },
    input: { top: input.getBoundingClientRect().top, bottom: input.getBoundingClientRect().bottom },
    ff: { top: ff.getBoundingClientRect().top, bottom: ff.getBoundingClientRect().bottom, h: ff.getBoundingClientRect().height },
  };
});
console.log('BEFORE:', JSON.stringify(before));
// Force all possible reasons
await page.evaluate(() => {
  const ff = document.querySelector('.front-face');
  ff.style.setProperty('justify-content', 'flex-end', 'important');
  // Also check children for any margins
});
await sleep(50);
const after = await page.evaluate(() => {
  const ff = document.querySelector('.front-face');
  const chat = document.querySelector('.front-chat');
  const input = document.querySelector('.front-bottom');
  return {
    jc: getComputedStyle(ff).justifyContent,
    chat: { top: chat.getBoundingClientRect().top, bottom: chat.getBoundingClientRect().bottom },
    input: { top: input.getBoundingClientRect().top, bottom: input.getBoundingClientRect().bottom },
    ff: { top: ff.getBoundingClientRect().top, bottom: ff.getBoundingClientRect().bottom },
  };
});
console.log('AFTER force:', JSON.stringify(after));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

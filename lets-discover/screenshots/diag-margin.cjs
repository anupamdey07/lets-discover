const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.js');
const { chromium } = req('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, '4d000fb8-fb41-4bf2-b5f9-6d7629171c67');
const page = await ctx.newPage();
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(2500);
const m = await page.evaluate(() => {
  const chat = document.querySelector('.front-chat');
  const input = document.querySelector('.front-bottom');
  const css = (el) => getComputedStyle(el);
  return {
    chat: { mt: css(chat).marginTop, mb: css(chat).marginBottom, flex: css(chat).flex, maxH: css(chat).maxHeight, h: css(chat).height, pos: css(chat).position },
    input: { mt: css(input).marginTop, mb: css(input).marginBottom, flex: css(input).flex, pos: css(input).position },
    ff: { jc: css(chat.parentElement).justifyContent, ai: css(chat.parentElement).alignItems },
  };
});
console.log(JSON.stringify(m, null, 1));
// Also test: set margin-top auto inline
const after = await page.evaluate(() => {
  const chat = document.querySelector('.front-chat');
  chat.style.setProperty('margin-top', 'auto', 'important');
  return document.querySelector('.front-chat').getBoundingClientRect().top;
});
console.log('after inline margin-top:auto:', after);
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

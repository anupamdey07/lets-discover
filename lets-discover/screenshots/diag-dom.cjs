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
const dom = await page.evaluate(() => {
  const ff = document.querySelector('.front-face');
  return Array.from(ff.children).map(el => el.tagName + '.' + (el.className||'').slice(0,30)).join(' | ');
});
console.log('children:', dom);
const ffRect = await page.evaluate(() => {
  const ff = document.querySelector('.front-face');
  const r = ff.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, h: r.height };
});
console.log('ff rect:', JSON.stringify(ffRect));
// Also check the actual computed height of chat
const chatH = await page.evaluate(() => {
  const c = document.querySelector('.front-chat');
  return { rectH: c.getBoundingClientRect().height, scrollH: c.scrollHeight, csH: getComputedStyle(c).height, csMaxH: getComputedStyle(c).maxHeight, csFlex: getComputedStyle(c).flex, chatContent: c.children.length };
});
console.log('chat:', JSON.stringify(chatH));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

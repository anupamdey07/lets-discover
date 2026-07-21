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
const r = await page.evaluate(() => {
  const wrap = document.querySelector('.front-wrapper');
  const cs = getComputedStyle(wrap);
  return {
    display: cs.display,
    overflow: cs.overflow,
    position: cs.position,
    height: cs.height,
    zIndex: cs.zIndex,
    children: Array.from(wrap.children).map(el => ({ cls: el.className, pos: getComputedStyle(el).position, top: getComputedStyle(el).top, height: getComputedStyle(el).height, rectTop: el.getBoundingClientRect().top })),
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

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
const center = await page.evaluate(() => {
  const b = document.querySelector('.flip-container').getBoundingClientRect();
  const cx = b.x + b.width/2, cy = b.y + b.height/2;
  const el = document.elementFromPoint(cx, cy);
  return { x: cx, y: cy, tag: el?.tagName, cls: el?.className?.slice(0,40), zIndex: getComputedStyle(el).zIndex, pe: getComputedStyle(el).pointerEvents, parentTag: el?.parentElement?.tagName, parentCls: el?.parentElement?.className?.slice(0,30) };
});
console.log('element at center:', JSON.stringify(center));
// Also check the flip-front
const ff = await page.evaluate(() => {
  const ff = document.querySelector('.flip-front');
  const cs = getComputedStyle(ff);
  return { zIndex: cs.zIndex, pe: cs.pointerEvents, overflow: cs.overflow, childrenCount: ff.children.length };
});
console.log('flip-front:', JSON.stringify(ff));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

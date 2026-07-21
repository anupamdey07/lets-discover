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
const r = await page.evaluate(() => {
  const b = document.querySelector('.flip-container').getBoundingClientRect();
  const cx = Math.round(b.x + b.width/2), cy = Math.round(b.y + b.height/2);
  const el = document.elementFromPoint(cx, cy);
  if (!el) return { err: 'null element', cx, cy };
  const cs = getComputedStyle(el);
  return { tag: el.tagName, cls: (el.className||'').slice(0,40), zIndex: cs.zIndex, pe: cs.pointerEvents, parentTag: el.parentElement?.tagName, parentCls: (el.parentElement?.className||'').slice(0,30) };
});
console.log('center:', JSON.stringify(r));
// Check the flip-card position
const card = await page.evaluate(() => document.querySelector('.flip-card').getBoundingClientRect());
console.log('card:', JSON.stringify(card));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

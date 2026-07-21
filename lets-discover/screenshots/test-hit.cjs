const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.js');
const { chromium } = req('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, '4d000fb8-fb41-4bf2-b5f9-6d7629171c67');
const page = await ctx.newPage();
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(2000);
const b = await page.evaluate(() => document.querySelector('.flip-container').getBoundingClientRect());
await page.mouse.move(b.x+b.width/2, b.y+b.height/2); await page.mouse.down();
for(let i=1;i<=10;i++){ await page.mouse.move(b.x+b.width/2-i*10, b.y+b.height/2); await sleep(8); }
await page.mouse.up(); await sleep(900);
const h = await page.evaluate(() => { const el = document.querySelector('.ps-handle'); const r = el.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 }; });
const el = await page.evaluate((pt) => {
  const e = document.elementFromPoint(pt.x, pt.y);
  return { tag: e.tagName, cls: (e.className||'').slice(0,50), parentTag: e.parentElement?.tagName, parentCls: (e.parentElement?.className||'').slice(0,50) };
}, h);
console.log('element at handle:', JSON.stringify(el));
// Try Playwright click on handle
await page.click('.ps-handle');
await sleep(800);
const afterOpen = await page.evaluate(() => ({ cls: document.querySelector('.persona-sheet').className, top: document.querySelector('.persona-sheet').getBoundingClientRect().top }));
console.log('after open click:', JSON.stringify(afterOpen));
// Try direct click on collapse button
const afterClick = await page.evaluate(() => {
  const before = document.querySelector('.persona-sheet').className;
  const btn = document.querySelector('.ps-collapse');
  if (!btn) return { err: 'no button' };
  const rect = btn.getBoundingClientRect();
  const mdown = new MouseEvent('mousedown', { clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2, bubbles: true });
  btn.dispatchEvent(mdown);
  const mup = new MouseEvent('mouseup', { clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2, bubbles: true });
  btn.dispatchEvent(mup);
  const click = new MouseEvent('click', { clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2, bubbles: true });
  btn.dispatchEvent(click);
  return { before, after: document.querySelector('.persona-sheet').className, btnText: btn.textContent };
});
console.log('after direct collapse click:', JSON.stringify(afterClick));
// Check z-index and pointer-events
const t = await page.evaluate(() => {
  const fc = document.querySelector('.flip-card');
  const fb = document.querySelector('.flip-back');
  const ps = document.querySelector('.persona-sheet');
  return {
    cardTransform: getComputedStyle(fc).transform,
    backTransform: getComputedStyle(fb).transform,
    backVisible: fb.classList.contains('flip-visible'),
    backVisibility: getComputedStyle(fb).visibility,
    backDisplay: getComputedStyle(fb).display,
    sheetDisplay: getComputedStyle(ps).display,
    sheetVisibility: getComputedStyle(ps).visibility,
  };
});
console.log('transforms:', JSON.stringify(t));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

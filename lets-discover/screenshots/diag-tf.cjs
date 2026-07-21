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
  const fc = document.querySelector('.flip-card');
  const inline = fc.getAttribute('style');
  const cs = getComputedStyle(fc);
  return { inlineStyle: inline, csTransform: cs.transform, csPosition: cs.position, csTop: cs.top, csMargin: cs.margin, csHeight: cs.height, perspective: getComputedStyle(document.querySelector('.flip-container')).perspective };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

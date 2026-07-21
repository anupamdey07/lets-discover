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
const layout = await page.evaluate(() => {
  const get = (sel, name) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { ...r.toJSON(), name, tag: el.tagName, display: getComputedStyle(el).display, flex: getComputedStyle(el).flex, h: getComputedStyle(el).height }; };
  return {
    frontFace: get('.front-face','front-face'),
    frontSpacer: get('.front-spacer','spacer'),
    frontChat: get('.front-chat','chat'),
    frontBottom: get('.front-bottom','bottom'),
    flipFront: get('.flip-front','flip-front'),
    flipCard: get('.flip-card','flip-card'),
  };
});
console.log(JSON.stringify(layout, null, 1));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

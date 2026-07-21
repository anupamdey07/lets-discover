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
const allRules = await page.evaluate(() => {
  const ff = document.querySelector('.front-face');
  const cs = getComputedStyle(ff);
  return {
    all: ['justifyContent', 'alignItems', 'alignContent', 'flexDirection', 'flexWrap', 'height', 'minHeight', 'maxHeight', 'paddingTop', 'paddingLeft', 'marginTop', 'marginLeft', 'display', 'overflow'],
    vals: {},
  };
});
for (const prop of allRules.all) {
  allRules.vals[prop] = await page.evaluate((p) => getComputedStyle(document.querySelector('.front-face'))[p], prop);
}
console.log(JSON.stringify(allRules.vals, null, 1));

// Also check if any other element inside is position:absolute and taking space
const nonAbs = await page.evaluate(() => {
  const ff = document.querySelector('.front-face');
  return Array.from(ff.children).filter(c => getComputedStyle(c).position !== 'absolute').map(c => c.tagName+'.'+(c.className||'').slice(0,20));
});
console.log('non-absolute children:', JSON.stringify(nonAbs));
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

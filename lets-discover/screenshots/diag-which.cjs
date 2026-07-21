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
const t = async (label, sel) => {
  const before = await page.evaluate(() => document.querySelector('.front-chat').getBoundingClientRect().top);
  await page.evaluate((s) => document.querySelector(s).remove(), sel);
  await sleep(30);
  const after = await page.evaluate(() => document.querySelector('.front-chat').getBoundingClientRect().top);
  console.log(`remove ${label}: before=${before.toFixed(1)}, after=${after.toFixed(1)}, delta=${(after-before).toFixed(1)}`);
};
await t('weather-bg', '.weather-bg');
await t('fluid-bg', '.fluid-bg');
await t('particles', '.particles');
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

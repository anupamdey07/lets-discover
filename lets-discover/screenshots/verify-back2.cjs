const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.js');
const { chromium } = req('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, '4d000fb8-fb41-4bf2-b5f9-6d7629171c67');
const page = await ctx.newPage();
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(1800);
const box = () => page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
const sampleSpring = async (dir, ms = 700) => {
  const out = []; const t0 = Date.now(); let prev = null;
  while (Date.now() - t0 < ms) {
    const a = await page.evaluate(() => { const tf = getComputedStyle(document.querySelector('.flip-card')).transform; const m = tf.match(/matrix3d\(([^)]+)\)/); if (!m) return tf.includes('matrix(-1') ? 180 : 0; const v = m[1].split(',').map(parseFloat); return Math.atan2(v[8], v[0]) * 180 / Math.PI; });
    let uw = a; if (prev != null) { if (dir > 0 && a - prev < -90) uw = a + 360; if (dir < 0 && a - prev > 90) uw = a - 360; } prev = uw; out.push(uw); await sleep(13);
  }
  return out;
};
const ensureBack = async () => { if (!(await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible')))) { await page.click('.front-explore-btn'); await sleep(800); } };

const flickBF = async (b, pxPerStep, msPerStep) => { const cy = b.y + b.h/2; await page.evaluate(() => { window.__backDown = null; window.__flipDbg = null; }); await page.mouse.move(8, cy); await page.mouse.down(); for (let i = 1; i <= 10; i++) { await page.mouse.move(8 + i * pxPerStep, cy); await sleep(msPerStep); } await page.mouse.up(); };

console.log('=== BACK->FRONT GENTLE (100px / 500ms) ===');
await ensureBack(); let b = await box();
await flickBF(b, 10, 50);
let s = await sampleSpring(-1);
console.log(`  backDown=${await page.evaluate(()=>window.__backDown)} dbg=${JSON.stringify(await page.evaluate(()=>window.__flipDbg))}`);
console.log(`  min=${Math.min(...s).toFixed(1)}° overshoot_past_0=${(-Math.min(...s)).toFixed(1)}° committed_front=${await page.evaluate(()=>!document.querySelector('.flip-back').classList.contains('flip-visible'))}`);

console.log('=== BACK->FRONT HARD (100px / 80ms) ===');
await ensureBack(); b = await box();
await flickBF(b, 10, 8);
s = await sampleSpring(-1);
console.log(`  backDown=${await page.evaluate(()=>window.__backDown)} dbg=${JSON.stringify(await page.evaluate(()=>window.__flipDbg))}`);
console.log(`  min=${Math.min(...s).toFixed(1)}° overshoot_past_0=${(-Math.min(...s)).toFixed(1)}° committed_front=${await page.evaluate(()=>!document.querySelector('.flip-back').classList.contains('flip-visible'))}`);

await browser.close(); console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });

const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = req('playwright');
const BASE = 'http://localhost:3001';
const BEST = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, BEST);
const page = await ctx.newPage();

const box = () => page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
const ensureFront = async () => { const v = await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible')); if (v) { await page.reload({ waitUntil: 'networkidle' }); await sleep(1600); } };

const sampleSpring = async (dir) => {
  const out = []; const t0 = Date.now(); let prev = null;
  while (Date.now() - t0 < 800) {
    const a = await page.evaluate(() => { const tf = getComputedStyle(document.querySelector('.flip-card')).transform; const m = tf.match(/matrix3d\(([^)]+)\)/); if (!m) return tf.includes('matrix(-1') ? 180 : 0; const v = m[1].split(',').map(parseFloat); return Math.atan2(v[8], v[0]) * 180 / Math.PI; });
    let uw = a; if (prev != null) { if (dir > 0 && a - prev < -90) uw = a + 360; if (dir < 0 && a - prev > 90) uw = a - 360; } prev = uw;
    out.push(uw); await sleep(14);
  }
  return out;
};

// Non-saturating flicks: drag to ~100px (prog ~0.9, commits but not pinned at 180)
const flick = async (b, pxPerStep, msPerStep, steps) => {
  const cx = b.x + b.w/2, cy = b.y + b.h/2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(cx - i * pxPerStep, cy); await sleep(msPerStep); }
  await page.mouse.up();
};

console.log('=== GENTLE (100px over ~500ms) ===');
await page.goto(BASE, { waitUntil: 'networkidle' }); await sleep(1800);
let b = await box();
await flick(b, 10, 50, 10); // 100px, 500ms
const g = await sampleSpring(1);
const gDbg = await page.evaluate(() => window.__flipDbg);
const gCommitted = await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible'));
console.log(`  dbg: ${JSON.stringify(gDbg)} | committed: ${gCommitted}`);
console.log(`  max angle: ${Math.max(...g).toFixed(1)}° | overshoot: ${(Math.max(...g) - 180).toFixed(1)}°`);
await sleep(200);

console.log('=== HARD (100px over ~80ms) ===');
await ensureFront(); b = await box();
await flick(b, 10, 8, 10); // 100px, 80ms — fast
const h = await sampleSpring(1);
const hDbg = await page.evaluate(() => window.__flipDbg);
const hCommitted = await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible'));
console.log(`  dbg: ${JSON.stringify(hDbg)} | committed: ${hCommitted}`);
console.log(`  max angle: ${Math.max(...h).toFixed(1)}° | overshoot: ${(Math.max(...h) - 180).toFixed(1)}°`);

console.log('=== EDGE DRAG back->front (instrumented) ===');
await ensureFront();
await page.click('.front-explore-btn'); await sleep(900);
const onBack = await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible'));
b = await box();
await page.mouse.move(8, b.y + b.h/2); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(8 + i * 30, b.y + b.h/2); await sleep(20); }
await page.mouse.up();
const eDbg = await page.evaluate(() => window.__flipDbg);
const eFront = await page.evaluate(() => !document.querySelector('.flip-back').classList.contains('flip-visible'));
console.log(`  onBack: ${onBack} | dbg: ${JSON.stringify(eDbg)} | committed to front: ${eFront}`);

await browser.close();
console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });

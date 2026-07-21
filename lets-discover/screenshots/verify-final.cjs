const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = req('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BEST = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67';

(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, BEST);
const page = await ctx.newPage();
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(1800);
const box = () => page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.h || c.height }; });

const sampleSpring = async (dir, ms = 700) => {
  const out = []; const t0 = Date.now(); let prev = null;
  while (Date.now() - t0 < ms) {
    const a = await page.evaluate(() => { const tf = getComputedStyle(document.querySelector('.flip-card')).transform; const m = tf.match(/matrix3d\(([^)]+)\)/); if (!m) return tf.includes('matrix(-1') ? 180 : 0; const v = m[1].split(',').map(parseFloat); return Math.atan2(v[8], v[0]) * 180 / Math.PI; });
    let uw = a; if (prev != null) { if (dir > 0 && a - prev < -90) uw = a + 360; if (dir < 0 && a - prev > 90) uw = a - 360; } prev = uw; out.push(uw); await sleep(13);
  }
  return out;
};
const ensureFront = async () => { if (await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible'))) { await page.reload({ waitUntil: 'networkidle' }); await sleep(1500); } };
const ensureBack = async () => { if (!(await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible')))) { await page.click('.front-explore-btn'); await sleep(800); } };

// FRONT->BACK: gentle vs hard (non-saturating 100px)
const flickFB = async (b, pxPerStep, msPerStep) => { const cx=b.x+b.w/2, cy=b.y+b.h/2; await page.mouse.move(cx,cy); await page.mouse.down(); for(let i=1;i<=10;i++){await page.mouse.move(cx-i*pxPerStep,cy); await sleep(msPerStep);} await page.mouse.up(); };

console.log('=== FRONT->BACK GENTLE ===');
await ensureFront(); let b = await box();
await flickFB(b, 10, 50);
let s = await sampleSpring(1);
console.log(`  dbg=${JSON.stringify(await page.evaluate(()=>window.__flipDbg))} max=${Math.max(...s).toFixed(1)}° overshoot=${(Math.max(...s)-180).toFixed(1)}° committed=${await page.evaluate(()=>document.querySelector('.flip-back').classList.contains('flip-visible'))}`);

console.log('=== FRONT->BACK HARD ===');
await ensureFront(); b = await box();
await flickFB(b, 10, 8);
s = await sampleSpring(1);
console.log(`  dbg=${JSON.stringify(await page.evaluate(()=>window.__flipDbg))} max=${Math.max(...s).toFixed(1)}° overshoot=${(Math.max(...s)-180).toFixed(1)}° committed=${await page.evaluate(()=>document.querySelector('.flip-back').classList.contains('flip-visible'))}`);

// BACK->FRONT: gentle vs hard (non-saturating, from left edge)
const flickBF = async (b, pxPerStep, msPerStep) => { const cy=b.y+b.h/2; await page.mouse.move(8,cy); await page.mouse.down(); for(let i=1;i<=10;i++){await page.mouse.move(8+i*pxPerStep,cy); await sleep(msPerStep);} await page.mouse.up(); };

console.log('=== BACK->FRONT GENTLE ===');
await ensureBack(); b = await box();
await flickBF(b, 10, 50);
await sleep(50);
s = await sampleSpring(-1);
console.log(`  dbg=${JSON.stringify(await page.evaluate(()=>window.__flipDbg))} min=${Math.min(...s).toFixed(1)}° overshoot_past_0=${(-Math.min(...s)).toFixed(1)}° committed_front=${await page.evaluate(()=>!document.querySelector('.flip-back').classList.contains('flip-visible'))}`);

console.log('=== BACK->FRONT HARD ===');
await ensureBack(); b = await box();
await flickBF(b, 10, 8);
await sleep(50);
s = await sampleSpring(-1);
console.log(`  dbg=${JSON.stringify(await page.evaluate(()=>window.__flipDbg))} min=${Math.min(...s).toFixed(1)}° overshoot_past_0=${(-Math.min(...s)).toFixed(1)}° committed_front=${await page.evaluate(()=>!document.querySelector('.flip-back').classList.contains('flip-visible'))}`);

// CHAT check
console.log('=== CHAT ===');
await page.reload({ waitUntil: 'networkidle' }); await sleep(1800);
const c = await page.evaluate(() => ({ n: document.querySelectorAll('.front-bubble').length, cls: [...document.querySelectorAll('.front-bubble')].map(b=>b.className) }));
console.log(`  bubbles=${c.n} classes=${JSON.stringify(c.cls)}`);

await browser.close(); console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });

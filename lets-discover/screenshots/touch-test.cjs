const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.js');
const { chromium } = req('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BEST = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67';
(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, BEST);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
const sleep2 = sleep;
const touchSeq = async (pts, stepMs) => {
  // pts: array of {x,y}; first = start
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: pts[0].x, y: pts[0].y, radiusX: 1, radiusY: 1, force: 1 }], modifiers: 0, timestamp: Date.now() });
  for (let i = 1; i < pts.length; i++) {
    await sleep(stepMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: pts[i].x, y: pts[i].y, radiusX: 1, radiusY: 1, force: 1 }], modifiers: 0, timestamp: Date.now() });
  }
  await sleep(stepMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id: 1, x: pts[pts.length-1].x, y: pts[pts.length-1].y, radiusX: 1, radiusY: 1, force: 1 }], modifiers: 0, timestamp: Date.now() });
};
const sampleSpring = async (dir, ms = 650) => {
  const out = []; const t0 = Date.now(); let prev = null;
  while (Date.now() - t0 < ms) {
    const a = await page.evaluate(() => { const tf = getComputedStyle(document.querySelector('.flip-card')).transform; const m = tf.match(/matrix3d\(([^)]+)\)/); if (!m) return tf.includes('matrix(-1') ? 180 : 0; const v = m[1].split(',').map(parseFloat); return Math.atan2(v[8], v[0]) * 180 / Math.PI; });
    let uw = a; if (prev != null) { if (dir > 0 && a - prev < -90) uw = a + 360; if (dir < 0 && a - prev > 90) uw = a - 360; } prev = uw; out.push(uw); await sleep(13);
  }
  return out;
};
const onFront = () => page.evaluate(() => !document.querySelector('.flip-back').classList.contains('flip-visible'));
const box = () => page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });

await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(2000);
let b = await box(); const cy = b.y + b.h/2;

// TOUCH F->B gentle (slow) — center to left
const ptsFB = Array.from({length:10}, (_,i) => ({ x: Math.round(b.x+b.w/2 - (i+1)*12), y: Math.round(cy) }));
await touchSeq(ptsFB, 50);
let s = await sampleSpring(1);
console.log(`TOUCH F->B gentle: overshoot past 180 = ${(Math.max(...s)-180).toFixed(1)}° committed=${!await onFront()}`);

// TOUCH B->F gentle (slow) — edge to right  (we're on back now)
b = await box();
const ptsBF = Array.from({length:10}, (_,i) => ({ x: 8 + (i+1)*12, y: Math.round(cy) }));
await touchSeq(ptsBF, 50);
s = await sampleSpring(-1);
console.log(`TOUCH B->F gentle: overshoot past 0 = ${(-Math.min(...s)).toFixed(1)}° committed_front=${await onFront()}`);

// TOUCH B->F hard (fast) — go to back first via touch
if (await onFront()) { b = await box(); const p = Array.from({length:10}, (_,i) => ({ x: Math.round(b.x+b.w/2-(i+1)*12), y: Math.round(cy) })); await touchSeq(p, 12); await sleep(500); }
b = await box();
const ptsBFh = Array.from({length:10}, (_,i) => ({ x: 8 + (i+1)*12, y: Math.round(cy) }));
await touchSeq(ptsBFh, 12);
s = await sampleSpring(-1);
console.log(`TOUCH B->F hard  : overshoot past 0 = ${(-Math.min(...s)).toFixed(1)}° committed_front=${await onFront()}`);

await browser.close(); console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });

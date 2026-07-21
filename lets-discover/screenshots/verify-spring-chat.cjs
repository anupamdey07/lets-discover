const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = req('playwright');
const path = require('path');
const BASE = 'http://localhost:3001';
const BEST = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67';

const parseAngle = (tf) => {
  const m = tf.match(/matrix3d\(([^)]+)\)/);
  if (!m) { return tf.includes('matrix(-1') ? 180 : 0; }
  const v = m[1].split(',').map(parseFloat);
  return Math.atan2(v[8], v[0]) * 180 / Math.PI; // atan2(sin, cos)
};
// unwrap toward an increasing or decreasing target
const unwrap = (a, prev, dir) => {
  if (prev == null) return a;
  if (dir > 0 && a - prev < -90) a += 360;
  if (dir < 0 && a - prev > 90) a -= 360;
  return a;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, BEST);
const page = await ctx.newPage();

// ============ CHAT: 2-3 bubbles + soft fade + border room ============
console.log('=== CHAT VISIBILITY ===');
await page.goto(BASE, { waitUntil: 'networkidle' });
await sleep(2200);
const chat = await page.evaluate(() => {
  const bubbles = [...document.querySelectorAll('.front-bubble')];
  const fc = document.querySelector('.front-chat').getBoundingClientRect();
  return {
    bubbleCount: bubbles.length,
    classes: bubbles.map(b => b.className),
    chatPad: getComputedStyle(document.querySelector('.front-chat')).padding,
    chatBox: { top: Math.round(fc.top), bottom: Math.round(fc.bottom), left: Math.round(fc.left), right: Math.round(fc.right) },
    firstBubbleTop: bubbles[0] ? Math.round(bubbles[0].getBoundingClientRect().top) : null,
    lastBubbleBottom: bubbles.length ? Math.round(bubbles[bubbles.length-1].getBoundingClientRect().bottom) : null,
    viewportH: window.innerHeight,
  };
});
console.log('  ', JSON.stringify(chat, null, 1));
await page.screenshot({ path: 'screenshots/10-chat-2-3-bubbles.png' });

// ============ FLIP: swipe commit + spring overshoot ============
const box = () => page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });

const sampleSpring = async (dir) => {
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 900) {
    const a = await page.evaluate(() => { const tf = getComputedStyle(document.querySelector('.flip-card')).transform; const m = tf.match(/matrix3d\(([^)]+)\)/); if (!m) return tf.includes('matrix(-1') ? 180 : 0; const v = m[1].split(',').map(parseFloat); return Math.atan2(v[8], v[0]) * 180 / Math.PI; });
    samples.push({ t: Date.now() - t0, a });
    await sleep(16);
  }
  // unwrap
  let prev = null; const uw = samples.map(s => { let a = unwrap(s.a, prev, dir); prev = a; return { t: s.t, a }; });
  return uw;
};

const ensureFront = async () => {
  const vis = await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible'));
  if (vis) { await page.reload({ waitUntil: 'networkidle' }); await sleep(1800); }
};

// --- GENTLE flick (slow, low velocity) ---
console.log('=== GENTLE FLICK (front->back) ===');
await ensureFront();
const b1 = await box();
await page.mouse.move(b1.x + b1.w/2, b1.y + b1.h/2); await page.mouse.down();
for (let i = 1; i <= 14; i++) { await page.mouse.move(b1.x + b1.w/2 - i*18, b1.y + b1.h/2); await sleep(45); } // slow ~630ms
const gentleStart = Date.now();
await page.mouse.up();
const gentle = await sampleSpring(1);
const gentleCommitted = await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible'));
const gentleMax = Math.max(...gentle.map(s => s.a));
const gentleMin = Math.min(...gentle.map(s => s.a));
console.log(`  committed: ${gentleCommitted} | angle range: [${gentleMin.toFixed(1)} .. ${gentleMax.toFixed(1)}] | overshoot past 180: ${(gentleMax - 180).toFixed(1)}°`);
await sleep(300);

// --- HARD flick (fast, high velocity) ---
console.log('=== HARD FLICK (front->back) ===');
await ensureFront();
const b2 = await box();
await page.mouse.move(b2.x + b2.w/2, b2.y + b2.h/2); await page.mouse.down();
for (let i = 1; i <= 14; i++) { await page.mouse.move(b2.x + b2.w/2 - i*22, b2.y + b2.h/2); await sleep(10); } // fast ~140ms
await page.mouse.up();
const hard = await sampleSpring(1);
const hardCommitted = await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible'));
const hardMax = Math.max(...hard.map(s => s.a));
const hardMin = Math.min(...hard.map(s => s.a));
console.log(`  committed: ${hardCommitted} | angle range: [${hardMin.toFixed(1)} .. ${hardMax.toFixed(1)}] | overshoot past 180: ${(hardMax - 180).toFixed(1)}°`);
await page.screenshot({ path: 'screenshots/11-back-after-swipe.png' });

// --- SNAP-BACK (below threshold) ---
console.log('=== SNAP-BACK (under threshold) ===');
await ensureFront();
const b3 = await box();
await page.mouse.move(b3.x + b3.w/2, b3.y + b3.h/2); await page.mouse.down();
for (let i = 1; i <= 6; i++) { await page.mouse.move(b3.x + b3.w/2 - i*12, b3.y + b3.h/2); await sleep(30); } // ~72px < 80 threshold
await page.mouse.up();
const snap = await sampleSpring(1);
const snapCommitted = await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible'));
const snapMax = Math.max(...snap.map(s => s.a));
console.log(`  committed (should be false): ${snapCommitted} | peak angle: ${snapMax.toFixed(1)}° (should return toward 0)`);

// --- BACK->FRONT edge drag ---
console.log('=== EDGE DRAG (back->front) ===');
// first get to back via button
await ensureFront();
await page.click('.front-explore-btn'); await sleep(900);
const onBack = await page.evaluate(() => document.querySelector('.flip-back').classList.contains('flip-visible'));
await page.mouse.move(8, b2.y + b2.h/2); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(8 + i*30, b2.y + b2.h/2); await sleep(22); }
await page.mouse.up();
const backFront = await sampleSpring(-1);
const bfCommitted = await page.evaluate(() => !document.querySelector('.flip-back').classList.contains('flip-visible'));
const bfMin = Math.min(...backFront.map(s => s.a));
console.log(`  was on back: ${onBack} | committed to front: ${bfCommitted} | min angle: ${bfMin.toFixed(1)}° (overshoot past 0: ${(-bfMin).toFixed(1)}°)`);

await browser.close();
console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });

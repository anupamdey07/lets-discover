const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.js');
const { chromium } = req('playwright');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BEST = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67';
(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => { try { localStorage.setItem('ld_session_id', s); } catch (e) {} }, BEST);
const page = await ctx.newPage();
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' }); await sleep(2200);

const box = () => page.evaluate(() => { const c = document.querySelector('.flip-container').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
const sampleSpring = async (dir, ms = 650) => {
  const out = []; const t0 = Date.now(); let prev = null;
  while (Date.now() - t0 < ms) {
    const a = await page.evaluate(() => { const tf = getComputedStyle(document.querySelector('.flip-card')).transform; const m = tf.match(/matrix3d\(([^)]+)\)/); if (!m) return tf.includes('matrix(-1') ? 180 : 0; const v = m[1].split(',').map(parseFloat); return Math.atan2(v[8], v[0]) * 180 / Math.PI; });
    let uw = a; if (prev != null) { if (dir > 0 && a - prev < -90) uw = a + 360; if (dir < 0 && a - prev > 90) uw = a - 360; } prev = uw; out.push(uw); await sleep(13);
  }
  return out;
};
const onFront = () => page.evaluate(() => !document.querySelector('.flip-back').classList.contains('flip-visible'));
const flickFB = async (b, fast) => { const cx=b.x+b.w/2, cy=b.y+b.h/2; await page.mouse.move(cx,cy); await page.mouse.down(); const d = fast?8:50; for(let i=1;i<=10;i++){await page.mouse.move(cx-i*10,cy); await sleep(d);} await page.mouse.up(); };
const flickBF = async (b, fast) => { const cy=b.y+b.h/2; await page.mouse.move(8,cy); await page.mouse.down(); const d = fast?8:50; for(let i=1;i<=10;i++){await page.mouse.move(8+i*10,cy); await sleep(d);} await page.mouse.up(); };
const toBack = async () => { if (await onFront()) { const b=await box(); await flickFB(b,true); await sleep(600); } };
const toFront = async () => { if (!await onFront()) { const b=await box(); await flickBF(b,true); await sleep(600); } };

// CHAT
const chat = await page.evaluate(() => ({ n: document.querySelectorAll('.front-bubble').length, pad: getComputedStyle(document.querySelector('.front-chat')).padding, cls: [...document.querySelectorAll('.front-bubble')].map(b=>b.className.replace('front-bubble ','')) }));
console.log('CHAT bubbles:', chat.n, '| pad:', chat.pad, '| classes:', JSON.stringify(chat.cls));
await page.screenshot({ path: 'screenshots/30-chat.png' });

// F->B gentle / hard
await toFront(); let b = await box();
await flickFB(b, false); let s = await sampleSpring(1);
console.log(`F->B gentle : overshoot past 180 = ${(Math.max(...s)-180).toFixed(1)}° | committed=${!await onFront()}`);
await toFront(); b = await box();
await flickFB(b, true); s = await sampleSpring(1);
console.log(`F->B hard   : overshoot past 180 = ${(Math.max(...s)-180).toFixed(1)}° | committed=${!await onFront()}`);
await sleep(400);
await page.screenshot({ path: 'screenshots/31-back.png' });

// B->F gentle / hard
await toBack(); b = await box();
await flickBF(b, false); s = await sampleSpring(-1);
console.log(`B->F gentle : overshoot past 0 = ${(-Math.min(...s)).toFixed(1)}° | committed_front=${await onFront()}`);
await toBack(); b = await box();
await flickBF(b, true); s = await sampleSpring(-1);
console.log(`B->F hard   : overshoot past 0 = ${(-Math.min(...s)).toFixed(1)}° | committed_front=${await onFront()}`);

// Snap-back (under threshold)
await toFront(); b = await box();
const cx=b.x+b.w/2, cy=b.y+b.h/2;
await page.mouse.move(cx,cy); await page.mouse.down();
for(let i=1;i<=6;i++){await page.mouse.move(cx-i*12,cy); await sleep(30);} // 72px < 80 threshold
await page.mouse.up(); s = await sampleSpring(1);
console.log(`Snap-back   : peak=${Math.max(...s).toFixed(1)}° (returns to 0) | stayed_front=${await onFront()}`);

console.log('DONE');
await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

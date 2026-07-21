import { chromium } from 'playwright';
import path from 'path';

const BASE = 'http://localhost:3001';
const OUT = path.resolve('screenshots');
const BEST_SESSION = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67'; // 30 msgs, Berlin, medium-blue

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on('console', m => { if (m.type()==='error') console.log('PAGE ERR:', m.text()); });
page.on('pageerror', e => console.log('PAGEEXC:', e.message));

async function shot(name, full=false) {
  await page.waitForTimeout(900); // let anims settle
  await page.screenshot({ path: path.join(OUT, name), fullPage: full });
  console.log('  📸', name);
}

// ---------- 1. EMPTY / WELCOME STATE (fresh, no session) ----------
console.log('[1] Empty welcome state');
await page.goto(BASE, { waitUntil: 'networkidle' });
await shot('01-welcome-empty.png');

// ---------- 2. POPULATED FRONT (with session, medium-blue theme) ----------
console.log('[2] Populated front face (medium-blue session)');
await page.evaluate(() => localStorage.clear());
await ctx.addInitScript((sid) => { window.__ldsid = sid; }, BEST_SESSION);
// addInitScript runs once per document load; set localStorage before app boots
await ctx.addInitScript(() => {
  if (window.__ldsid) { try { localStorage.setItem('ld_session_id', window.__ldsid); } catch(e){} }
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('ld_session_id', '4d000fb8-fb41-4bf2-b5f9-6d7629171c67'); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500); // fetches: persona, activities, messages, quickpicks
await shot('02-front-populated.png');

// Inspect computed theme + key elements
const probe = await page.evaluate(() => {
  const app = document.querySelector('.app');
  const fc = document.querySelector('.flip-card');
  const front = document.querySelector('.flip-front');
  const dt = app?.getAttribute('data-theme');
  const cs = getComputedStyle(document.documentElement);
  return {
    dataTheme: dt,
    bg: cs.getPropertyValue('--bg').trim(),
    accent: cs.getPropertyValue('--accent').trim(),
    cardTransform: getComputedStyle(fc).transform,
    frontHidden: front?.classList.contains('flip-hidden'),
    exploreBtnVisible: !!document.querySelector('.front-explore-btn'),
    msgCount: document.querySelectorAll('.front-bubble').length,
    hasWelcome: !!document.querySelector('.front-welcome'),
  };
});
console.log('   PROBE:', JSON.stringify(probe, null, 0));

// ---------- 3. THEME CHECK: medium-blue fallback ----------
console.log('[3] Theme check (medium-blue vs defined themes)');
const themeProbe = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const pick = (sel) => {
    const el = document.createElement('div');
    el.setAttribute('data-theme', sel); el.style.cssText='position:fixed;left:-9999px';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const v = { accent: cs.getPropertyValue('--accent').trim(), bg: cs.getPropertyValue('--bg').trim() };
    el.remove();
    return v;
  };
  return {
    current: document.querySelector('.app')?.getAttribute('data-theme'),
    rootAccent: root.getPropertyValue('--accent').trim(),
    soft_blue: pick('soft-blue'),
    medium_blue: pick('medium-blue'),
    vibrant_blue: pick('vibrant-blue'),
    soft_pink: pick('soft-pink'),
    medium_pink: pick('medium-pink'),
    vibrant_pink: pick('vibrant-pink'),
  };
});
console.log('   THEME PROBE:', JSON.stringify(themeProbe, null, 2));

// ---------- 4. FLIP via button ----------
console.log('[4] Flip via "Explore discoveries" button');
const btn = await page.$('.front-explore-btn');
if (btn) {
  await btn.click();
  await page.waitForTimeout(1200); // 0.6s spring + settle
  await shot('03-back-via-button.png');
  const st1 = await page.evaluate(() => ({
    flipped: document.querySelector('.flip-card')?.className,
    backVisible: document.querySelector('.flip-back')?.classList.contains('flip-visible'),
    discoveryCards: document.querySelectorAll('.discovery-card').length,
    themeBtns: document.querySelectorAll('[data-theme-btn], .theme-btn, .theme-chip').length,
  }));
  console.log('   BACK STATE:', JSON.stringify(st1));
} else {
  console.log('   no explore btn');
}

// ---------- 5. Flip back to front via left-edge drag ----------
console.log('[5] Edge-drag back→front');
const box = await page.evaluate(() => {
  const c = document.querySelector('.flip-container').getBoundingClientRect();
  return { x: c.x, y: c.y, w: c.width, h: c.height };
});
// drag from left edge (x<40) rightward
await page.mouse.move(8, box.y + box.h/2);
await page.mouse.down();
for (let i=1;i<=12;i++){ await page.mouse.move(8 + i*30, box.y + box.h/2); await page.waitForTimeout(16); }
await page.mouse.up();
await page.waitForTimeout(1200);
await shot('04-front-after-edge-drag.png');
const st2 = await page.evaluate(() => ({ flippedClass: document.querySelector('.flip-card')?.className }));
console.log('   AFTER EDGE DRAG:', JSON.stringify(st2));

// ---------- 6. Front→back via DRAG (mid-rotation capture) ----------
console.log('[6] Front→back drag, mid-rotation capture');
// get back to front first if needed
const onFront = await page.evaluate(() => !document.querySelector('.flip-card')?.classList.contains('flipped'));
if (!onFront) { const b2 = await page.$('.front-explore-btn'); }
// drag left from center
await page.mouse.move(box.x + box.w/2, box.y + box.h/2);
await page.mouse.down();
for (let i=1;i<=8;i++){ await page.mouse.move(box.x + box.w/2 - i*25, box.y + box.h/2); await page.waitForTimeout(20); }
await page.waitForTimeout(100);
await shot('05-drag-midrotation.png'); // card partially rotated
const midT = await page.evaluate(() => getComputedStyle(document.querySelector('.flip-card')).transform);
console.log('   MID TRANSFORM:', midT);
await page.mouse.up();
await page.waitForTimeout(1200);
await shot('06-after-drag-release.png');
const st3 = await page.evaluate(() => ({ flippedClass: document.querySelector('.flip-card')?.className }));
console.log('   AFTER DRAG RELEASE:', JSON.stringify(st3));

// ---------- 7. RIGHT-swipe on front (direction-agnostic test) ----------
console.log('[7] Right-swipe on front (does it also flip?)');
// ensure on front
const onFront2 = await page.evaluate(() => !document.querySelector('.flip-card')?.classList.contains('flipped'));
if (!onFront2) {
  // edge drag back
  await page.mouse.move(8, box.y + box.h/2); await page.mouse.down();
  for (let i=1;i<=12;i++){ await page.mouse.move(8 + i*30, box.y + box.h/2); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(1000);
}
await page.mouse.move(box.x + box.w/2, box.y + box.h/2);
await page.mouse.down();
for (let i=1;i<=8;i++){ await page.mouse.move(box.x + box.w/2 + i*30, box.y + box.h/2); await page.waitForTimeout(20); }
await page.mouse.up();
await page.waitForTimeout(1000);
const st4 = await page.evaluate(() => ({ flipped: document.querySelector('.flip-card')?.classList.contains('flipped') }));
console.log('   RIGHT-SWIPE RESULT (flipped?):', JSON.stringify(st4));
await shot('07-after-right-swipe.png');

await browser.close();
console.log('DONE');

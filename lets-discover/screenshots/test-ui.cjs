const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = req('playwright');
const path = require('path');

const BASE = 'http://localhost:3001';
const OUT = path.resolve('screenshots');
const BEST = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67';

(async () => {
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript((sid) => { try { localStorage.setItem('ld_session_id', sid); } catch(e){} }, BEST);
const page = await ctx.newPage();
page.on('console', m => { if (m.type()==='error') console.log('PAGE ERR:', m.text()); });
page.on('pageerror', e => console.log('PAGEEXC:', e.message));

const shot = async (name) => { await page.waitForTimeout(900); await page.screenshot({ path: path.join(OUT, name) }); console.log('  📸', name); };

console.log('[1] Empty welcome state');
await page.goto(BASE, { waitUntil: 'networkidle' });
// clear the init-script session for a truly fresh view
await page.evaluate(() => localStorage.removeItem('ld_session_id'));
await page.reload({ waitUntil: 'networkidle' });
await shot('01-welcome-empty.png');
const emptyProbe = await page.evaluate(() => ({ welcome: !!document.querySelector('.front-welcome'), bubbles: document.querySelectorAll('.front-bubble').length, exploreBtn: !!document.querySelector('.front-explore-btn') }));
console.log('   EMPTY PROBE:', JSON.stringify(emptyProbe));

console.log('[2] Populated front face');
await page.evaluate((s)=>localStorage.setItem('ld_session_id',s), BEST);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await shot('02-front-populated.png');
const probe = await page.evaluate(() => {
  const app=document.querySelector('.app'), fc=document.querySelector('.flip-card'), front=document.querySelector('.flip-front');
  const cs=getComputedStyle(document.documentElement);
  return { dataTheme: app?.getAttribute('data-theme'), accent: cs.getPropertyValue('--accent').trim(), bg: cs.getPropertyValue('--bg').trim(),
    frontHidden: front?.classList.contains('flip-hidden'), exploreBtn: !!document.querySelector('.front-explore-btn'),
    bubbles: document.querySelectorAll('.front-bubble').length, welcome: !!document.querySelector('.front-welcome'),
    cardTransform: getComputedStyle(fc).transform };
});
console.log('   PROBE:', JSON.stringify(probe));

console.log('[3] Theme map (medium-* fallback test)');
const tp = await page.evaluate(() => {
  const pick = (sel) => { const el=document.createElement('div'); el.setAttribute('data-theme',sel); el.style.cssText='position:fixed;left:-9999px'; document.body.appendChild(el); const cs=getComputedStyle(el); const v={accent:cs.getPropertyValue('--accent').trim(),bg:cs.getPropertyValue('--bg').trim()}; el.remove(); return v; };
  return { current: document.querySelector('.app')?.getAttribute('data-theme'),
    soft_blue: pick('soft-blue'), medium_blue: pick('medium-blue'), vibrant_blue: pick('vibrant-blue'),
    soft_pink: pick('soft-pink'), medium_pink: pick('medium-pink'), vibrant_pink: pick('vibrant-pink') };
});
console.log('   THEME:', JSON.stringify(tp,null,1));

console.log('[4] Flip via Explore button');
const btn = await page.$('.front-explore-btn');
if (btn) { await btn.click(); await page.waitForTimeout(1200); await shot('03-back-via-button.png');
  const st = await page.evaluate(() => ({ flipped: document.querySelector('.flip-card').classList.contains('flipped'), backVisible: document.querySelector('.flip-back')?.classList.contains('flip-visible'), discoveryCards: document.querySelectorAll('.discovery-card').length, themeChips: document.querySelectorAll('.theme-chip, [data-theme-btn]').length }));
  console.log('   BACK:', JSON.stringify(st));
} else console.log('   no btn');

const box = await page.evaluate(() => { const c=document.querySelector('.flip-container').getBoundingClientRect(); return {x:c.x,y:c.y,w:c.width,h:c.height}; });

console.log('[5] Edge-drag back→front');
await page.mouse.move(8, box.y+box.h/2); await page.mouse.down();
for (let i=1;i<=12;i++){ await page.mouse.move(8+i*30, box.y+box.h/2); await page.waitForTimeout(16); }
await page.mouse.up(); await page.waitForTimeout(1200);
await shot('04-front-after-edge-drag.png');
console.log('   flipped?:', await page.evaluate(()=>document.querySelector('.flip-card').classList.contains('flipped')));

console.log('[6] Front→back drag, mid-rotation');
await page.mouse.move(box.x+box.w/2, box.y+box.h/2); await page.mouse.down();
for (let i=1;i<=8;i++){ await page.mouse.move(box.x+box.w/2 - i*25, box.y+box.h/2); await page.waitForTimeout(20); }
await page.waitForTimeout(80);
await shot('05-drag-midrotation.png');
console.log('   midT:', await page.evaluate(()=>getComputedStyle(document.querySelector('.flip-card')).transform));
await page.mouse.up(); await page.waitForTimeout(1200);
await shot('06-after-drag-release.png');
console.log('   flipped?:', await page.evaluate(()=>document.querySelector('.flip-card').classList.contains('flipped')));

console.log('[7] Right-swipe on front (direction test)');
let onFront = await page.evaluate(()=>!document.querySelector('.flip-card').classList.contains('flipped'));
if (!onFront) { await page.mouse.move(8, box.y+box.h/2); await page.mouse.down(); for(let i=1;i<=12;i++){await page.mouse.move(8+i*30, box.y+box.h/2); await page.waitForTimeout(16);} await page.mouse.up(); await page.waitForTimeout(1000); }
await page.mouse.move(box.x+box.w/2, box.y+box.h/2); await page.mouse.down();
for (let i=1;i<=8;i++){ await page.mouse.move(box.x+box.w/2 + i*30, box.y+box.h/2); await page.waitForTimeout(20); }
await page.mouse.up(); await page.waitForTimeout(1000);
await shot('07-after-right-swipe.png');
console.log('   right-swipe flipped?:', await page.evaluate(()=>document.querySelector('.flip-card').classList.contains('flipped')));

await browser.close();
console.log('DONE');
})().catch(e=>{ console.error('FATAL', e); process.exit(1); });

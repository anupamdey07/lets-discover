const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = req('playwright');
const path = require('path');
const BASE = 'http://localhost:3001';
const BEST = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67';

(async () => {
const browser = await chromium.launch({ headless: true, args:['--no-sandbox'] });
const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:1, isMobile:true, hasTouch:true });
await ctx.addInitScript((s)=>{ try{localStorage.setItem('ld_session_id',s)}catch(e){} }, BEST);
const page = await ctx.newPage();
const log = [];
await page.goto(BASE, { waitUntil:'networkidle' });
await page.waitForTimeout(2000);
// Install observer
await page.evaluate(() => {
  window.__log = [];
  const card = document.querySelector('.flip-card');
  const obs = new MutationObserver((muts) => {
    for (const m of muts) window.__log.push({ t: performance.now().toFixed(0), cls: document.querySelector('.flip-card').className, tf: getComputedStyle(document.querySelector('.flip-card')).transform.slice(0,40) });
  });
  obs.observe(card, { attributes: true, attributeFilter: ['class','style'] });
});
const flush = async (label) => { const l = await page.evaluate(()=>window.__log.slice()); console.log(`  [${label}] ${l.length} mutations:`); l.slice(0,8).forEach(x=>console.log(`     ${x.t}ms  cls="${x.cls}"  tf=${x.tf}`)); await page.evaluate(()=>window.__log.length=0); };

const box = await page.evaluate(()=>{ const c=document.querySelector('.flip-container').getBoundingClientRect(); return {x:c.x,y:c.y,w:c.width,h:c.height}; });

console.log('A) Button click flip:');
await page.click('.front-explore-btn');
await page.waitForTimeout(1500);
await flush('after button click');
console.log('   flipped now:', await page.evaluate(()=>document.querySelector('.flip-card').classList.contains('flipped')));

console.log('B) Edge-drag back->front (drag 360px from x=8):');
await page.mouse.move(8, box.y+box.h/2); await page.mouse.down();
for (let i=1;i<=12;i++){ await page.mouse.move(8+i*30, box.y+box.h/2); await page.waitForTimeout(18); }
// sample transform near end of drag
const nearEnd = await page.evaluate(()=>getComputedStyle(document.querySelector('.flip-card')).transform);
console.log('   near-end transform:', nearEnd.slice(0,50));
await page.mouse.up();
await page.waitForTimeout(1500);
await flush('after edge drag');
console.log('   flipped now:', await page.evaluate(()=>document.querySelector('.flip-card').classList.contains('flipped')));

console.log('C) Front->back drag 200px then release (commit test):');
// ensure on front
if (await page.evaluate(()=>document.querySelector('.flip-card').classList.contains('flipped'))) {
  await page.click('.front-explore-btn'); await page.waitForTimeout(800); // toggle? no, button gone on back
}
// force to front by reload if needed
if (await page.evaluate(()=>document.querySelector('.flip-card').classList.contains('flipped'))) {
  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(1500);
  await page.evaluate(()=>{ const c=document.querySelector('.flip-card'); const o=new MutationObserver(()=>window.__log.push({t:performance.now().toFixed(0),cls:c.className,tf:getComputedStyle(c).transform.slice(0,40)})); o.observe(c,{attributes:true,attributeFilter:['class','style']}); });
}
const box2 = await page.evaluate(()=>{ const c=document.querySelector('.flip-container').getBoundingClientRect(); return {x:c.x,y:c.y,w:c.width,h:c.height}; });
await page.mouse.move(box2.x+box2.w/2, box2.y+box2.h/2); await page.mouse.down();
for (let i=1;i<=10;i++){ await page.mouse.move(box2.x+box2.w/2 - i*20, box2.y+box2.h/2); await page.waitForTimeout(18); }
const midT = await page.evaluate(()=>getComputedStyle(document.querySelector('.flip-card')).transform);
console.log('   mid-drag transform (200px):', midT.slice(0,50));
await page.mouse.up();
await page.waitForTimeout(1500);
await flush('after front->back drag');
console.log('   flipped now (committed?):', await page.evaluate(()=>document.querySelector('.flip-card').classList.contains('flipped')));

console.log('D) Touch swipe (mobile) front->back:');
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(1500);
await page.evaluate(()=>{ const c=document.querySelector('.flip-card'); const o=new MutationObserver(()=>window.__log.push({t:performance.now().toFixed(0),cls:c.className,tf:getComputedStyle(c).transform.slice(0,40)})); o.observe(c,{attributes:true,attributeFilter:['class','style']}); });
const b3 = await page.evaluate(()=>{ const c=document.querySelector('.flip-container').getBoundingClientRect(); return {x:c.x,y:c.y,w:c.width,h:c.height}; });
const cx = b3.x+b3.w/2, cy = b3.y+b3.h/2;
await page.touchscreen.tap(cx, cy); // ensure focus
// simulate touch swipe left
await page.touchscreen.touchStart(cx, cy);
for (let i=1;i<=10;i++){ await page.touchscreen.touchMove(cx - i*22, cy); await page.waitForTimeout(18); }
await page.touchscreen.touchEnd();
await page.waitForTimeout(1500);
await flush('after touch swipe');
console.log('   flipped now (touch committed?):', await page.evaluate(()=>document.querySelector('.flip-card').classList.contains('flipped')));

await browser.close();
console.log('DONE');
})().catch(e=>{ console.error('FATAL',e); process.exit(1); });

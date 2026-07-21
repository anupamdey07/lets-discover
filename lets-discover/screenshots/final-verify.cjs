const { createRequire } = require('module');
const req = createRequire('/home/deepmind/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = req('playwright');
const BASE = 'http://localhost:3001';
const BEST = '4d000fb8-fb41-4bf2-b5f9-6d7629171c67';
const state = () => page.evaluate(() => {
  const card = document.querySelector('.flip-card');
  const front = document.querySelector('.flip-front');
  const back = document.querySelector('.flip-back');
  return {
    transform: getComputedStyle(card).transform.slice(0,45),
    rotateY: (getComputedStyle(card).transform.match(/matrix3d\(([^,]+)/) ? 'has-3d' : getComputedStyle(card).transform),
    frontHidden: front.classList.contains('flip-hidden'),
    backVisible: back.classList.contains('flip-visible'),
    flippedClass: card.classList.contains('flipped'),
  };
});
let page;
(async () => {
const browser = await chromium.launch({ headless:true, args:['--no-sandbox'] });

// ---- FRESH: no session (welcome) ----
const ctx1 = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:1, isMobile:true, hasTouch:true });
page = await ctx1.newPage();
await page.goto(BASE, { waitUntil:'networkidle' }); await page.waitForTimeout(1500);
const fresh = await page.evaluate(() => ({
  welcome: !!document.querySelector('.front-welcome'),
  bubbles: document.querySelectorAll('.front-bubble').length,
  exploreBtn: !!document.querySelector('.front-explore-btn'),
  swipeHint: !!document.querySelector('.front-hint, .back-swipe-hint'),
  inputVisible: !!document.querySelector('.front-input'),
  dataThemeFront: document.querySelector('.flip-front .app')?.getAttribute('data-theme'),
}));
console.log('FRESH WELCOME:', JSON.stringify(fresh));
// try swipe on fresh
const b1 = await page.evaluate(()=>{const c=document.querySelector('.flip-container').getBoundingClientRect();return{x:c.x,y:c.y,w:c.width,h:c.height};});
await page.mouse.move(b1.x+b1.w/2, b1.y+b1.h/2); await page.mouse.down();
for(let i=1;i<=10;i++){await page.mouse.move(b1.x+b1.w/2-i*22, b1.y+b1.h/2); await page.waitForTimeout(18);}
await page.mouse.up(); await page.waitForTimeout(1200);
console.log('  fresh after swipe:', JSON.stringify(await state()));
await page.screenshot({path:'screenshots/00-welcome-fresh.png'});
await ctx1.close();

// ---- POPULATED: button flip reliability (5 trials) ----
const ctx2 = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:1, isMobile:true, hasTouch:true });
await ctx2.addInitScript((s)=>{try{localStorage.setItem('ld_session_id',s)}catch(e){}}, BEST);
page = await ctx2.newPage();
await page.goto(BASE,{waitUntil:'networkidle'}); await page.waitForTimeout(2000);
console.log('  initial:', JSON.stringify(await state()));
for (let t=1;t<=3;t++){
  // ensure front
  if (await page.evaluate(()=>document.querySelector('.flip-back').classList.contains('flip-visible'))) {
    // flip back via JS to reset cleanly
    await page.evaluate(()=>{ const btn=document.querySelector('.back-swipe-hint'); });
  }
  await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(1800);
  await page.click('.front-explore-btn'); await page.waitForTimeout(1200);
  const s = await state();
  console.log(`  button trial ${t}:`, JSON.stringify(s));
}
// JS-direct click (no mousedown-drag interference?) — actually mousedown still bubbles; test dispatching click only
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(1800);
await page.evaluate(()=>document.querySelector('.front-explore-btn').click());
await page.waitForTimeout(1200);
console.log('  JS .click() trial:', JSON.stringify(await state()));

// drag commit test, measuring with REAL signal (transform/backVisible)
await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(1800);
const b2 = await page.evaluate(()=>{const c=document.querySelector('.flip-container').getBoundingClientRect();return{x:c.x,y:c.y,w:c.width,h:c.height};});
await page.mouse.move(b2.x+b2.w/2, b2.y+b2.h/2); await page.mouse.down();
for(let i=1;i<=12;i++){await page.mouse.move(b2.x+b2.w/2-i*24, b2.y+b2.h/2); await page.waitForTimeout(18);}
const dragPeak = await state();
await page.mouse.up(); await page.waitForTimeout(1200);
const afterRelease = await state();
console.log('  drag peak (mid):', JSON.stringify(dragPeak));
console.log('  drag after release:', JSON.stringify(afterRelease));

await browser.close();
console.log('DONE');
})().catch(e=>{console.error('FATAL',e);process.exit(1);});

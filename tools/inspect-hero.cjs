const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1200,height:1100}});
await page.goto('http://localhost:5173/tools/hero-preview.html');await page.waitForFunction(()=>window.heroPreview?.ready);
await page.evaluate(()=>{const h=window.heroPreview;document.querySelector('#pause').click();h.character.rig.setBlink(false);h.character.cloth.visible=false;h.controls.enableDamping=false;document.querySelectorAll('header,aside,nav,footer').forEach(e=>e.style.display='none')});
for(const [label,pos,target,mask] of [
['head-mask',[.35,1.72,1.15],[0,1.64,0],true],
['head-open',[.35,1.72,1.15],[0,1.64,0],false],
['head-side',[1.25,1.68,.015],[0,1.66,0],false],
['head-side-masked',[1.25,1.68,.015],[0,1.66,0],true],
['body-front',[0,1.2,4.2],[0,.96,0],true],
['body-back',[1.3,1.5,-4],[0,.96,0],true]]){
await page.evaluate(({pos,target,mask})=>{const h=window.heroPreview;h.character.rig.setMaskVisible(mask);h.camera.position.set(...pos);h.controls.target.set(...target);h.controls.update();h.renderer.render(h.scene,h.camera)},{pos,target,mask});
await page.waitForTimeout(80);await page.screenshot({path:`art/hero/${label}.png`});}
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});

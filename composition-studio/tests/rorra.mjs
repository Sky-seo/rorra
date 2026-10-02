import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:1000},offline:true,acceptDownloads:true});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(new URL('../../Rorra.html',import.meta.url).href);
const ready=()=>page.waitForFunction(()=>window.__studio?.snapshot().loaded&&!window.__studio.snapshot().busy,null,{timeout:180000});
const snap=key=>page.evaluate(k=>window.__studio.snapshot()[k],key);

await ready();
assert.match(await page.title(),/RORRA/);
assert.equal(await page.locator('.asset-row').count(),3);
console.log('AQM',await snap('meshes'));
await page.screenshot({path:'../preview-desktop.png'});

// The Swap-only panels were removed with their modules; they must not come back.
for(const id of ['body-color-panel','head-color-panel','box-panel','packaging-panel'])assert.equal(await page.locator('#'+id).count(),0,id);

// Dispenser: metal housing + non-metal gaskets, and the finish picker applies here too.
assert.ok((await snap('finishes')).every(f=>f.role==='rubber'?f.metalness===0:f.role==='metal'&&f.metalness===1));
assert.ok((await snap('finishes')).filter(f=>f.role==='rubber').length>=5);
assert.equal(await page.locator('#finish-panel').isVisible(),true);
assert.equal(await page.locator('[data-finish]').count(),2);
assert.equal(await snap('finish'),'metal');
// The AQM CAD parks five "rorra" sketch faces ~90 mm above the lid. With them
// in, the model normalises against a 517 mm tall box and the body reads narrow.
const width=(await snap('bounds'))[0];
assert.ok(width>1.7,'AQM width '+width.toFixed(3)+' suggests the stray sketch plane is still in the bounding box');
await page.locator('[data-finish="black"]').click();
assert.equal(await snap('finish'),'black');
assert.ok((await snap('finishes')).some(f=>f.role==='coated'),'black dispenser housing');
await page.locator('[data-finish="metal"]').click();
assert.equal(await snap('finish'),'metal');

for(const name of ['Rorra DD','Rorra Shower']){
 await page.locator('.asset').filter({hasText:name}).click();await ready();
 assert.match(await page.locator('#object-name').innerText(),new RegExp(name));
 assert.equal(await page.locator('#finish-panel').isVisible(),true);
 console.log(name,await snap('meshes'));
}

// Shower: two finishes, each keeping a spray face and a center medallion.
assert.equal(await snap('finish'),'metal');
for(const [id,label,role,metalness] of [['black','Black','coated',0],['metal','Metal','metal',1]]){
 await page.locator(`[data-finish="${id}"]`).click();
 assert.equal(await snap('finish'),id);
 const finishes=await snap('finishes');
 assert.ok(finishes.some(f=>f.role===role&&f.metalness===metalness),label+' housing');
 assert.ok(finishes.some(f=>f.role==='badge'),label+' medallion');
 assert.ok(finishes.some(f=>f.role==='rubber'),label+' spray face');
 console.log('finish',id,finishes.filter(f=>f.role==='badge').map(f=>f.color).join(''));
}

// Camera timeline. A keyframe is captured only on an explicit click, so moving
// the camera before, between or after the clicks must never add one.
assert.equal(await page.locator('#timeline-play').isDisabled(),true);
const setView=async(pitch,yaw,zoom)=>{for(const [id,v] of [['pitch',pitch],['yaw',yaw],['zoom',zoom]]){await page.locator('#'+id).fill(String(v));await page.locator('#'+id).dispatchEvent('input');}};
await setView(22,-40,90);
await page.locator('#timeline-add').click();
const viewA=await snap('camera');
await setView(10,20,130);await setView(-5,60,170);   // framing around, no clicks
await page.locator('#timeline-add').click();
const viewB=await snap('camera');
await setView(40,-120,60);                            // more framing after the fact
let line=await snap('timeline');
assert.equal(line.count,2,'only the two explicit clicks may create keyframes');
assert.deepEqual(line.times,[0,2]);
assert.equal(await page.locator('.timeline-mark').count(),2);
assert.equal(await page.locator('#timeline-play').isDisabled(),false);

// Clicking a keyframe opens its easing sliders.
assert.equal(await page.locator('#timeline-ease').isVisible(),false);
await page.locator('.timeline-key-jump').first().click();
assert.equal(await page.locator('#timeline-ease').isVisible(),true);
assert.equal((await snap('timeline')).selected,0);
assert.deepEqual((await snap('camera')).map(v=>+v.toFixed(2)),viewA.map(v=>+v.toFixed(2)),'key 1 must restore the view it captured');
// The first key has nothing arriving into it; the last has nothing leaving it.
assert.equal(await page.locator('#timeline-ease-in').isDisabled(),true);
assert.equal(await page.locator('#timeline-ease-out').isDisabled(),false);
await page.locator('.timeline-key-jump').nth(1).click();
assert.equal(await page.locator('#timeline-ease-out').isDisabled(),true);
assert.equal(await page.locator('#timeline-ease-in').isDisabled(),false);

// Shorten to 1s, then compare a constant-speed move against a strongly eased one.
await page.locator('.timeline-key input').nth(1).fill('1.0');
await page.locator('.timeline-key input').nth(1).dispatchEvent('change');
assert.equal((await snap('timeline')).duration,1);
const scrubTo=async ratio=>{const box=await page.locator('#timeline-track').boundingBox();await page.mouse.click(box.x+box.width*ratio,box.y+box.height/2);};
const easeTo=async(side,value)=>{await page.locator('#timeline-ease-'+side).fill(String(value));await page.locator('#timeline-ease-'+side).dispatchEvent('input');};
await easeTo('in',0);                                  // key 2 arrival
await page.locator('.timeline-key-jump').first().click();
await easeTo('out',0);                                 // key 1 departure
await scrubTo(.25);
const linear=(await snap('timeline')).progress;
const linearCamera=await snap('camera');
assert.ok(Math.abs(linear-.25)<.02,'0% easing must move at constant speed, got '+linear);
// Key 1 is still selected; clicking it again would collapse the editor.
await easeTo('out',100);
await page.locator('.timeline-key-jump').nth(1).click();
await easeTo('in',100);
assert.deepEqual((await snap('timeline')).ease,[[.5,1],[1,.5]]);
await scrubTo(.25);
const eased=(await snap('timeline')).progress;
assert.ok(eased<linear-.05,'100% easing must still be holding near key 1 at a quarter in, got '+eased);
assert.notDeepEqual((await snap('camera')).map(v=>+v.toFixed(2)),linearCamera.map(v=>+v.toFixed(2)));

// Save video records the playback off the WebGL canvas.
assert.equal(await page.locator('#timeline-record').isDisabled(),false);
await page.locator('.timeline-key input').nth(1).fill('0.6');
await page.locator('.timeline-key input').nth(1).dispatchEvent('change');
const video=page.waitForEvent('download',{timeout:30000});
await page.locator('#timeline-record').click();
await page.waitForFunction(()=>window.__studio.snapshot().timeline.recording,null,{timeout:5000});
const file=await video;
// MP4/H.264 is preferred; older browsers fall back to WebM.
const mp4=await page.evaluate(()=>MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E'));
assert.match(file.suggestedFilename(),mp4?/camera-move\.mp4$/:/camera-move\.webm$/);
const bytes=(await (await import('node:fs/promises')).stat(await file.path())).size;
assert.ok(bytes>2000,'recorded video is only '+bytes+' bytes');
await page.waitForFunction(()=>!window.__studio.snapshot().timeline.recording,null,{timeout:15000});
assert.equal((await snap('timeline')).count,2,'recording must not add keyframes');
console.log('video',file.suggestedFilename(),bytes,'bytes');
await page.locator('.timeline-key input').nth(1).fill('1.0');
await page.locator('.timeline-key input').nth(1).dispatchEvent('change');

// Playback runs the whole move and lands exactly on the last keyframe.
await page.locator('#timeline-play').click();
assert.equal((await snap('timeline')).playing,true);
await page.waitForFunction(()=>!window.__studio.snapshot().timeline.playing,null,{timeout:15000});
line=await snap('timeline');
assert.equal(line.time,line.duration,'playback must land on the last keyframe');
assert.equal(line.count,2,'playback must not add keyframes');
assert.deepEqual((await snap('camera')).map(v=>+v.toFixed(2)),viewB.map(v=>+v.toFixed(2)),'playback must end on keyframe 2');
assert.equal(await page.evaluate(()=>window.__studio.snapshot().orbitEnabled),true,'orbit must be handed back after playback');
await page.locator('#timeline-clear').click();
assert.equal((await snap('timeline')).count,0);
assert.equal(await page.locator('#timeline-ease').isVisible(),false);

// Keys follow the camera sliders literally: Y -180° to Y 180° is a full turn,
// so half way through the move the camera sits at Y 0°, not back at -180°.
const yaw=()=>page.locator('#yaw').inputValue().then(Number);
await setView(12,-180,110);
await page.locator('#timeline-add').click();
await page.locator('#yaw').fill('180');await page.locator('#yaw').dispatchEvent('input');
await page.locator('#timeline-add').click();
assert.equal((await snap('timeline')).count,2);
await scrubTo(0);
assert.ok(Math.abs(await yaw()+180)<1,'start of the turn should be -180, got '+await yaw());
await scrubTo(.5);
assert.ok(Math.abs(await yaw())<1,'half a 360° turn should be Y 0, got '+await yaw());
await scrubTo(1);
assert.ok(Math.abs(await yaw()-180)<1,'end of the turn should be 180, got '+await yaw());
await page.locator('#timeline-clear').click();
await page.locator('#fit').click();
await page.locator('#pitch').fill('-65');await page.locator('#pitch').dispatchEvent('input');
await page.screenshot({path:'../preview-shower.png'});
await page.locator('#object-size-value').fill('150');await page.locator('#object-size-value').press('Tab');
assert.equal((await snap('scale'))[0],1.5);
await page.locator('#zoom').fill('130');await page.locator('#zoom').dispatchEvent('input');
assert.equal(await page.locator('#zoom-value').inputValue(),'130');
const download=page.waitForEvent('download');await page.locator('#capture').click();
assert.match((await download).suggestedFilename(),/composition.png$/);
await page.setViewportSize({width:390,height:844});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
await page.screenshot({path:'../preview-mobile.png',fullPage:true});
assert.deepEqual(errors,[]);
console.log('PASS: offline CAD ×3, finishes on all products, stray sketch dropped, scale, camera, PNG export, mobile, no runtime errors');
await browser.close();

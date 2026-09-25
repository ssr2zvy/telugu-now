import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GradientBackdrop } from '../frontend/src/GradientBackdrop';
import { GradientTravelMotion, GRADIENT_LAYER_SPEEDS, GRADIENT_PERIOD, GRADIENT_SETTLE_MS, gradientLayerOffset, gradientSwipeFraction, swipeChangesObservation, type GradientClock } from '../frontend/src/observation/gradient-travel';
import { useReaderSwipes } from '../frontend/src/observation/useReaderSwipes';

class Clock implements GradientClock {
  time=0; id=0; callbacks=new Map<number,(time:number)=>void>();
  now(){return this.time;}
  request(callback:(time:number)=>void){this.callbacks.set(++this.id,callback);return this.id;}
  cancel(id:number){this.callbacks.delete(id);}
  tick(ms:number){this.time+=ms;const queue=[...this.callbacks.values()];this.callbacks.clear();for(const callback of queue)callback(this.time);}
}
function setup(){const clock=new Clock();const paints:number[]=[];const motion=new GradientTravelMotion(value=>paints.push(value),clock);return {clock,paints,motion};}

test('history positions are stable on entry, forward, back, polling and phase changes',()=>{
  const {clock,paints,motion}=setup();
  motion.synchronize(37);assert.equal(motion.position,37);assert.equal(clock.callbacks.size,0);
  const original=GRADIENT_LAYER_SPEEDS.map(speed=>gradientLayerOffset(motion.position,speed));
  motion.synchronize(37);assert.equal(paints.length,1);
  motion.preview(.3);assert.equal(motion.committedPosition,37);assert.equal(motion.position,37.3);
  motion.synchronize(37);assert.equal(motion.position,37.3,'a poll cannot cancel an active drag');
  motion.synchronize(38);assert.equal(motion.position,37.3,'commit begins at the painted frame');
  clock.tick(200);assert.ok(motion.position>37.3 && motion.position<38);
  clock.tick(GRADIENT_SETTLE_MS);assert.equal(motion.position,38);
  motion.synchronize(37);clock.tick(GRADIENT_SETTLE_MS);
  assert.deepEqual(GRADIENT_LAYER_SPEEDS.map(speed=>gradientLayerOffset(motion.position,speed)),original);
  assert.equal(clock.callbacks.size,0);
});

test('canceled or failed swipes return to the committed state without advancing it',()=>{
  const {clock,motion}=setup();motion.synchronize(3);motion.preview(.6);
  motion.cancelPreview();assert.equal(motion.position,3.6);
  clock.tick(200);assert.ok(motion.position<3.6 && motion.position>3);
  clock.tick(GRADIENT_SETTLE_MS);assert.equal(motion.position,3);assert.equal(motion.committedPosition,3);
  motion.preview(-.6);motion.cancelPreview();clock.tick(GRADIENT_SETTLE_MS);assert.equal(motion.position,3);
});

test('rapid reversal starts from the current frame and obsolete animations cannot overwrite it',()=>{
  const {clock,motion}=setup();motion.synchronize(5);motion.synchronize(6);clock.tick(150);
  const painted=motion.position;
  motion.preview(-.1);assert.equal(motion.position,painted-.1);
  assert.equal(clock.callbacks.size,0);
  motion.synchronize(5);motion.cancelPreview(); // Release cleanup cannot undo an authoritative commit.
  clock.tick(GRADIENT_SETTLE_MS);assert.equal(motion.position,5);
  clock.tick(GRADIENT_SETTLE_MS);assert.equal(motion.position,5);
});

test('reduced motion and cleared history never animate a long reset or leave frames running',()=>{
  const {clock,motion}=setup();motion.synchronize(1000000);motion.preview(.5);
  motion.setReducedMotion(true);assert.equal(motion.position,1000000);assert.equal(clock.callbacks.size,0);
  motion.preview(.5);assert.equal(motion.position,1000000);
  motion.synchronize(1000001);assert.equal(motion.position,1000001);assert.equal(clock.callbacks.size,0);
  motion.setReducedMotion(false);motion.synchronize(null);motion.synchronize(0);
  assert.equal(motion.position,0);assert.equal(clock.callbacks.size,0);
  motion.synchronize(1);assert.equal(clock.callbacks.size,1);motion.dispose();assert.equal(clock.callbacks.size,0);
});

test('horizontal previews are bounded; phases and vertical disclosure do not move the landscape',()=>{
  assert.equal(gradientSwipeFraction(-100,0,400),.25);
  assert.equal(gradientSwipeFraction(100,0,400),-.25);
  assert.equal(gradientSwipeFraction(-10000,0,400),.75);
  assert.equal(gradientSwipeFraction(10000,0,400),-.75);
  assert.equal(gradientSwipeFraction(100,100,400),0);
  assert.equal(gradientSwipeFraction(0,100,400),0);
  assert.equal(swipeChangesObservation('question','next'),false);
  assert.equal(swipeChangesObservation('comparison','next'),false);
  assert.equal(swipeChangesObservation('comparison','back'),false);
  assert.equal(swipeChangesObservation('observation','back'),false);
  assert.equal(swipeChangesObservation('question','back'),true);
  assert.equal(swipeChangesObservation('observation','next'),true);
  assert.equal(swipeChangesObservation(null,'next'),true);
});

test('pattern coordinates remain bounded through long histories and tile seams are mirrored',()=>{
  for(const position of [-.75,0,1,99.999,100,100.001,1e6,1e9])for(const speed of GRADIENT_LAYER_SPEEDS){
    const offset=gradientLayerOffset(position,speed);assert.ok(offset>=0&&offset<GRADIENT_PERIOD);
  }
  // Folding the repeating tile maps either side of each boundary to the same
  // source x. Thus every y in an angled gradient has the same seam color.
  const fold=(x:number)=>{const phase=((x%2000)+2000)%2000;return phase<=1000?phase:2000-phase;};
  for(const seam of [-2000,-1000,0,1000,2000,3000])assert.ok(Math.abs(fold(seam-.0001)-fold(seam+.0001))<1e-9);
  const markup=renderToStaticMarkup(createElement(GradientBackdrop));
  assert.equal((markup.match(/<pattern /g)??[]).length,3);
  assert.equal((markup.match(/translate\(2000 0\) scale\(-1 1\)/g)??[]).length,3);
  assert.match(markup,/preserveAspectRatio="xMidYMid slice"/);
  assert.match(markup,/var\(--gradient-start\)/);
  assert.match(markup,/var\(--gradient-middle\)/);
  assert.match(markup,/var\(--gradient-end\)/);
});

test('swipe feedback follows gestures, releases into pending navigation, and cancels cleanly',()=>{
  const originalElement=globalThis.Element,originalWindow=globalThis.window;
  class Target {constructor(public control:boolean){}closest(){return this.control?this:null;}}
  Object.assign(globalThis,{Element:Target,window:{getSelection:()=>null}});
  try{
    const drags:number[]=[];const directions:string[]=[];let cancels=0;
    let handlers:ReturnType<typeof useReaderSwipes>;
    const root={hasPointerCapture:()=>false,setPointerCapture:()=>{},getBoundingClientRect:()=>({width:400})};
    function Harness(){handlers=useReaderSwipes({current:root as unknown as HTMLElement},true,'observation',direction=>directions.push(direction),()=>{},
      {onDrag:(dx,dy,width)=>drags.push(gradientSwipeFraction(dx,dy,width)),onCancel:()=>cancels++});return null;}
    renderToStaticMarkup(createElement(Harness));
    const event=(x:number,y=100,control=false)=>({isPrimary:true,button:0,pointerId:1,clientX:x,clientY:y,target:new Target(control),currentTarget:root,preventDefault(){},stopPropagation(){}} as any);
    handlers!.onPointerDownCapture(event(200));handlers!.onPointerMoveCapture(event(180));assert.equal(drags.at(-1),.05);
    handlers!.onPointerUpCapture(event(180));assert.equal(cancels,1);assert.deepEqual(directions,[]);
    handlers!.onPointerDownCapture(event(200));handlers!.onPointerMoveCapture(event(100));handlers!.onPointerUpCapture(event(100));
    assert.equal(drags.at(-1),.25);assert.deepEqual(directions,['next']);assert.equal(cancels,1,'released preview stays until navigation responds');
    handlers!.onPointerDownCapture(event(200));handlers!.onPointerMoveCapture(event(250));handlers!.onPointerCancelCapture();assert.equal(cancels,2);
    const count=drags.length;
    handlers!.onPointerDownCapture(event(200,100,true));handlers!.onPointerMoveCapture(event(180,100,true));assert.equal(drags.length,count,'short audio drags remain audio-only');
    handlers!.onPointerUpCapture(event(180,100,true));
    handlers!.onPointerDownCapture(event(200));handlers!.onPointerMoveCapture(event(200,200));handlers!.onPointerUpCapture(event(200,200));
    assert.equal(directions.at(-1),'down');assert.equal(drags.at(-1),0);
  }finally{Object.assign(globalThis,{Element:originalElement,window:originalWindow});}
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { randomAppearanceColors } from '../frontend/src/appearance';
import { DEFAULT_APPEARANCE, parseAppearance } from '../shared/appearance';
import { gradientBarrierAmount, gradientTextureKey } from '../frontend/src/observation/gradient-barrier';
import { readerNeedsLoadingDots } from '../frontend/src/observation/reader-loading';
import { questionActionBottom } from '../frontend/src/observation/question-action-placement';
import { OrganizedAppearancePage } from '../frontend/src/settings/pages/OrganizedAppearancePage';
import { LoadingSlit } from '../frontend/src/components/LoadingSlit';

const rgb = (hex: string) => [1,3,5].map(i => parseInt(hex.slice(i, i+2),16));
const luminance = (hex: string) => rgb(hex).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index]!,0);
const contrast = (a: string,b: string) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
function generator(seed: number) { return () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }; }

test('random themes span continuously generated colors with readable tinted text', () => {
  const palettes = new Set<string>();
  const hues = new Set<string>();
  let dark = 0, light = 0;
  const random = generator(12345);
  for (let sample=0; sample<1000; sample++) {
    const theme = randomAppearanceColors(random);
    palettes.add(JSON.stringify(theme));
    for (const stop of theme.gradient) {
      assert.match(stop,/^#[0-9a-f]{6}$/);
      hues.add(stop);
      assert.ok(contrast(stop,theme.foreground)>=4.5, `${stop} / ${theme.foreground}`);
    }
    const channels = rgb(theme.foreground);
    assert.ok(Math.min(...channels)>30 && Math.max(...channels)<240,theme.foreground);
    assert.ok(Math.max(...channels)-Math.min(...channels)>=10,theme.foreground);
    if (luminance(theme.gradient[0])<.2) dark++; else light++;
  }
  assert.equal(palettes.size,1000);
  assert.ok(hues.size>2500);
  assert.ok(dark>100 && light>100);
  assert.deepEqual(randomAppearanceColors(generator(9)),randomAppearanceColors(generator(9)));
});

test('gradient barrier keeps the old curve at default, changes sharpness, and remains bounded and monotone', () => {
  for (const barrier of [0,25,50,75,100]) {
    let last = 0;
    assert.equal(gradientBarrierAmount(0,barrier),0);
    assert.equal(gradientBarrierAmount(2,barrier),1);
    for (let i=0;i<=200;i++) {
      const value = gradientBarrierAmount(i/100,barrier);
      assert.ok(value>=last && value>=0 && value<=1);
      last=value;
      if (barrier===50) assert.equal(value,Math.pow(Math.min(1,i/100*.925),.42));
    }
  }
  // Higher barriers preserve more base color before the transition and reach
  // more end color afterwards, rather than shifting either endpoint's hue.
  assert.ok(gradientBarrierAmount(.1,100)<gradientBarrierAmount(.1,50));
  assert.ok(gradientBarrierAmount(.5,100)>gradientBarrierAmount(.5,50));
  assert.ok(gradientBarrierAmount(.1,0)>gradientBarrierAmount(.1,50));
});

test('saved preferences migrate independently and texture caches distinguish barriers', () => {
  const old = parseAppearance({ modificationLightness: 19, modificationColor: '#426389' });
  assert.equal(old.gradientBarrier,50);
  assert.equal(old.modificationLightness,19);
  assert.equal(old.modificationColor,'#426389');
  assert.equal(parseAppearance({ gradientBarrier: 190 }).gradientBarrier,100);
  assert.equal(parseAppearance({ gradientBarrier: -10 }).gradientBarrier,0);
  for (const value of [NaN,Infinity,'90',null]) assert.equal(parseAppearance({gradientBarrier:value}).gradientBarrier,50);
  const saved = {...DEFAULT_APPEARANCE,gradientBarrier:77};
  assert.deepEqual(parseAppearance(JSON.parse(JSON.stringify(saved))),saved);
  const key = (barrier: number) => gradientTextureKey('కం','Mandali','#34304a','#8080b0',barrier);
  assert.notEqual(key(10),key(90));
  assert.equal(key(50),key(NaN));
  assert.equal(key(100),key(200));
});

test('letter modifications expose the barrier as its own slider page', () => {
  const props = {language:'en' as const,font:null,onNavigate(){},onFont(){}};
  const menu = renderToStaticMarkup(createElement(OrganizedAppearancePage,{...props,page:'appearanceModifications'}));
  assert.match(menu,/Gradient barrier/);
  assert.doesNotMatch(menu,/Modification lightness|type="range"/);
  const control = renderToStaticMarkup(createElement(OrganizedAppearancePage,{...props,page:'appearanceGradientBarrier'}));
  assert.match(control,/type="range"/);
  assert.match(control,/value="50"/);
});

test('loader is eligible only on a blank reader and begins hidden during its delay', () => {
  const blank = {entryReady:false,textVisible:false,audioVisible:false,comparisonVisible:false,errorVisible:false,startVisible:false};
  assert.equal(readerNeedsLoadingDots(blank),true);
  for (const key of Object.keys(blank)) assert.equal(readerNeedsLoadingDots({...blank,[key]:true}),false,key);
  assert.equal(renderToStaticMarkup(createElement(LoadingSlit,{label:'Preparing',delayMs:250})), '');
  assert.match(renderToStaticMarkup(createElement(LoadingSlit,{label:'Existing immediate loader'})),/role="status"/);
});

test('record/switch slot stays put when clear and avoids expanded controls on phone and short screens', () => {
  // Collapsed default bar: retain the action at the safe footer.
  assert.equal(questionActionBottom(800,24,48,[{top:643,bottom:691}]),24);
  for (const height of [390,667,844]) for (const floor of [24,50]) for (const actionHeight of [48,56]) {
    const occupied = [
      {top:height-157,bottom:height-109},
      {top:height-108,bottom:height-76},
      {top:height-75,bottom:height-57},
    ];
    const bottom = questionActionBottom(height,floor,actionHeight,occupied);
    assert.ok(bottom>=floor);
    const top = height-bottom-actionHeight;
    assert.ok(top>=0);
    for (const rect of occupied) assert.ok(top>=rect.bottom+8 || height-bottom<=rect.top-8);
  }
  // Magnifier above: the near-bottom scrubber must not share the action slot.
  const above=[{top:728,bottom:784},{top:630,bottom:720}];
  const bottom=questionActionBottom(800,24,48,above);
  assert.ok(800-bottom<=630-8);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from 'cheerio';
import {TeluguWordText} from '../frontend/src/observation/TeluguGradientText';
import {explorationSteps} from '../frontend/src/observation/exploration-steps';
import {teluguHighlightRuns} from '../frontend/src/observation/telugu-highlighting';
import {copyOriginalReaderText} from '../frontend/src/observation/reader-hyphenation';

for (const highlight of [false, true]) test(`exploration preserves the complete sentence structure and exposes only each step (highlight=${highlight})`,()=>{
  for (const text of ['నేను, ఇక్కడ ఉన్నాను!', 'క్షేత్రంలో ఇవ్వాలనుకుంటున్నాను. నేను ఇక్కడ ఉన్నాను.', 'నేను']) {
    const render=(visibleRange?:{start:number;end:number})=>renderToStaticMarkup(createElement(TeluguWordText,{
      text, runs:highlight?teluguHighlightRuns(text):null, textures:null, visibleRange,
    }));
    const original=render();
    for (const step of explorationSteps(text)) {
      const html=render(step);const $=load(html);
      $('[data-reader-concealed]:not([data-reader-display-only])').removeAttr('aria-hidden');
      $('[data-reader-concealed]').removeAttr('data-reader-concealed');
      assert.equal($('body').html(),load(original)('body').html(),'same words, graphemes, spaces and discretionary breaks at every step');
      const visible=load(html);
      visible('[data-reader-concealed], [data-reader-display-only]').remove();
      assert.equal(visible('body').text(),step.text,'only the selected source range is exposed');
    }
    assert.equal(render(),original,'returning to the full sentence restores its original markup');
  }
});

test('copy strips hidden components and display hyphens without changing visible Telugu',()=>{
  const oldWindow=globalThis.window;
  const owner={};const removed:string[]=[];let copied='';let prevented=false;
  const fragment={querySelectorAll:(selector:string)=>{assert.ok(selector.includes('[data-reader-concealed]'));return [{remove:()=>removed.push('hidden')}];},get textContent(){return removed.length?'ఇక్కడ':'';}};
  try {
    globalThis.window={getSelection:()=>({rangeCount:1,isCollapsed:false,getRangeAt:()=>({commonAncestorContainer:owner,cloneContents:()=>fragment})})} as unknown as Window & typeof globalThis;
    copyOriginalReaderText({currentTarget:{contains:(node:unknown)=>node===owner},clipboardData:{setData:(_type:string,text:string)=>{copied=text;}},preventDefault:()=>{prevented=true;}} as unknown as Parameters<typeof copyOriginalReaderText>[0]);
    assert.equal(copied,'ఇక్కడ');assert.equal(prevented,true);
  } finally {globalThis.window=oldWindow;}
});

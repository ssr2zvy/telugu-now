import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useReaderSwipes } from '../frontend/src/observation/useReaderSwipes';

test('audio gestures never navigate or preview travel; page and button swipes still work',()=>{
  const savedElement=globalThis.Element,savedWindow=globalThis.window;
  class Target { constructor(public kind:string){} closest(selector:string){return this.kind==='audio' ? this : this.kind==='button' && selector.startsWith('button') ? this : null;} }
  Object.assign(globalThis,{Element:Target,window:{getSelection:()=>null}});
  try {
    for(const control of ['page','button','audio']) {
      const actions:string[]=[];const previews:number[]=[];let captures=0;let handlers:ReturnType<typeof useReaderSwipes>;
      const root={hasPointerCapture:()=>false,setPointerCapture:()=>{captures++;},getBoundingClientRect:()=>({width:400})};
      function Harness(){handlers=useReaderSwipes({current:root as unknown as HTMLElement},true,'comparison',direction=>actions.push(direction),()=>{},{onDrag:dx=>previews.push(dx),onCancel:()=>{}});return null;}
      renderToStaticMarkup(createElement(Harness));
      const event=(x:number,y:number)=>({isPrimary:true,button:0,pointerId:1,clientX:x,clientY:y,target:new Target(control),currentTarget:root,preventDefault(){},stopPropagation(){}} as any);
      handlers!.onPointerDownCapture(event(100,100));handlers!.onPointerMoveCapture(event(80,100));handlers!.onPointerUpCapture(event(80,100));
      assert.deepEqual(actions,[],'short drags do not navigate');
      for(const [x,y,direction] of [[0,100,'next'],[200,100,'back'],[100,200,'down'],[100,0,'up']] as const){
        handlers!.onPointerDownCapture(event(100,100));const moved=event(x,y);moved.target=new Target('page');handlers!.onPointerMoveCapture(moved);handlers!.onPointerUpCapture(moved);
        if(control==='audio'){assert.deepEqual(actions,[]);assert.deepEqual(previews,[]);assert.equal(captures,0);}else assert.equal(actions.at(-1),direction);
      }
    }
  } finally {Object.assign(globalThis,{Element:savedElement,window:savedWindow});}
});

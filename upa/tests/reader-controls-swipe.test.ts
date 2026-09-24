import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useReaderSwipes } from '../frontend/src/observation/useReaderSwipes';

test('horizontal audio drags seek; vertical audio gestures disclose; unused space still navigates',()=>{
  const savedElement=globalThis.Element,savedWindow=globalThis.window;
  class Target { constructor(public kind:string){} closest(selector:string){return (this.kind==='audio' && selector.includes('[role="slider"]')) || (this.kind==='evaluation' && selector.includes('.grammar-evaluation')) || (this.kind==='button' && selector.startsWith('button')) || (this.kind==='space' && selector.startsWith('button')) ? this : null;} }
  Object.assign(globalThis,{Element:Target,window:{getSelection:()=>null}});
  try {
    for(const control of ['page','button','space','audio','evaluation']) {
      const actions:string[]=[];const previews:number[]=[];let captures=0;let handlers:ReturnType<typeof useReaderSwipes>;
      const root={hasPointerCapture:()=>false,setPointerCapture:()=>{captures++;},getBoundingClientRect:()=>({width:400})};
      function Harness(){handlers=useReaderSwipes({current:root as unknown as HTMLElement},true,'comparison',direction=>actions.push(direction),()=>{},{onDrag:dx=>previews.push(dx),onCancel:()=>{}});return null;}
      renderToStaticMarkup(createElement(Harness));
      const event=(x:number,y:number)=>({isPrimary:true,button:0,pointerId:1,clientX:x,clientY:y,target:new Target(control),currentTarget:root,preventDefault(){},stopPropagation(){}} as any);
      handlers!.onPointerDownCapture(event(100,100));handlers!.onPointerMoveCapture(event(80,100));handlers!.onPointerUpCapture(event(80,100));
      assert.deepEqual(actions,[],'short drags do not navigate');
      for(const [x,y,direction] of [[0,100,'next'],[200,100,'back'],[100,200,'down'],[100,0,'up']] as const){
        handlers!.onPointerDownCapture(event(100,100));const moved=event(x,y);moved.target=new Target('page');handlers!.onPointerMoveCapture(moved);handlers!.onPointerUpCapture(moved);
        if(control==='audio' && (direction==='next'||direction==='back')){assert.deepEqual(actions,[]);assert.deepEqual(previews,[]);assert.equal(captures,0);}else {
          assert.equal(actions.at(-1),direction);
          if(control==='evaluation') {
            let blocked=false;
            handlers!.onClickCapture({preventDefault(){blocked=true;},stopPropagation(){}} as any);
            assert.equal(blocked,true,'swiping the switch must not toggle the answer');
          }
        }
      }
    }
  } finally {Object.assign(globalThis,{Element:savedElement,window:savedWindow});}
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { letterBoundaries, textLineHit, mergeRowBoxes, nearestLetterHit, nearestLetterOffset, selectionBoxes, caretBox, type TextLayout } from '../frontend/src/observation/keyboard-text-layout';

const layout: TextLayout = { width: 90, style: {}, end: { x: 40, y: 30, width: 0, height: 20 }, letters: [
  { start: 0, end: 2, x: 10, y: 0, width: 20, height: 20 },
  { start: 2, end: 5, x: 30, y: 0, width: 30, height: 20 },
  { start: 5, end: 6, x: 60, y: 0, width: 10, height: 20 },
  { start: 6, end: 9, x: 10, y: 30, width: 30, height: 20 },
] };

test('Telugu boundaries retain vowel signs and conjuncts as complete graphemes', () => {
  assert.deepEqual(letterBoundaries('కీ క్షై'), [0, 2, 3, 7]);
  assert.deepEqual(letterBoundaries(''), [0]);
  assert.deepEqual(letterBoundaries('క\nకీ'), [0, 1, 2, 4]);
});
test('hit testing chooses the touched line and whole-letter boundary', () => {
  assert.equal(nearestLetterOffset(layout, 23, 8), 2);
  assert.equal(nearestLetterOffset(layout, 45, 38), 9);
  assert.equal(nearestLetterOffset(layout, 1, 38), 6);
  assert.equal(nearestLetterOffset(layout, 500, 200), 9);
});
test('a multiword range paints separate lines and its handles respect line wraps', () => {
  assert.deepEqual(selectionBoxes(layout, 2, 9), [
    { x: 30, y: 0, width: 40, height: 20 }, { x: 10, y: 30, width: 30, height: 20 },
  ]);
  assert.equal(caretBox(layout, 6).y, 30);
  assert.equal(caretBox(layout, 6, true).y, 0);
});

test('overlapping font bounds cannot pull a touch at a later line start into a preceding line', () => {
  const overlapping: TextLayout = {width:200,style:{},end:{x:100,y:33,width:0,height:50},letters:[
    {start:0,end:1,x:10,y:0,width:30,height:50},
    {start:1,end:2,x:35,y:33,width:30,height:50},
  ]};
  assert.equal(nearestLetterOffset(overlapping,10,45),1);
});

test('cursor height follows font size rather than an oversized font range box', () => {
  const tall:TextLayout={...layout,style:{fontSize:'16px'}};
  assert.equal(caretBox(tall,0).height,16);
  assert.equal(caretBox(tall,9).height,16);
});

test('soft-wrap hits preserve the side of the line break that was touched', () => {
  const end=nearestLetterHit(layout,70,10),start=nearestLetterHit(layout,10,40);
  assert.deepEqual(end,{offset:6,trailing:true});assert.deepEqual(start,{offset:6,trailing:false});
  assert.equal(caretBox(layout,end.offset,end.trailing).y,0);
  assert.equal(caretBox(layout,start.offset,start.trailing).y,30);
});


test('whitespace taps use an existing row but ignore the space below the document', () => {
  assert.deepEqual(textLineHit(layout,89,10),{offset:6,trailing:true});
  assert.equal(textLineHit(layout,89,200),null);
  assert.equal(textLineHit(layout,10,-10),null);
});

test('hard breaks and empty paragraph rows keep their own cursor offsets', () => {
  const paragraphs:TextLayout={width:200,style:{fontSize:'20px'},length:5,end:{x:25,y:90,width:0,height:28},letters:[
    {start:0,end:1,x:10,y:0,width:15,height:28},
    {start:1,end:2,x:25,y:0,width:0,height:28,newline:true},
    {start:2,end:3,x:10,y:30,width:0,height:28,newline:true},
    {start:3,end:4,x:10,y:60,width:0,height:28,newline:true},
    {start:4,end:5,x:10,y:90,width:15,height:28},
  ]};
  assert.equal(textLineHit(paragraphs,180,12)?.offset,1);
  assert.equal(textLineHit(paragraphs,180,42)?.offset,2);
  assert.equal(textLineHit(paragraphs,180,72)?.offset,3);
  assert.equal(textLineHit(paragraphs,180,102)?.offset,5);
  assert.equal(caretBox(paragraphs,2,true).y,30);
  assert.equal(textLineHit(paragraphs,180,150),null);
});

test('selection fragments can extend left without losing the first glyph', () => {
  assert.deepEqual(mergeRowBoxes([
    {x:35,y:30,width:70,height:28},{x:24,y:30,width:30,height:28},
    {x:24,y:0,width:80,height:28},
  ]),[{x:24,y:0,width:80,height:28},{x:24,y:30,width:81,height:28}]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightPresets, highlightLab } from '../frontend/src/highlight-presets';
import { appearanceModificationColor } from '../frontend/src/appearance';
import { DEFAULT_APPEARANCE, parseAppearance } from '../shared/appearance';
const distance=(a:string,b:string)=>Math.hypot(...highlightLab(a).map((v,i)=>v-highlightLab(b)[i]!));
test('presets are distinct, subtle and derived from the font and palette',()=>{
  let seed=1984;
  const hex=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return '#'+(seed&0xffffff).toString(16).padStart(6,'0');};
  for(let i=0;i<500;i++){
    const theme={foreground:hex(),gradient:[hex(),hex(),hex()] as [string,string,string]};
    const presets=highlightPresets(theme);
    assert.equal(new Set(presets.map(p=>p.color)).size,4);
    for(const preset of presets){assert.notEqual(preset.color,theme.foreground);assert.ok(distance(preset.color,theme.foreground)<.065);}
    assert.ok(distance(presets[0]!.color,theme.foreground)<.025);
  }
  const first=highlightPresets(DEFAULT_APPEARANCE);
  assert.notDeepEqual(first,highlightPresets({...DEFAULT_APPEARANCE,foreground:'#82798f'}));
  assert.notDeepEqual(first,highlightPresets({...DEFAULT_APPEARANCE,gradient:['#153466','#66aa99','#ffbb99']}));
  const d=first.map(p=>distance(p.color,DEFAULT_APPEARANCE.foreground));
  assert.ok(d.every((value,i)=>!i||value>d[i-1]!));
});
test('selected preset follows theme changes and survives preference parsing; custom colors stay exact',()=>{
  for(const modificationPreset of ['near','soft','balanced','defined'] as const){
    const appearance=parseAppearance({...DEFAULT_APPEARANCE,modificationPreset});
    assert.equal(appearance.modificationPreset,modificationPreset);
    assert.equal(appearanceModificationColor(appearance),highlightPresets(appearance).find(p=>p.id===modificationPreset)!.color);
    assert.notEqual(appearanceModificationColor(appearance),appearanceModificationColor({...appearance,foreground:'#534238'}));
  }
  assert.equal(parseAppearance({}).modificationPreset,'near');
  assert.equal(appearanceModificationColor({...DEFAULT_APPEARANCE,modificationColor:'#123456'}),'#123456');
});

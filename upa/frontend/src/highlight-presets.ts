import type { AppearanceSettings } from '../../shared/appearance';

export const HIGHLIGHT_PRESETS = ['near', 'soft', 'balanced', 'defined'] as const;
export type HighlightPreset = typeof HIGHLIGHT_PRESETS[number];
type Lab = [number, number, number];
export function highlightLab(hex: string): Lab {
  const [r,g,b] = [1,3,5].map(i => {
    const c = parseInt(hex.slice(i,i+2),16)/255;
    return c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4;
  }) as Lab;
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
  const m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
  const s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
function hex([L,a,b]: Lab): string {
  const l=(L+.3963377774*a+.2158037573*b)**3;
  const m=(L-.1055613458*a-.0638541728*b)**3;
  const s=(L-.0894841775*a-1.291485548*b)**3;
  return '#'+[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s].map(v=>{
    const c=v<=.0031308?12.92*v:1.055*Math.max(0,v)**(1/2.4)-.055;
    return Math.round(Math.max(0,Math.min(1,c))*255).toString(16).padStart(2,'0');
  }).join('');
}

/** Small perceptual steps from the text color, steered by differently weighted
 * combinations of the actual background colors. Lightness stays near the text. */
export function highlightPresets(appearance: Pick<AppearanceSettings,'foreground'|'gradient'>) {
  const base=highlightLab(appearance.foreground);
  const palette=appearance.gradient.map(highlightLab);
  const weights=[[1,1,1],[3,1,1],[1,3,1],[1,1,3]];
  const amounts=[.010,.020,.032,.045];
  const used=new Set<string>([appearance.foreground.toLowerCase()]);
  return HIGHLIGHT_PRESETS.map((id,index)=>{
    const w=weights[index]!,sum=w.reduce((a,b)=>a+b,0);
    const target=[0,1,2].map(channel=>palette.reduce((a,c,i)=>a+c[channel]!*w[i]!,0)/sum) as Lab;
    let dx=target[1]-base[1],dy=target[2]-base[2];
    // Neutral palettes still get a theme-derived direction, with distinct blends.
    const angle=Math.atan2(base[2],base[1])+(index+1)*Math.PI/5;
    dx+=Math.cos(angle)*.006;dy+=Math.sin(angle)*.006;
    const length=Math.hypot(dx,dy)||1,amount=amounts[index]!;
    let color=appearance.foreground;
    for(let attempt=0;attempt<24;attempt++) {
      const rotation=attempt*Math.PI/12;
      const x=(dx*Math.cos(rotation)-dy*Math.sin(rotation))/length;
      const y=(dx*Math.sin(rotation)+dy*Math.cos(rotation))/length;
      color=hex([Math.max(.02,Math.min(.98,base[0]+Math.sign(target[0]-base[0])*.002*(index+1))),base[1]+x*amount,base[2]+y*amount]);
      if(!used.has(color))break;
    }
    used.add(color);
    return {id,color};
  });
}

import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GradientTravelMotion, gradientLayerOffset, GRADIENT_LAYER_SPEEDS, GRADIENT_PERIOD, GRADIENT_TILE_SIZE } from './observation/gradient-travel';

const TravelContext = createContext<{ motion: GradientTravelMotion; register: (svg: SVGSVGElement) => () => void } | null>(null);
const noMotion = { synchronize() {}, preview() {}, cancelPreview() {} };
export function useGradientTravel() { return useContext(TravelContext)?.motion ?? noMotion; }

export function GradientTravelProvider({ children }: { children: ReactNode }) {
  const surfaces = useRef(new Set<SVGSVGElement>());
  const [motion] = useState(() => new GradientTravelMotion(position => {
    for (const svg of surfaces.current) {
      svg.setAttribute('data-gradient-position', String(position));
      svg.querySelectorAll<SVGPatternElement>('[data-gradient-layer]').forEach((pattern, index) => {
        pattern.setAttribute('patternTransform', `translate(${-gradientLayerOffset(position, GRADIENT_LAYER_SPEEDS[index]!)} 0)`);
      });
    }
  }, {
    now: () => performance.now(),
    request: callback => requestAnimationFrame(callback),
    cancel: id => cancelAnimationFrame(id),
  }));
  const register = useCallback((svg: SVGSVGElement) => {
    surfaces.current.add(svg);
    motion.repaint();
    return () => { surfaces.current.delete(svg); };
  }, [motion]);
  useLayoutEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => motion.setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => { preference.removeEventListener('change', update); motion.dispose(); };
  }, [motion]);
  return <TravelContext.Provider value={{ motion, register }}>{children}</TravelContext.Provider>;
}

function endpoints(angle: number) {
  const radians = angle * Math.PI / 180;
  const x = Math.sin(radians), y = -Math.cos(radians);
  const length = Math.abs(x) + Math.abs(y);
  return { x1: .5 - x * length / 2, y1: .5 - y * length / 2, x2: .5 + x * length / 2, y2: .5 + y * length / 2 };
}

/** Mirror each existing gradient tile at its edge before repeating. Both sides
 * of every seam have identical color at every height, including transparent
 * overlays. Only a bounded pattern transform changes, never the palette. */
export function GradientBackdrop({ className = 'gradient-field' }: { className?: string }) {
  const context = useContext(TravelContext);
  const svg = useRef<SVGSVGElement>(null);
  const id = `reader-gradient-${useId().replace(/:/g, '')}`;
  useLayoutEffect(() => { if (svg.current) return context?.register(svg.current); }, [context?.register]);
  return <svg ref={svg} className={className} aria-hidden="true" focusable="false"
    viewBox="250 250 500 500" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id={`${id}-color-0`} {...endpoints(135)}>
        <stop offset="20%" stopColor="var(--gradient-start)"/>
        <stop offset="50%" stopColor="var(--gradient-middle)"/>
        <stop offset="80%" stopColor="var(--gradient-end)"/>
      </linearGradient>
      <linearGradient id={`${id}-color-1`} {...endpoints(65)}>
        <stop offset="20%" stopColor="var(--gradient-start)" stopOpacity="0"/>
        <stop offset="65%" stopColor="var(--gradient-start)"/>
        <stop offset="100%" stopColor="var(--gradient-start)" stopOpacity="0"/>
      </linearGradient>
      <linearGradient id={`${id}-color-2`} {...endpoints(165)}>
        <stop offset="30%" stopColor="var(--gradient-end)" stopOpacity="0"/>
        <stop offset="85%" stopColor="var(--gradient-end)"/>
      </linearGradient>
      {GRADIENT_LAYER_SPEEDS.map((_, index) => <pattern key={index} id={`${id}-tile-${index}`} data-gradient-layer={index}
        patternUnits="userSpaceOnUse" width={GRADIENT_PERIOD} height={GRADIENT_TILE_SIZE}>
        <rect width={GRADIENT_TILE_SIZE} height={GRADIENT_TILE_SIZE} fill={`url(#${id}-color-${index})`} shapeRendering="crispEdges"/>
        <rect width={GRADIENT_TILE_SIZE} height={GRADIENT_TILE_SIZE} fill={`url(#${id}-color-${index})`}
          transform={`translate(${GRADIENT_PERIOD} 0) scale(-1 1)`} shapeRendering="crispEdges"/>
      </pattern>)}
    </defs>
    {[1, .38, .45].map((opacity, index) => <rect key={index} x="250" y="250" width="500" height="500"
      fill={`url(#${id}-tile-${index})`} opacity={opacity}/>)}
  </svg>;
}

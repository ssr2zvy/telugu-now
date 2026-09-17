import './style.css';

const VIRAMA = '\u0c4d';
const SIZE = 360;
const SCALE = 2;
const FONT_SIZE = 220;
const PROFILE_SIZE = 48;
const CLEAN_RADIUS = 2 * SCALE;
const CONSONANTS = [...'కఖగఘఙచఛజఝఞటఠడఢణతథదధనపఫబభమయరఱలళవశషసహ'];

interface FontConsonant {
  consonant: string;
  bareGuide: ImageData;
  viramaForm: ImageData;
}

const fontConsonants = new Map<string, FontConsonant>();
const viramaProfile = new Float32Array(PROFILE_SIZE * PROFILE_SIZE);

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header>
    <p class="eyebrow">Noto Sans Telugu · raster experiment</p>
    <h1>Where does the base letter end?</h1>
    <p class="lede">The font is processed consonant by consonant. Each virama form is stripped of pixels not supported by its unmarked body; modified forms are then compared with that cleaned reference.</p>
  </header>
  <main>
    <section class="workbench">
      <div class="input-panel">
        <label class="text-control"><span>Input · original letter</span><input id="target" value="కీ" lang="te" aria-label="Original Telugu letter" /></label>
      </div>
      <div class="output-panel">
        <div class="output-comparison">
          <div class="canvas-frame output-canvas"><span>Output · raster reference</span><canvas id="result" width="720" height="720"></canvas></div>
          <div class="text-output"><span>Output · selectable text</span><span id="rendered-output" class="rendered-letter" lang="te">కీ</span></div>
        </div>
        <div class="legend"><span><i class="base-dot"></i>cleaned consonant body</span><span><i class="mod-dot"></i>modification</span></div>
      </div>
    </section>
    <section class="diagnostics">
      <div class="canvas-frame"><span>Cleaned base reference</span><canvas id="base" width="720" height="720"></canvas></div>
      <div class="canvas-frame"><span>Virama indicator</span><canvas id="removed" width="720" height="720"></canvas></div>
      <div class="canvas-frame"><span>Input-specific adjusted base</span><canvas id="adjusted-base" width="720" height="720"></canvas></div>
      <div class="canvas-frame"><span>Current modification</span><canvas id="modifier" width="720" height="720"></canvas></div>
      <div class="canvas-frame"><span>Current modifier overlap</span><canvas id="overlap" width="720" height="720"></canvas></div>
      <div class="canvas-frame"><span>Learned loop equation fit</span><canvas id="loop-fit" width="720" height="720"></canvas></div>
    </section>
  </main>`;

const targetInput = document.querySelector<HTMLInputElement>('#target')!;
const renderedOutput = document.querySelector<HTMLSpanElement>('#rendered-output')!;

function context(id: string): CanvasRenderingContext2D {
  return document.querySelector<HTMLCanvasElement>(`#${id}`)!.getContext('2d', { willReadFrequently: true })!;
}

function firstGrapheme(value: string): string {
  return [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(value.trim())][0]?.segment ?? 'కీ';
}

function targetConsonant(target: string): string {
  return [...target].find(character => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x0c15 && code <= 0x0c39;
  }) ?? 'క';
}

function rasterize(text: string): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * SCALE;
  canvas.height = SIZE * SCALE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.font = `${FONT_SIZE * SCALE}px "Noto Sans Telugu"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(text, 64 * SCALE, SIZE * SCALE / 2);
  return ctx.getImageData(0, 0, SIZE * SCALE, SIZE * SCALE);
}

function alphaAt(image: ImageData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 0;
  return image.data[(y * image.width + x) * 4 + 3] / 255;
}

function nearbyBaseAlpha(image: ImageData, x: number, y: number, radius: number): number {
  let maximum = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      maximum = Math.max(maximum, alphaAt(image, x + dx, y + dy));
    }
  }
  return maximum;
}

function connectedComponents(mask: Uint8Array, width: number, height: number): number[][] {
  const visited = new Uint8Array(mask.length);
  const components: number[][] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const component: number[] = [];
    const queue = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      component.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nextX = x + dx;
          const nextY = y + dy;
          if ((!dx && !dy) || nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    components.push(component);
  }
  return components;
}

function geodesicDistance(glyph: Uint8Array, seeds: Uint8Array, width: number, height: number): Uint16Array {
  const unreachable = 0xffff;
  const distance = new Uint16Array(glyph.length);
  distance.fill(unreachable);
  const queue: number[] = [];
  for (let pixel = 0; pixel < seeds.length; pixel += 1) {
    if (!glyph[pixel] || !seeds[pixel]) continue;
    distance[pixel] = 0;
    queue.push(pixel);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixel = queue[cursor];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nextX = x + dx;
        const nextY = y + dy;
        if ((!dx && !dy) || nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
        const next = nextY * width + nextX;
        const nextDistance = distance[pixel] + 1;
        if (!glyph[next] || distance[next] <= nextDistance) continue;
        distance[next] = nextDistance;
        queue.push(next);
      }
    }
  }
  return distance;
}

function maskBounds(mask: Uint8Array, width: number, height: number): { left: number; top: number; right: number; bottom: number } | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (!mask[pixel]) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return right < left ? null : { left, top, right, bottom };
}

function profileValue(x: number, y: number, bounds: NonNullable<ReturnType<typeof maskBounds>>): number {
  const normalizedX = (x - bounds.left) / Math.max(1, bounds.right - bounds.left);
  const normalizedY = (y - bounds.top) / Math.max(1, bounds.bottom - bounds.top);
  if (normalizedX < -0.08 || normalizedY < -0.08 || normalizedX > 1.08 || normalizedY > 1.08) return 0;
  const profileX = Math.max(0, Math.min(PROFILE_SIZE - 1, Math.round(normalizedX * (PROFILE_SIZE - 1))));
  const profileY = Math.max(0, Math.min(PROFILE_SIZE - 1, Math.round(normalizedY * (PROFILE_SIZE - 1))));
  return viramaProfile[profileY * PROFILE_SIZE + profileX];
}

function trainViramaProfile(entries: Iterable<FontConsonant>): void {
  const samples = new Uint16Array(viramaProfile.length);
  let entryCount = 0;
  for (const entry of entries) {
    const unsupported = new Uint8Array(entry.viramaForm.width * entry.viramaForm.height);
    for (let pixel = 0; pixel < unsupported.length; pixel += 1) {
      const viramaAlpha = entry.viramaForm.data[pixel * 4 + 3] / 255;
      const bareAlpha = entry.bareGuide.data[pixel * 4 + 3] / 255;
      unsupported[pixel] = Number(viramaAlpha >= 0.12 && bareAlpha < 0.08);
    }
    const bounds = maskBounds(unsupported, entry.viramaForm.width, entry.viramaForm.height);
    if (!bounds) continue;
    entryCount += 1;
    const occupied = new Uint8Array(viramaProfile.length);
    for (let pixel = 0; pixel < unsupported.length; pixel += 1) {
      if (!unsupported[pixel]) continue;
      const x = pixel % entry.viramaForm.width;
      const y = Math.floor(pixel / entry.viramaForm.width);
      const normalizedX = (x - bounds.left) / Math.max(1, bounds.right - bounds.left);
      const normalizedY = (y - bounds.top) / Math.max(1, bounds.bottom - bounds.top);
      const profileX = Math.round(normalizedX * (PROFILE_SIZE - 1));
      const profileY = Math.round(normalizedY * (PROFILE_SIZE - 1));
      occupied[profileY * PROFILE_SIZE + profileX] = 1;
    }
    for (let pixel = 0; pixel < occupied.length; pixel += 1) samples[pixel] += occupied[pixel];
  }
  for (let pixel = 0; pixel < viramaProfile.length; pixel += 1) {
    viramaProfile[pixel] = entryCount ? samples[pixel] / entryCount : 0;
  }
}

function keepPrincipalBase(removal: Uint8Array, glyph: Uint8Array, core: Uint8Array, width: number, height: number): void {
  const retained = new Uint8Array(glyph.length);
  for (let pixel = 0; pixel < glyph.length; pixel += 1) retained[pixel] = Number(glyph[pixel] && !removal[pixel]);
  const components = connectedComponents(retained, width, height);
  if (!components.length) return;
  const principal = components.reduce((best, component) => {
    const score = component.reduce((total, pixel) => total + 1 + core[pixel] * 8, 0);
    const bestScore = best.reduce((total, pixel) => total + 1 + core[pixel] * 8, 0);
    return score > bestScore ? component : best;
  });
  const principalPixels = new Set(principal);
  for (let pixel = 0; pixel < retained.length; pixel += 1) {
    if (retained[pixel] && !principalPixels.has(pixel)) removal[pixel] = 1;
  }
}

function extractConsonantBody(entry: FontConsonant, radius: number): { body: ImageData; removed: ImageData } {
  const body = new ImageData(entry.viramaForm.width, entry.viramaForm.height);
  const removed = new ImageData(entry.viramaForm.width, entry.viramaForm.height);
  const pixelCount = entry.viramaForm.width * entry.viramaForm.height;
  const viramaAlpha = new Float32Array(pixelCount);
  const guideSupport = new Float32Array(pixelCount);
  const glyph = new Uint8Array(pixelCount);
  const viramaSeeds = new Uint8Array(pixelCount);
  const coreSeeds = new Uint8Array(pixelCount);
  for (let y = 0; y < entry.viramaForm.height; y += 1) {
    for (let x = 0; x < entry.viramaForm.width; x += 1) {
      const pixel = y * entry.viramaForm.width + x;
      viramaAlpha[pixel] = entry.viramaForm.data[pixel * 4 + 3] / 255;
      if (viramaAlpha[pixel] < 0.08) continue;
      glyph[pixel] = 1;
      guideSupport[pixel] = nearbyBaseAlpha(entry.bareGuide, x, y, radius);
      if (guideSupport[pixel] < 0.1) viramaSeeds[pixel] = 1;
      if (guideSupport[pixel] >= 0.78) coreSeeds[pixel] = 1;
    }
  }
  const viramaDistance = geodesicDistance(glyph, viramaSeeds, entry.viramaForm.width, entry.viramaForm.height);
  const coreDistance = geodesicDistance(glyph, coreSeeds, entry.viramaForm.width, entry.viramaForm.height);
  const viramaBounds = maskBounds(viramaSeeds, entry.viramaForm.width, entry.viramaForm.height);
  const removal = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!glyph[pixel]) continue;
    const x = pixel % entry.viramaForm.width;
    const y = Math.floor(pixel / entry.viramaForm.width);
    const loopFit = viramaBounds ? profileValue(x, y, viramaBounds) : 0;
    const supportBias = guideSupport[pixel] * 7 * SCALE;
    const loopFitBonus = loopFit * 5 * SCALE;
    removal[pixel] = Number(viramaDistance[pixel] + supportBias - loopFitBonus < coreDistance[pixel]);
  }
  keepPrincipalBase(removal, glyph, coreSeeds, entry.viramaForm.width, entry.viramaForm.height);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const sourceAlpha = viramaAlpha[pixel];
    const removedAlpha = removal[pixel] ? sourceAlpha : 0;
    body.data[pixel * 4 + 3] = Math.round((sourceAlpha - removedAlpha) * 255);
    removed.data[pixel * 4 + 3] = Math.round(removedAlpha * 255);
  }
  return { body, removed };
}

function adjustBaseToInput(target: ImageData, base: ImageData): {
  adjustedBase: ImageData;
  modifier: Uint8Array;
  modifierMask: ImageData;
  overlapMask: ImageData;
} {
  const pixelCount = target.width * target.height;
  const intersection = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const targetAlpha = target.data[pixel * 4 + 3] / 255;
    const baseAlpha = base.data[pixel * 4 + 3] / 255;
    intersection[pixel] = Number(targetAlpha >= 0.08 && baseAlpha >= 0.08);
  }
  const components = connectedComponents(intersection, target.width, target.height);
  const principal = components.reduce<number[]>((best, component) => {
    const score = component.reduce((total, pixel) => total + Math.min(
      target.data[pixel * 4 + 3], base.data[pixel * 4 + 3],
    ), 0);
    const bestScore = best.reduce((total, pixel) => total + Math.min(
      target.data[pixel * 4 + 3], base.data[pixel * 4 + 3],
    ), 0);
    return score > bestScore ? component : best;
  }, []);
  const adjustedPixels = new Uint8Array(pixelCount);
  for (const pixel of principal) adjustedPixels[pixel] = 1;
  const adjustedBase = new ImageData(target.width, target.height);
  const modifier = new Uint8Array(pixelCount);
  const modifierMask = new ImageData(target.width, target.height);
  const overlapMask = new ImageData(target.width, target.height);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const targetAlpha = target.data[pixel * 4 + 3];
    if (adjustedPixels[pixel]) {
      adjustedBase.data[pixel * 4 + 3] = Math.min(targetAlpha, base.data[pixel * 4 + 3]);
      continue;
    }
    modifier[pixel] = Number(targetAlpha >= 0.08 * 255);
    if (modifier[pixel]) {
      modifierMask.data[pixel * 4 + 3] = targetAlpha;
      if (intersection[pixel]) overlapMask.data[pixel * 4 + 3] = Math.min(targetAlpha, base.data[pixel * 4 + 3]);
    }
  }
  return { adjustedBase, modifier, modifierMask, overlapMask };
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function modifierGradientDepth(modifier: Uint8Array, base: ImageData): Float32Array {
  const width = base.width;
  const height = base.height;
  const distance = new Float32Array(modifier.length);
  distance.fill(1e6);
  for (let pixel = 0; pixel < distance.length; pixel += 1) {
    if (base.data[pixel * 4 + 3] >= 0.08 * 255) distance[pixel] = 0;
  }
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (x) distance[pixel] = Math.min(distance[pixel], distance[pixel - 1] + 1);
      if (y) distance[pixel] = Math.min(distance[pixel], distance[pixel - width] + 1);
      if (x && y) distance[pixel] = Math.min(distance[pixel], distance[pixel - width - 1] + diagonal);
      if (x + 1 < width && y) distance[pixel] = Math.min(distance[pixel], distance[pixel - width + 1] + diagonal);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const pixel = y * width + x;
      if (x + 1 < width) distance[pixel] = Math.min(distance[pixel], distance[pixel + 1] + 1);
      if (y + 1 < height) distance[pixel] = Math.min(distance[pixel], distance[pixel + width] + 1);
      if (x + 1 < width && y + 1 < height) distance[pixel] = Math.min(distance[pixel], distance[pixel + width + 1] + diagonal);
      if (x && y + 1 < height) distance[pixel] = Math.min(distance[pixel], distance[pixel + width - 1] + diagonal);
    }
  }
  const depth = new Float32Array(modifier.length);
  for (const component of connectedComponents(modifier, width, height)) {
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = 0;
    for (const pixel of component) {
      minimum = Math.min(minimum, distance[pixel]);
      maximum = Math.max(maximum, distance[pixel]);
    }
    const span = Math.max(10 * SCALE, maximum - minimum);
    for (const pixel of component) depth[pixel] = smoothstep((distance[pixel] - minimum) / span);
  }
  return depth;
}

function paintMask(id: string, image: ImageData, color: [number, number, number]): void {
  const output = new ImageData(image.width, image.height);
  for (let index = 0; index < image.data.length; index += 4) {
    output.data[index] = color[0];
    output.data[index + 1] = color[1];
    output.data[index + 2] = color[2];
    output.data[index + 3] = image.data[index + 3];
  }
  context(id).putImageData(output, 0, 0);
}

function paintSelectableText(text: string, colorMap: ImageData): void {
  const texture = document.createElement('canvas');
  texture.width = colorMap.width;
  texture.height = colorMap.height;
  texture.getContext('2d')!.putImageData(colorMap, 0, 0);
  renderedOutput.textContent = text;
  renderedOutput.style.backgroundImage = `url(${texture.toDataURL('image/png')})`;
}

function render(): void {
  const target = firstGrapheme(targetInput.value);
  const consonant = targetConsonant(target);
  const entry = fontConsonants.get(consonant) ?? fontConsonants.get('క')!;
  const { body: baseMask, removed } = extractConsonantBody(entry, CLEAN_RADIUS);
  const targetMask = rasterize(target);
  const targetClassification = adjustBaseToInput(targetMask, baseMask);
  const gradientDepth = modifierGradientDepth(targetClassification.modifier, targetClassification.adjustedBase);
  const result = new ImageData(targetMask.width, targetMask.height);
  const loopFitMask = new ImageData(targetMask.width, targetMask.height);
  const currentViramaSeeds = new Uint8Array(entry.viramaForm.width * entry.viramaForm.height);
  for (let pixel = 0; pixel < currentViramaSeeds.length; pixel += 1) {
    const sourceAlpha = entry.viramaForm.data[pixel * 4 + 3] / 255;
    const guideAlpha = entry.bareGuide.data[pixel * 4 + 3] / 255;
    currentViramaSeeds[pixel] = Number(sourceAlpha >= 0.12 && guideAlpha < 0.08);
  }
  const currentBounds = maskBounds(currentViramaSeeds, entry.viramaForm.width, entry.viramaForm.height);
  if (currentBounds) {
    for (let y = 0; y < entry.viramaForm.height; y += 1) {
      for (let x = 0; x < entry.viramaForm.width; x += 1) {
        const pixel = y * entry.viramaForm.width + x;
        const sourceAlpha = entry.viramaForm.data[pixel * 4 + 3] / 255;
        loopFitMask.data[pixel * 4 + 3] = Math.round(sourceAlpha * profileValue(x, y, currentBounds) * 255);
      }
    }
  }
  for (let y = 0; y < targetMask.height; y += 1) {
    for (let x = 0; x < targetMask.width; x += 1) {
      const index = (y * targetMask.width + x) * 4;
      const targetAlpha = targetMask.data[index + 3] / 255;
      if (!targetAlpha) continue;
      const baseAlpha = alphaAt(targetClassification.adjustedBase, x, y);
      const pixel = y * targetMask.width + x;
      const modifierPixel = targetClassification.modifier[pixel] === 1;
      if (!modifierPixel && baseAlpha >= 0.08) {
        result.data[index] = 14;
        result.data[index + 1] = 19;
        result.data[index + 2] = 21;
      } else {
        const transition = Math.pow(Math.min(1, gradientDepth[pixel] * 1.85), 0.42);
        const core: [number, number, number] = [14, 19, 21];
        const grey: [number, number, number] = [202, 205, 202];
        result.data[index] = Math.round(core[0] + (grey[0] - core[0]) * transition);
        result.data[index + 1] = Math.round(core[1] + (grey[1] - core[1]) * transition);
        result.data[index + 2] = Math.round(core[2] + (grey[2] - core[2]) * transition);
      }
      result.data[index + 3] = Math.round(targetAlpha * 255);
    }
  }
  paintMask('base', baseMask, [30, 38, 42]);
  paintMask('removed', removed, [231, 91, 53]);
  paintMask('adjusted-base', targetClassification.adjustedBase, [30, 38, 42]);
  paintMask('modifier', targetClassification.modifierMask, [231, 91, 53]);
  paintMask('overlap', targetClassification.overlapMask, [231, 91, 53]);
  paintMask('loop-fit', loopFitMask, [58, 123, 118]);
  context('result').putImageData(result, 0, 0);
  paintSelectableText(target, result);
}

targetInput.addEventListener('input', render);
await document.fonts.load(`${FONT_SIZE}px "Noto Sans Telugu"`);
for (const consonant of CONSONANTS) {
  fontConsonants.set(consonant, {
    consonant,
    bareGuide: rasterize(consonant),
    viramaForm: rasterize(`${consonant}${VIRAMA}`),
  });
}
trainViramaProfile(fontConsonants.values());
render();
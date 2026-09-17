import { OBSERVATION_FONTS, type ObservationFontFamily } from '../presentation';

const VIRAMA = '\u0c4d';
const SIZE = 360;
const ANALYSIS_SCALE = 2;
const RENDER_SCALE = 1;
const FONT_SIZE = 220;
const LINE_HEIGHT = 1.2;
const PROFILE_SIZE = 48;
const RASTER_ORIGIN_X = 64;
const TEXTURE_PADDING = 3;
const CLEAN_RADIUS = 2 * ANALYSIS_SCALE;
const VOWELS = [...'అఆఇఈఉఊఋౠఌౡఎఏఐఒఓఔ'];
const CONSONANTS = [...'కఖగఘఙచఛజఝఞటఠడఢణతథదధనపఫబభమయరఱలళవశషసహ'];
const BASE_LETTERS = new Set([...VOWELS, ...CONSONANTS]);
// These consonants' inherent-"a" form has no separable checkmark stroke; that form is already their base.
const CONSONANTS_A_BASE_IS_BASE = new Set([...'టజఱలణఙఖఞబ']);
const CHECK_STRIDE_FACTOR = 3;
const CHECK_ANGLE_THRESHOLD = Math.PI * .58;
const CHECK_REGION_MARGIN = .4;
// Vattulu and other modifiers can shift a consonant's glyph; search this many pixels for the best-matching offset.
const ALIGN_SEARCH_RADIUS = Math.round(FONT_SIZE * RENDER_SCALE * .12);
const ALIGN_COARSE_STEP = 3;

interface FontEntry { bare: ImageData; virama: ImageData }
interface AlphaMask { data: Uint8ClampedArray; width: number; height: number }
interface FontModel { bases: Map<string, AlphaMask> }
export interface TeluguGradientTexture {
  url: string;
  widthEm: number;
  heightEm: number;
  leftEm: number;
  topEm: number;
}
export interface PixelBounds { left: number; top: number; width: number; height: number }

const modelCache = new Map<string, Promise<FontModel>>();
const textureCache = new Map<string, Promise<TeluguGradientTexture>>();
type CacheState = 'not-started' | 'pending' | 'loaded' | 'failed';
interface CacheEntryStatus { state: Exclude<CacheState, 'not-started'>; startedAt: number; completedAt: number | null }
const modelStatus = new Map<string, CacheEntryStatus>();
const textureStatus = new Map<string, CacheEntryStatus>();

export function hasTeluguGradientTexture(
  text: string, fontFamily: ObservationFontFamily, foreground: string, endColor: string,
): boolean {
  return textureCache.has(`${fontFamily}\0${text}\0${foreground}\0${endColor}`);
}

export interface TeluguGradientCacheSnapshot {
  models: Array<{ fontFamily: ObservationFontFamily; state: CacheState; startedAt: number | null; completedAt: number | null }>;
  textures: { total: number; pending: number; loaded: number; failed: number };
}

export function getTeluguGradientCacheSnapshot(): TeluguGradientCacheSnapshot {
  const textures = { total: textureStatus.size, pending: 0, loaded: 0, failed: 0 };
  for (const status of textureStatus.values()) textures[status.state] += 1;
  return {
    models: OBSERVATION_FONTS.map(fontFamily => {
      const status = modelStatus.get(fontFamily);
      return {
        fontFamily,
        state: status?.state ?? 'not-started',
        startedAt: status?.startedAt ?? null,
        completedAt: status?.completedAt ?? null,
      };
    }),
    textures,
  };
}

function canvasContext(width = SIZE * RENDER_SCALE, height = SIZE * RENDER_SCALE): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d', { willReadFrequently: true })!;
}

function rasterWidth(texts: readonly string[], fontFamily: string, scale: number): number {
  const context = canvasContext();
  context.font = `${FONT_SIZE * scale}px "${fontFamily}"`;
  return Math.max(SIZE * scale, ...texts.map(text => {
    const metrics = context.measureText(text);
    return Math.ceil(RASTER_ORIGIN_X * scale + Math.max(metrics.width, metrics.actualBoundingBoxRight) + TEXTURE_PADDING * scale);
  }));
}

function rasterize(text: string, fontFamily: string, scale = RENDER_SCALE, width = rasterWidth([text], fontFamily, scale)): ImageData {
  const context = canvasContext(width, SIZE * scale);
  context.font = `${FONT_SIZE * scale}px "${fontFamily}"`;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#000';
  const metrics = context.measureText(text);
  const fontSize = FONT_SIZE * scale;
  const ascent = metrics.fontBoundingBoxAscent || fontSize * .8;
  const descent = metrics.fontBoundingBoxDescent || fontSize * .2;
  const lineHeight = fontSize * LINE_HEIGHT;
  const lineTop = (SIZE * scale - lineHeight) / 2;
  const baseline = lineTop + (lineHeight - ascent - descent) / 2 + ascent;
  context.fillText(text, RASTER_ORIGIN_X * scale, baseline);
  return context.getImageData(0, 0, width, SIZE * scale);
}

export function paddedAlphaBounds(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  padding: number,
): PixelBounds | null {
  let left = width; let top = height; let right = -1; let bottom = -1;
  for (let pixel = 0; pixel < data.length; pixel += 1) if (data[pixel]) {
    const x = pixel % width; const y = Math.floor(pixel / width);
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) return null;
  left = Math.max(0, left - padding); top = Math.max(0, top - padding);
  right = Math.min(width - 1, right + padding); bottom = Math.min(height - 1, bottom + padding);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function alphaAt(image: ImageData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 0;
  return image.data[(y * image.width + x) * 4 + 3]! / 255;
}

function nearbyAlpha(image: ImageData, x: number, y: number, radius: number): number {
  let maximum = 0;
  for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
    if (dx * dx + dy * dy <= radius * radius) maximum = Math.max(maximum, alphaAt(image, x + dx, y + dy));
  }
  return maximum;
}

function components(mask: Uint8Array, width: number, height: number): number[][] {
  const seen = new Uint8Array(mask.length);
  const result: number[][] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const component: number[] = [];
    const queue = [start];
    seen[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor]!;
      component.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nextX = x + dx;
        const nextY = y + dy;
        if ((!dx && !dy) || nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    result.push(component);
  }
  return result;
}

function geodesic(mask: Uint8Array, seeds: Uint8Array, width: number, height: number): Uint16Array {
  const distance = new Uint16Array(mask.length);
  distance.fill(0xffff);
  const queue: number[] = [];
  for (let pixel = 0; pixel < seeds.length; pixel += 1) if (mask[pixel] && seeds[pixel]) {
    distance[pixel] = 0;
    queue.push(pixel);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixel = queue[cursor]!;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nextX = x + dx;
      const nextY = y + dy;
      if ((!dx && !dy) || nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      const next = nextY * width + nextX;
      if (mask[next] && distance[next]! > distance[pixel]! + 1) {
        distance[next] = distance[pixel]! + 1;
        queue.push(next);
      }
    }
  }
  return distance;
}

function bounds(mask: Uint8Array, width: number): { left: number; top: number; right: number; bottom: number } | null {
  let left = width; let top = Math.ceil(mask.length / width); let right = -1; let bottom = -1;
  for (let pixel = 0; pixel < mask.length; pixel += 1) if (mask[pixel]) {
    const x = pixel % width; const y = Math.floor(pixel / width);
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < left ? null : { left, top, right, bottom };
}

function profileValue(profile: Float32Array, x: number, y: number, box: NonNullable<ReturnType<typeof bounds>>): number {
  const normalizedX = (x - box.left) / Math.max(1, box.right - box.left);
  const normalizedY = (y - box.top) / Math.max(1, box.bottom - box.top);
  if (normalizedX < -.08 || normalizedY < -.08 || normalizedX > 1.08 || normalizedY > 1.08) return 0;
  const px = Math.max(0, Math.min(PROFILE_SIZE - 1, Math.round(normalizedX * (PROFILE_SIZE - 1))));
  const py = Math.max(0, Math.min(PROFILE_SIZE - 1, Math.round(normalizedY * (PROFILE_SIZE - 1))));
  return profile[py * PROFILE_SIZE + px]!;
}

function trainProfile(entries: Iterable<FontEntry>): Float32Array {
  const totals = new Uint16Array(PROFILE_SIZE * PROFILE_SIZE);
  let count = 0;
  for (const entry of entries) {
    const unsupported = new Uint8Array(entry.virama.width * entry.virama.height);
    for (let pixel = 0; pixel < unsupported.length; pixel += 1) unsupported[pixel] = Number(
      entry.virama.data[pixel * 4 + 3]! >= 31 && entry.bare.data[pixel * 4 + 3]! < 20,
    );
    const box = bounds(unsupported, entry.virama.width);
    if (!box) continue;
    count += 1;
    const occupied = new Uint8Array(totals.length);
    for (let pixel = 0; pixel < unsupported.length; pixel += 1) if (unsupported[pixel]) {
      const x = pixel % entry.virama.width; const y = Math.floor(pixel / entry.virama.width);
      const px = Math.round((x - box.left) / Math.max(1, box.right - box.left) * (PROFILE_SIZE - 1));
      const py = Math.round((y - box.top) / Math.max(1, box.bottom - box.top) * (PROFILE_SIZE - 1));
      occupied[py * PROFILE_SIZE + px] = 1;
    }
    for (let pixel = 0; pixel < totals.length; pixel += 1) totals[pixel]! += occupied[pixel]!;
  }
  return Float32Array.from(totals, value => count ? value / count : 0);
}

async function fontModel(fontFamily: ObservationFontFamily): Promise<FontModel> {
  let pending = modelCache.get(fontFamily);
  if (!pending) {
    const status: CacheEntryStatus = { state: 'pending', startedAt: Date.now(), completedAt: null };
    modelStatus.set(fontFamily, status);
    pending = (async () => {
      await document.fonts.load(`400 ${FONT_SIZE}px "${fontFamily}"`, `${VOWELS.join('')}${CONSONANTS.join('')}${VIRAMA}`);
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      const entries = new Map<string, FontEntry>();
      for (const consonant of CONSONANTS) {
        const virama = `${consonant}${VIRAMA}`;
        const width = rasterWidth([consonant, virama], fontFamily, ANALYSIS_SCALE);
        entries.set(consonant, {
          bare: rasterize(consonant, fontFamily, ANALYSIS_SCALE, width),
          virama: rasterize(virama, fontFamily, ANALYSIS_SCALE, width),
        });
      }
      const profile = trainProfile(entries.values());
      return {
        bases: new Map([...entries].map(([consonant, entry]) => [
          consonant,
          alphaMask(downsample(
            overlapBase(principalBase(entry, profile), checkmarkBase(entry, consonant)),
            ANALYSIS_SCALE / RENDER_SCALE,
          )),
        ])),
      };
    })().then(model => {
      status.state = 'loaded'; status.completedAt = Date.now();
      return model;
    }, error => {
      status.state = 'failed'; status.completedAt = Date.now();
      throw error;
    });
    modelCache.set(fontFamily, pending);
  }
  return pending;
}

function principalBase(entry: FontEntry, profile: Float32Array): ImageData {
  const length = entry.virama.width * entry.virama.height;
  const glyph = new Uint8Array(length); const viramaSeeds = new Uint8Array(length); const core = new Uint8Array(length);
  const support = new Float32Array(length);
  for (let y = 0; y < entry.virama.height; y += 1) for (let x = 0; x < entry.virama.width; x += 1) {
    const pixel = y * entry.virama.width + x;
    if (entry.virama.data[pixel * 4 + 3]! < 20) continue;
    glyph[pixel] = 1; support[pixel] = nearbyAlpha(entry.bare, x, y, CLEAN_RADIUS);
    if (support[pixel]! < .1) viramaSeeds[pixel] = 1;
    if (support[pixel]! >= .78) core[pixel] = 1;
  }
  const viramaDistance = geodesic(glyph, viramaSeeds, entry.virama.width, entry.virama.height);
  const coreDistance = geodesic(glyph, core, entry.virama.width, entry.virama.height);
  const box = bounds(viramaSeeds, entry.virama.width);
  const retained = new Uint8Array(length);
  for (let pixel = 0; pixel < length; pixel += 1) if (glyph[pixel]) {
    const x = pixel % entry.virama.width; const y = Math.floor(pixel / entry.virama.width);
    const loop = box ? profileValue(profile, x, y, box) : 0;
    retained[pixel] = Number(!(viramaDistance[pixel]! + support[pixel]! * 7 * ANALYSIS_SCALE - loop * 5 * ANALYSIS_SCALE < coreDistance[pixel]!));
  }
  const groups = components(retained, entry.virama.width, entry.virama.height);
  const principal = groups.reduce<number[]>((best, group) => {
    const score = (values: number[]) => values.reduce((total, pixel) => total + 1 + core[pixel]! * 8, 0);
    return score(group) > score(best) ? group : best;
  }, []);
  const result = new ImageData(entry.virama.width, entry.virama.height);
  for (const pixel of principal) result.data[pixel * 4 + 3] = entry.virama.data[pixel * 4 + 3]!;
  return result;
}

function glyphMask(image: ImageData): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = Number(image.data[pixel * 4 + 3]! >= 20);
  return mask;
}

function largestComponent(mask: Uint8Array, width: number, height: number): Uint8Array {
  const groups = components(mask, width, height);
  const largest = groups.reduce<number[]>((best, group) => group.length > best.length ? group : best, []);
  const result = new Uint8Array(mask.length);
  for (const pixel of largest) result[pixel] = 1;
  return result;
}

const CONTOUR_DIRECTIONS: Array<[number, number]> = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

// Moore-neighbor boundary trace of a single connected blob, used to find the checkmark's hook vertex.
function traceOuterContour(mask: Uint8Array, width: number, height: number): number[] {
  let start = -1;
  for (let pixel = 0; pixel < mask.length && start < 0; pixel += 1) if (mask[pixel]) start = pixel;
  if (start < 0) return [];
  const contour: number[] = [];
  let x = start % width; let y = Math.floor(start / width);
  let arrival = 6;
  const limit = mask.length * 8;
  for (let guard = 0; guard < limit; guard += 1) {
    contour.push(y * width + x);
    const from = (arrival + 1) % 8;
    let moved = false;
    for (let step = 0; step < 8; step += 1) {
      const direction = (from + step) % 8;
      const [dx, dy] = CONTOUR_DIRECTIONS[direction]!;
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) continue;
      arrival = direction; x = nx; y = ny; moved = true;
      break;
    }
    if (!moved) break;
    if (contour.length > 1 && x === start % width && y === Math.floor(start / width)) break;
  }
  return contour;
}

// Interior angle (radians) at a contour point, measured across neighbors `stride` steps away; smaller means sharper.
function interiorAngle(contour: number[], index: number, stride: number, width: number): number {
  const previous = contour[((index - stride) % contour.length + contour.length) % contour.length]!;
  const current = contour[index]!;
  const next = contour[(index + stride) % contour.length]!;
  const ax = current % width - previous % width; const ay = Math.floor(current / width) - Math.floor(previous / width);
  const bx = next % width - current % width; const by = Math.floor(next / width) - Math.floor(current / width);
  let turn = Math.atan2(by, bx) - Math.atan2(ay, ax);
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  return Math.PI - Math.abs(turn);
}

// The check's hook tip is the sharpest interior angle along the outer boundary within the glyph's lower-right region.
function findCheckVertex(contour: number[], width: number, box: { left: number; top: number; right: number; bottom: number }): number | null {
  if (contour.length < 8) return null;
  const stride = Math.max(2, Math.round(CHECK_STRIDE_FACTOR * ANALYSIS_SCALE));
  const spanX = Math.max(1, box.right - box.left); const spanY = Math.max(1, box.bottom - box.top);
  let best: number | null = null; let sharpest = CHECK_ANGLE_THRESHOLD;
  for (let index = 0; index < contour.length; index += 1) {
    const pixel = contour[index]!;
    const x = pixel % width; const y = Math.floor(pixel / width);
    const normalizedX = (x - box.left) / spanX; const normalizedY = (y - box.top) / spanY;
    if (normalizedX < CHECK_REGION_MARGIN || normalizedY < CHECK_REGION_MARGIN) continue;
    const angle = interiorAngle(contour, index, stride, width);
    if (angle < sharpest) { sharpest = angle; best = pixel; }
  }
  return best;
}

// Second base-detection stage: derives a base from the inherent-"a" glyph by removing its checkmark stroke,
// splitting the glyph at the hook vertex from its farthest (core) point via geodesic distance.
function checkmarkBase(entry: FontEntry, consonant: string): ImageData {
  if (CONSONANTS_A_BASE_IS_BASE.has(consonant)) return entry.bare;
  const { width, height } = entry.bare;
  const outer = largestComponent(glyphMask(entry.bare), width, height);
  const box = bounds(outer, width);
  const vertex = box ? findCheckVertex(traceOuterContour(outer, width, height), width, box) : null;
  if (vertex === null) return entry.bare;
  const vertexSeeds = new Uint8Array(outer.length); vertexSeeds[vertex] = 1;
  const vertexDistance = geodesic(outer, vertexSeeds, width, height);
  let farPixel = vertex; let farDistance = -1;
  for (let pixel = 0; pixel < outer.length; pixel += 1) {
    if (outer[pixel] && vertexDistance[pixel]! < 0xffff && vertexDistance[pixel]! > farDistance) {
      farDistance = vertexDistance[pixel]!; farPixel = pixel;
    }
  }
  const coreSeeds = new Uint8Array(outer.length); coreSeeds[farPixel] = 1;
  const coreDistance = geodesic(outer, coreSeeds, width, height);
  const retained = new Uint8Array(outer.length);
  for (let pixel = 0; pixel < outer.length; pixel += 1) if (outer[pixel]) {
    retained[pixel] = Number(coreDistance[pixel]! <= vertexDistance[pixel]!);
  }
  const groups = components(retained, width, height);
  const principal = groups.reduce<number[]>((best, group) => group.length > best.length ? group : best, []);
  const result = new ImageData(width, height);
  for (const pixel of principal) result.data[pixel * 4 + 3] = entry.bare.data[pixel * 4 + 3]!;
  return result;
}

// The final base reference is whatever the virama-removal pass and the checkmark-removal pass agree on.
function overlapBase(virama: ImageData, check: ImageData): ImageData {
  const length = virama.width * virama.height;
  const intersection = new Uint8Array(length);
  for (let pixel = 0; pixel < length; pixel += 1) {
    intersection[pixel] = Number(virama.data[pixel * 4 + 3]! >= 20 && check.data[pixel * 4 + 3]! >= 20);
  }
  const groups = components(intersection, virama.width, virama.height);
  const principal = groups.reduce<number[]>((best, group) => group.length > best.length ? group : best, []);
  if (!principal.length) return virama;
  const result = new ImageData(virama.width, virama.height);
  for (const pixel of principal) result.data[pixel * 4 + 3] = virama.data[pixel * 4 + 3]!;
  return result;
}

function downsample(image: ImageData, factor: number): ImageData {
  if (factor === 1) return image;
  const source = canvasContext(image.width, image.height);
  source.putImageData(image, 0, 0);
  const width = Math.round(image.width / factor);
  const height = Math.round(image.height / factor);
  const output = canvasContext(width, height);
  output.drawImage(source.canvas, 0, 0, width, height);
  return output.getImageData(0, 0, width, height);
}

function alphaMask(image: ImageData): AlphaMask {
  const data = new Uint8ClampedArray(image.width * image.height);
  for (let pixel = 0; pixel < data.length; pixel += 1) data[pixel] = image.data[pixel * 4 + 3]!;
  return { data, width: image.width, height: image.height };
}

function maskAlphaAt(mask: AlphaMask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return mask.data[y * mask.width + x]!;
}

function overlapScore(targetPixels: number[], targetWidth: number, base: AlphaMask, dx: number, dy: number): number {
  let score = 0;
  for (const pixel of targetPixels) {
    const x = pixel % targetWidth; const y = Math.floor(pixel / targetWidth);
    if (maskAlphaAt(base, x - dx, y - dy) >= 20) score += 1;
  }
  return score;
}

// Finds the translation of `base` that best matches the target's ink pattern, since modifiers like vattulu
// can shift a consonant's glyph without changing its underlying pixel shape.
function alignBase(target: ImageData, base: AlphaMask): { dx: number; dy: number } {
  const targetPixels: number[] = [];
  for (let pixel = 0; pixel < target.width * target.height; pixel += 1) if (target.data[pixel * 4 + 3]! >= 20) targetPixels.push(pixel);
  if (!targetPixels.length) return { dx: 0, dy: 0 };
  let bestDx = 0; let bestDy = 0; let bestScore = -1;
  for (let dy = -ALIGN_SEARCH_RADIUS; dy <= ALIGN_SEARCH_RADIUS; dy += ALIGN_COARSE_STEP) {
    for (let dx = -ALIGN_SEARCH_RADIUS; dx <= ALIGN_SEARCH_RADIUS; dx += ALIGN_COARSE_STEP) {
      const score = overlapScore(targetPixels, target.width, base, dx, dy);
      if (score > bestScore) { bestScore = score; bestDx = dx; bestDy = dy; }
    }
  }
  for (let dy = bestDy - ALIGN_COARSE_STEP; dy <= bestDy + ALIGN_COARSE_STEP; dy += 1) {
    for (let dx = bestDx - ALIGN_COARSE_STEP; dx <= bestDx + ALIGN_COARSE_STEP; dx += 1) {
      const score = overlapScore(targetPixels, target.width, base, dx, dy);
      if (score > bestScore) { bestScore = score; bestDx = dx; bestDy = dy; }
    }
  }
  return { dx: bestDx, dy: bestDy };
}

function adjustedBase(target: ImageData, base: AlphaMask): { image: ImageData; modifier: Uint8Array } {
  const { dx, dy } = alignBase(target, base);
  const intersection = new Uint8Array(target.width * target.height);
  for (let pixel = 0; pixel < intersection.length; pixel += 1) {
    const x = pixel % target.width; const y = Math.floor(pixel / target.width);
    intersection[pixel] = Number(target.data[pixel * 4 + 3]! >= 20 && maskAlphaAt(base, x - dx, y - dy) >= 20);
  }
  const principal = components(intersection, target.width, target.height).reduce<number[]>((best, group) => {
    const score = (values: number[]) => values.reduce((total, pixel) => {
      const x = pixel % target.width; const y = Math.floor(pixel / target.width);
      return total + Math.min(target.data[pixel * 4 + 3]!, maskAlphaAt(base, x - dx, y - dy));
    }, 0);
    return score(group) > score(best) ? group : best;
  }, []);
  const retained = new Uint8Array(intersection.length); for (const pixel of principal) retained[pixel] = 1;
  const image = new ImageData(target.width, target.height); const modifier = new Uint8Array(intersection.length);
  for (let pixel = 0; pixel < intersection.length; pixel += 1) {
    const x = pixel % target.width; const y = Math.floor(pixel / target.width);
    if (retained[pixel]) image.data[pixel * 4 + 3] = Math.min(target.data[pixel * 4 + 3]!, maskAlphaAt(base, x - dx, y - dy));
    else modifier[pixel] = Number(target.data[pixel * 4 + 3]! >= 20);
  }
  return { image, modifier };
}

function gradientDepth(modifier: Uint8Array, base: ImageData): Float32Array {
  const distance = new Float32Array(modifier.length); distance.fill(1e6);
  for (let pixel = 0; pixel < distance.length; pixel += 1) if (base.data[pixel * 4 + 3]! >= 20) distance[pixel] = 0;
  const diagonal = Math.SQRT2;
  for (let y = 0; y < base.height; y += 1) for (let x = 0; x < base.width; x += 1) {
    const pixel = y * base.width + x;
    if (x) distance[pixel] = Math.min(distance[pixel]!, distance[pixel - 1]! + 1);
    if (y) distance[pixel] = Math.min(distance[pixel]!, distance[pixel - base.width]! + 1);
    if (x && y) distance[pixel] = Math.min(distance[pixel]!, distance[pixel - base.width - 1]! + diagonal);
  }
  for (let y = base.height - 1; y >= 0; y -= 1) for (let x = base.width - 1; x >= 0; x -= 1) {
    const pixel = y * base.width + x;
    if (x + 1 < base.width) distance[pixel] = Math.min(distance[pixel]!, distance[pixel + 1]! + 1);
    if (y + 1 < base.height) distance[pixel] = Math.min(distance[pixel]!, distance[pixel + base.width]! + 1);
  }
  const result = new Float32Array(modifier.length);
  for (const group of components(modifier, base.width, base.height)) {
    let minimum = Infinity; let maximum = 0;
    for (const pixel of group) { minimum = Math.min(minimum, distance[pixel]!); maximum = Math.max(maximum, distance[pixel]!); }
    const span = Math.max(10 * RENDER_SCALE, maximum - minimum);
    // Half the previous rate so the color transition reaches full depth over roughly twice the distance.
    for (const pixel of group) result[pixel] = Math.pow(Math.min(1, ((distance[pixel]! - minimum) / span) * .925), .42);
  }
  return result;
}

function channels(color: string): [number, number, number] {
  return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number];
}

function baseLetterOf(text: string): string {
  return [...text].find(character => BASE_LETTERS.has(character)) ?? 'క';
}

function baseFor(text: string, fontFamily: ObservationFontFamily, model: FontModel): AlphaMask {
  const letter = baseLetterOf(text);
  let base = model.bases.get(letter);
  if (!base) {
    base = alphaMask(downsample(rasterize(letter, fontFamily, ANALYSIS_SCALE), ANALYSIS_SCALE / RENDER_SCALE));
    model.bases.set(letter, base);
  }
  return base;
}

export function renderTeluguGradientTexture(
  text: string, fontFamily: ObservationFontFamily, foreground: string, endColor: string,
): Promise<TeluguGradientTexture> {
  const key = `${fontFamily}\0${text}\0${foreground}\0${endColor}`;
  let pending = textureCache.get(key);
  if (!pending) {
    const status: CacheEntryStatus = { state: 'pending', startedAt: Date.now(), completedAt: null };
    textureStatus.set(key, status);
    pending = (async () => {
      const model = await fontModel(fontFamily);
      const base = baseFor(text, fontFamily, model);
      const target = rasterize(text, fontFamily);
      const classified = adjustedBase(target, base);
      const depth = gradientDepth(classified.modifier, classified.image);
      const start = channels(foreground); const end = channels(endColor);
      const painted = new ImageData(target.width, target.height);
      for (let pixel = 0; pixel < classified.modifier.length; pixel += 1) {
        const alpha = target.data[pixel * 4 + 3]!;
        if (!alpha) continue;
        const amount = classified.modifier[pixel] ? depth[pixel]! : 0;
        for (let channel = 0; channel < 3; channel += 1) painted.data[pixel * 4 + channel] = Math.round(start[channel]! + (end[channel]! - start[channel]!) * amount);
        painted.data[pixel * 4 + 3] = alpha;
      }
      const lineHeight = Math.round(FONT_SIZE * LINE_HEIGHT * RENDER_SCALE);
      const lineTop = Math.round((SIZE * RENDER_SCALE - lineHeight) / 2);
      const ink = paddedAlphaBounds(alphaMask(painted).data, painted.width, painted.height, TEXTURE_PADDING * RENDER_SCALE);
      const cropTop = Math.min(lineTop, ink?.top ?? lineTop);
      const cropBottom = Math.max(lineTop + lineHeight, ink ? ink.top + ink.height : lineTop + lineHeight);
      const crop = {
        left: ink?.left ?? RASTER_ORIGIN_X * RENDER_SCALE,
        top: cropTop,
        width: ink?.width ?? 1,
        height: cropBottom - cropTop,
      };
      const output = canvasContext(crop.width, crop.height);
      const full = canvasContext(painted.width, painted.height); full.putImageData(painted, 0, 0);
      output.drawImage(full.canvas, crop.left, crop.top, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return {
        url: output.canvas.toDataURL('image/png'),
        widthEm: crop.width / RENDER_SCALE / FONT_SIZE,
        heightEm: crop.height / RENDER_SCALE / FONT_SIZE,
        leftEm: (crop.left - RASTER_ORIGIN_X * RENDER_SCALE) / RENDER_SCALE / FONT_SIZE,
        topEm: (crop.top - lineTop) / RENDER_SCALE / FONT_SIZE,
      };
    })().then(texture => {
      status.state = 'loaded'; status.completedAt = Date.now();
      return texture;
    }, error => {
      status.state = 'failed'; status.completedAt = Date.now();
      throw error;
    });
    textureCache.set(key, pending);
  }
  return pending;
}
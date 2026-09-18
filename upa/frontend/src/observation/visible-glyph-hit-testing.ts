export type VisibleGlyphGranularity = 'word' | 'grapheme';

export interface VisibleGlyphHit {
  text: string;
  start: number;
  end: number;
  rect: DOMRect;
}

export interface VisibleGlyphHitOptions {
  root: Element;
  text: string;
  clientX: number;
  clientY: number;
  granularity: VisibleGlyphGranularity;
  hitSlopPx?: number;
  verticalHitSlopPx?: number;
  alphaThreshold?: number;
}

interface TextSegment {
  text: string;
  start: number;
  end: number;
}

let hitCanvas: HTMLCanvasElement | null = null;

function textRange(root: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let hasStart = false;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const nextOffset = offset + (node.textContent?.length ?? 0);
    if (!hasStart && start <= nextOffset) {
      range.setStart(node, Math.max(0, start - offset));
      hasStart = true;
    }
    if (hasStart && end <= nextOffset) {
      range.setEnd(node, Math.max(0, end - offset));
      return range;
    }
    offset = nextOffset;
  }

  return null;
}

function segments(text: string, granularity: VisibleGlyphGranularity): TextSegment[] {
  return [...new Intl.Segmenter('te', { granularity }).segment(text)]
    .filter(segment => granularity === 'grapheme'
      ? segment.segment.trim().length > 0
      : segment.isWordLike)
    .map(segment => ({
      text: segment.segment,
      start: segment.index,
      end: segment.index + segment.segment.length,
    }));
}

function expandedContains(rect: DOMRect, x: number, y: number, amount: number): boolean {
  return x >= rect.left - amount && x <= rect.right + amount
    && y >= rect.top - amount && y <= rect.bottom + amount;
}

function fontFor(element: Element): { font: string; lineHeight: number; direction: CanvasDirection } {
  const style = getComputedStyle(element);
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const parsedLineHeight = Number.parseFloat(style.lineHeight);
  return {
    font: `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    lineHeight: Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.2,
    direction: style.direction === 'rtl' ? 'rtl' : 'ltr',
  };
}

function visibleInkDistance(
  text: string,
  owner: Element,
  rect: DOMRect,
  clientX: number,
  clientY: number,
  hitSlopPx: number,
  verticalHitSlopPx: number,
  alphaThreshold: number,
): number | null {
  hitCanvas ??= document.createElement('canvas');
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const style = getComputedStyle(owner);
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const renderPadding = Math.max(hitSlopPx, verticalHitSlopPx, fontSize * .2);
  const width = Math.max(1, Math.ceil((rect.width + renderPadding * 2) * ratio));
  const height = Math.max(1, Math.ceil((rect.height + renderPadding * 2) * ratio));
  hitCanvas.width = width;
  hitCanvas.height = height;
  const context = hitCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  const font = fontFor(owner);
  context.scale(ratio, ratio);
  context.font = font.font;
  context.direction = font.direction;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#000';
  const metrics = context.measureText(text);
  const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || fontSize * .8;
  const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent || fontSize * .2;
  const lineHeight = Math.max(rect.height, font.lineHeight);
  const baseline = renderPadding + (lineHeight - ascent - descent) / 2 + ascent;
  context.fillText(text, renderPadding, baseline);

  const localX = Math.round((clientX - rect.left + renderPadding) * ratio);
  const localY = Math.round((clientY - rect.top + renderPadding) * ratio);
  const horizontalRadius = Math.ceil(hitSlopPx * ratio);
  const verticalRadius = Math.ceil(verticalHitSlopPx * ratio);
  const left = Math.max(0, localX - horizontalRadius);
  const top = Math.max(0, localY - verticalRadius);
  const right = Math.min(width - 1, localX + horizontalRadius);
  const bottom = Math.min(height - 1, localY + verticalRadius);
  if (right < left || bottom < top) return null;

  const pixels = context.getImageData(left, top, right - left + 1, bottom - top + 1).data;
  let nearest = Infinity;
  const sampleWidth = right - left + 1;
  for (let pixel = 0; pixel < pixels.length / 4; pixel += 1) {
    if (pixels[pixel * 4 + 3]! < alphaThreshold) continue;
    const x = left + pixel % sampleWidth;
    const y = top + Math.floor(pixel / sampleWidth);
    nearest = Math.min(nearest, Math.hypot(x - localX, y - localY) / ratio);
  }
  return Number.isFinite(nearest) ? nearest : null;
}

export function hitTestVisibleGlyph(options: VisibleGlyphHitOptions): VisibleGlyphHit | null {
  const {
    root,
    text,
    clientX,
    clientY,
    granularity,
    hitSlopPx = 2,
    verticalHitSlopPx = hitSlopPx,
    alphaThreshold = 20,
  } = options;
  const candidates: Array<VisibleGlyphHit & { distance: number }> = [];

  for (const segment of segments(text, granularity)) {
    const range = textRange(root, segment.start, segment.end);
    if (!range) continue;
    const owner = range.startContainer.parentElement ?? root;
    for (const sourceRect of range.getClientRects()) {
      const rect = new DOMRect(sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height);
      const fontSize = Number.parseFloat(getComputedStyle(owner).fontSize) || 16;
      if (!expandedContains(rect, clientX, clientY, Math.max(hitSlopPx, fontSize * .2))) continue;
      const distance = visibleInkDistance(segment.text, owner, rect, clientX, clientY, hitSlopPx, verticalHitSlopPx, alphaThreshold);
      if (distance !== null) candidates.push({ ...segment, rect, distance });
    }
  }

  candidates.sort((left, right) => left.distance - right.distance || left.start - right.start);
  const hit = candidates[0];
  return hit ? { text: hit.text, start: hit.start, end: hit.end, rect: hit.rect } : null;
}

export function visibleWordAtPoint(
  root: Element,
  text: string,
  clientX: number,
  clientY: number,
  hitSlopPx = 2,
  verticalHitSlopPx = hitSlopPx,
): VisibleGlyphHit | null {
  return hitTestVisibleGlyph({ root, text, clientX, clientY, granularity: 'word', hitSlopPx, verticalHitSlopPx });
}

export function visibleGraphemeAtPoint(root: Element, text: string, clientX: number, clientY: number): VisibleGlyphHit | null {
  return hitTestVisibleGlyph({ root, text, clientX, clientY, granularity: 'grapheme' });
}

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  buildStandaloneExportHtml,
  prepareHtmlExport,
} from '../frontend/src/export-html';
import type { EmbeddedObservationFontBundle } from '../frontend/src/font-assets';
import { OBSERVATION_FONTS } from '../frontend/src/presentation';
import type { ExportResponse, SelectionSnapshot } from '../shared/contracts';
function selection(sourceKey: string): SelectionSnapshot {
  return {
    sourceWeights: { source1: 1, source2: 1, source3: 1 },
    sourceId: 'source1',
    sourceRowCount: 12,
    sourceWeight: 1,
    sourceMass: 12,
    totalSourceMass: 72,
    sourceProbability: 12 / 72,
    sourceKey,
    complexityMetric: 'grapheme-count',
    intrinsicComplexityValue: 2,
    complexityReferenceVersion: 2,
    commonWordReduction: 0,
    complexityPercentileTarget: 0.5,
    complexityPercentileSpread: 0.25,
    derivedStandardDeviation: 0.25 / 2.326347874,
    globalPercentileStart: 6 / 72,
    globalPercentileEnd: 14 / 72,
    globalIntervalMass: 0.1,
    globalRowsAtComplexityValue: 8,
    globalPerRowComplexityMass: 0.0125,
    selectedSourceRowsAtComplexityValue: 3,
    selectedSourceNormalizationDenominator: 0.1,
    rowProbabilityWithinSource: 0.125,
    overallProbability: (12 / 72) * 0.125,
  };
}
function sampleExport(): ExportResponse {
  return {
    settings: {
      sourceWeights: { source1: 1, source2: 1, source3: 1 },
      complexityPercentileTarget: 0.5,
      complexityPercentileSpread: 0.25,
      complexityReferenceVersion: 2,
      commonWordReduction: 0,
    },
    entries: [
      {
        position: 1,
        sourceId: 'source1',
        sourceKey: 'source1-001',
        text: 'మొదటి',
        diagnostic: {
          selection: selection('source1-001'),
          cacheHit: false,
          requestStartedAt: 1,
          requestCompletedAt: 2,
          requestDurationMs: 1,
        },
      },
      {
        position: 2,
        sourceId: 'source1',
        sourceKey: 'source1-002',
        text: 'రెండవ చాలా పొడవైన పరిశీలన </script><script>globalThis.PWNED=true</script>',
        diagnostic: {
          selection: selection('source1-002'),
          cacheHit: true,
          requestStartedAt: null,
          requestCompletedAt: null,
          requestDurationMs: null,
        },
      },
    ],
  };
}
function sampleFontBundle(): EmbeddedObservationFontBundle {
  return {
    fonts: OBSERVATION_FONTS.map((family, index) => ({
      family,
      dataUrl: `data:font/woff2;base64,Zm9udC0${index}`,
      licenseText: `OFL notice for ${family}`,
    })),
  };
}
class FakeClassList {
  private readonly values = new Set<string>();
  remove(value: string): void {
    this.values.delete(value);
  }
  toggle(value: string): boolean {
    if (this.values.has(value)) {
      this.values.delete(value);
      return false;
    }
    this.values.add(value);
    return true;
  }
}
class FakeElement {
  hidden = true;
  src = '';
  pause(): void {}
  load(): void {}
  removeAttribute(): void {}
  textContent = '';
  innerHTML = '';
  disabled = false;
  clientWidth = 500;
  clientHeight = 500;
  scrollWidth = 420;
  scrollHeight = 120;
  readonly style: Record<string, string> = {};
  readonly classList = new FakeClassList();
  readonly listeners = new Map<
    string,
    (event: { preventDefault: () => void; stopPropagation: () => void }) => void
  >();
  addEventListener(
    name: string,
    listener: (event: { preventDefault: () => void; stopPropagation: () => void }) => void,
  ): void {
    this.listeners.set(name, listener);
  }
  click(): void {
    this.listeners.get('click')?.({
      preventDefault() {},
      stopPropagation() {},
    });
  }
  getBoundingClientRect(): { width: number; height: number } {
    return { width: this.clientWidth, height: this.clientHeight };
  }
}
async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}
test('HTML export embeds all ten fonts, licenses, and no runtime network dependencies', () => {
  const html = buildStandaloneExportHtml(sampleExport(), sampleFontBundle());
  assert.match(html, /^<!doctype html>/i);
  assert.equal((html.match(/@font-face/g) ?? []).length, 10);
  for (const family of OBSERVATION_FONTS) {
    assert.ok(html.includes(`font-family:"${family}"`));
    assert.ok(html.includes(`OFL notice for ${family}`));
  }
  assert.equal(/<script[^>]+src=/i.test(html), false);
  assert.equal(/<link[^>]+href=/i.test(html), false);
  assert.equal(/\bfetch\s*\(/.test(html), false);
  assert.equal(/\bXMLHttpRequest\b/.test(html), false);
  assert.doesNotMatch(html, /https?:\/\/fonts\.googleapis\.com/);
  assert.doesNotMatch(html, /https?:\/\/fonts\.gstatic\.com/);
  assert.equal(html.includes('</script><script>globalThis.PWNED=true</script>'), false);
  assert.ok(
    html.includes('\\u003c/script>\\u003cscript>globalThis.PWNED=true\\u003c/script>'),
  );
});
test('HTML export uses shared viewer presentation and sectioned diagnostics', () => {
  const html = buildStandaloneExportHtml(sampleExport(), sampleFontBundle());
  assert.match(html, /const PRESENTATION=/);
  assert.match(html, /function preferredSize\(/);
  assert.match(html, /function chooseFont\(/);
  assert.match(html, /function fitActive\(/);
  assert.match(html, /document\.fonts\.load/);
  assert.match(html, /window\.addEventListener\('resize'/);
  assert.match(html, /<div id="diagnostic-body" class="diagnostic-sections"><\/div>/);
  assert.match(html, /function sourceInfoRows\(/);
  assert.match(html, /function complexityInfoRows\(/);
  assert.match(html, /function globalInfoRows\(/);
  assert.equal(html.includes('<pre id="diagnostic"'), false);
});
test('shared standalone viewer rerolls on activation but not diagnostic toggles or resize', async () => {
  const html = buildStandaloneExportHtml(sampleExport(), sampleFontBundle());
  const match = html.match(/<script>(const DATA=[\s\S]*?)<\/script>\s*<\/body>/i);
  assert.ok(match?.[1]);
  const ids = [
    'audio',
    'viewer',
    'text-wrap',
    'text',
    'back',
    'next',
    'position',
    'diagnostic',
    'diagnostic-body',
    'info',
  ];
  const elements = Object.fromEntries(
    ids.map((id) => [id, new FakeElement()]),
  ) as Record<string, FakeElement>;
  let fontLoadCount = 0;
  const document = {
    fonts: {
      load: async () => {
        fontLoadCount += 1;
        return [];
      },
    },
    getElementById(id: string): FakeElement {
      const element = elements[id];
      if (!element) throw new Error(`unexpected element id ${id}`);
      return element;
    },
  };
  const windowListeners = new Map<string, () => void>();
  const window = {
    addEventListener(name: string, listener: () => void) {
      windowListeners.set(name, listener);
    },
    requestAnimationFrame(callback: () => void) {
      callback();
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout(callback: () => void) {
      callback();
      return 1;
    },
  };
  const randomValues = [0, 0.5, 0.999999];
  let randomCallCount = 0;
  const customMath = Object.create(Math) as Math;
  customMath.random = () => {
    const value = randomValues[randomCallCount] ?? 0;
    randomCallCount += 1;
    return value;
  };
  vm.runInNewContext(
    match[1],
    {
      document,
      window,
      Math: customMath,
      Date,
      JSON,
      Array,
      Number,
      String,
      Object,
      Promise,
    },
    { timeout: 1_000 },
  );
  await settle();
  assert.equal(elements.text!.textContent, 'మొదటి');
  assert.match(elements.text!.style.fontFamily ?? '', /Noto Sans Telugu/);
  assert.equal(randomCallCount, 1);
  assert.equal(fontLoadCount, 1);
  elements.info!.click();
  elements.info!.click();
  windowListeners.get('resize')?.();
  assert.equal(randomCallCount, 1);
  assert.equal(fontLoadCount, 1);
  elements.next!.click();
  await settle();
  assert.match(elements.text!.style.fontFamily ?? '', /Peddana/);
  assert.equal(randomCallCount, 2);
  assert.equal(fontLoadCount, 2);
  elements.back!.click();
  await settle();
  assert.match(elements.text!.style.fontFamily ?? '', /Tenali Ramakrishna/);
  assert.equal(randomCallCount, 3);
  assert.equal(fontLoadCount, 3);
});
test('prepared HTML artifact resolves local fonts and audio before becoming downloadable', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('/licenses/')) {
      return new Response('OFL TEST', { status: 200 });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as typeof fetch;
  try {
    const prepared = await prepareHtmlExport(sampleExport());
    assert.equal(prepared.format, 'html');
    assert.equal(prepared.entryCount, 2);
    assert.equal(prepared.fileName, 'telugu-export-2.html');
    assert.equal(prepared.blob.type, 'text/html;charset=utf-8');
    const html = await prepared.blob.text();
    assert.equal((html.match(/@font-face/g) ?? []).length, 10);
    assert.equal(requested.length, 20);
    assert.ok(requested.every((url) => url.startsWith('/fonts/')));
    assert.equal(/\bfetch\s*\(/.test(html), false);
    const result = sampleExport();
    result.entries.forEach(entry => { entry.audio = { url: '/api/audio/test.wav', mimeType: 'audio/wav', durationSeconds: 1 }; });
    const audioArtifact = await prepareHtmlExport(result);
    const audioHtml = await audioArtifact.blob.text();
    assert.match(audioHtml, /data:audio\/wav;base64,AQID/);
    assert.doesNotMatch(audioHtml, /\/api\/audio\//);
    assert.match(audioHtml, /<audio id="audio" controls="controls"/);
    assert.equal(requested.filter(url => url.startsWith('/api/audio/')).length, 1);
    assert.equal(result.entries[0]!.audio!.url, '/api/audio/test.wav');
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    await assert.rejects(prepareHtmlExport(result));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

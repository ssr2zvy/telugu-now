import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { buildStandaloneExportHtml } from '../frontend/src/export-html';
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
    wordCount: 2,
    complexityReferenceVersion: 1,
    complexityPercentileTarget: 0.5,
    complexityPercentileSpread: 0.25,
    derivedStandardDeviation: 0.25 / 2.326347874,
    globalPercentileStart: 6 / 72,
    globalPercentileEnd: 14 / 72,
    globalIntervalMass: 0.1,
    globalRowsAtWordCount: 8,
    globalPerRowComplexityMass: 0.0125,
    selectedSourceRowsAtWordCount: 3,
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
      complexityReferenceVersion: 1,
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
        text: 'రెండవ </script><script>globalThis.PWNED=true</script>',
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

  contains(value: string): boolean {
    return this.values.has(value);
  }
}

class FakeElement {
  textContent = '';
  disabled = false;
  readonly classList = new FakeClassList();
  readonly listeners = new Map<string, () => void>();

  addEventListener(name: string, listener: () => void): void {
    this.listeners.set(name, listener);
  }

  click(): void {
    this.listeners.get('click')?.();
  }
}

test('standalone export is self-contained and escapes embedded source text from the script context', () => {
  const html = buildStandaloneExportHtml(sampleExport());
  assert.match(html, /^<!doctype html>/i);
  assert.equal(/<script[^>]+src=/i.test(html), false);
  assert.equal(/<link[^>]+href=/i.test(html), false);
  assert.equal(/\bfetch\s*\(/.test(html), false);
  assert.equal(/\bXMLHttpRequest\b/.test(html), false);
  assert.equal(/https?:\/\//i.test(html), false);
  assert.equal(html.includes('</script><script>globalThis.PWNED=true</script>'), false);
  assert.ok(html.includes('\\u003c/script>\\u003cscript>globalThis.PWNED=true\\u003c/script>'));
});

test('standalone export JavaScript can browse only its embedded entries and toggle diagnostics', () => {
  const html = buildStandaloneExportHtml(sampleExport());
  const match = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/i);
  assert.ok(match?.[1]);

  const ids = ['text', 'back', 'next', 'position', 'diagnostic', 'info'];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()])) as Record<string, FakeElement>;
  const document = {
    getElementById(id: string): FakeElement {
      const element = elements[id];
      if (!element) throw new Error(`unexpected element id ${id}`);
      return element;
    },
  };

  const sandbox = { document, JSON };
  vm.runInNewContext(match[1], sandbox, { timeout: 1_000 });

  assert.equal(elements.text.textContent, 'మొదటి');
  assert.equal(elements.position.textContent, '1 / 2');
  assert.equal(elements.back.disabled, true);
  assert.equal(elements.next.disabled, false);
  assert.equal(elements.diagnostic.classList.contains('visible'), false);

  elements.info.click();
  assert.equal(elements.diagnostic.classList.contains('visible'), true);
  elements.info.click();
  assert.equal(elements.diagnostic.classList.contains('visible'), false);

  elements.next.click();
  assert.equal(elements.text.textContent, 'రెండవ </script><script>globalThis.PWNED=true</script>');
  assert.equal(elements.position.textContent, '2 / 2');
  assert.equal(elements.back.disabled, false);
  assert.equal(elements.next.disabled, true);
  assert.match(elements.diagnostic.textContent, /source1-002/);

  // A disabled/end-state button has no path beyond the embedded two-entry sequence.
  elements.next.click();
  assert.equal(elements.position.textContent, '2 / 2');
  elements.back.click();
  assert.equal(elements.position.textContent, '1 / 2');
});

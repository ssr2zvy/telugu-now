import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEpubBytes,
  prepareEpubExport,
} from '../frontend/src/export-epub';
import {
  OBSERVATION_FONT_ASSETS,
  type ObservationFontBundle,
} from '../frontend/src/font-assets';
import type {
  ExportResponse,
  SelectionSnapshot,
} from '../shared/contracts';
interface ParsedStoredZipEntry {
  name: string;
  method: number;
  data: Uint8Array;
}
function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}
function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}
function parseStoredZip(bytes: Uint8Array): ParsedStoredZipEntry[] {
  const entries: ParsedStoredZipEntry[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const signature = readUint32(view, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    assert.equal(
      signature,
      0x04034b50,
      `invalid local ZIP header at ${offset}`,
    );
    const method = readUint16(view, offset + 8);
    const compressedSize = readUint32(view, offset + 18);
    const uncompressedSize = readUint32(view, offset + 22);
    const nameLength = readUint16(view, offset + 26);
    const extraLength = readUint16(view, offset + 28);
    assert.equal(method, 0);
    assert.equal(compressedSize, uncompressedSize);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = decoder.decode(
      bytes.subarray(nameStart, nameStart + nameLength),
    );
    entries.push({
      name,
      method,
      data: bytes.slice(dataStart, dataEnd),
    });
    offset = dataEnd;
  }
  return entries;
}
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
        text: 'రెండవ పరిశీలన',
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
function sampleFontBundle(): ObservationFontBundle {
  return {
    fonts: OBSERVATION_FONT_ASSETS.map((asset, index) => ({
      family: asset.family,
      fileName: asset.fileName,
      licenseFileName: asset.licenseFileName,
      bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32, index]),
      licenseText: `OFL notice for ${asset.family}`,
    })),
  };
}
function text(entry: ParsedStoredZipEntry): string {
  return new TextDecoder().decode(entry.data);
}
test('EPUB is a real stored ZIP with mimetype first and uncompressed', () => {
  const bytes = buildEpubBytes(
    sampleExport(),
    sampleFontBundle(),
    {
      identifier: 'urn:test:telugu-now',
      modified: '2026-09-06T00:00:00Z',
    },
  );
  const entries = parseStoredZip(bytes);
  assert.equal(entries[0]?.name, 'mimetype');
  assert.equal(entries[0]?.method, 0);
  assert.equal(text(entries[0]!), 'application/epub+zip');
  assert.equal(entries[1]?.name, 'META-INF/container.xml');
});
test('EPUB contains the complete scripted viewer, data, fonts, and licenses', () => {
  const result = sampleExport();
  const bytes = buildEpubBytes(
    result,
    sampleFontBundle(),
    {
      identifier: 'urn:test:telugu-now',
      modified: '2026-09-06T00:00:00Z',
    },
  );
  const entries = parseStoredZip(bytes);
  const byName = new Map(
    entries.map((entry) => [entry.name, entry]),
  );
  for (const required of [
    'mimetype',
    'META-INF/container.xml',
    'EPUB/package.opf',
    'EPUB/nav.xhtml',
    'EPUB/viewer.xhtml',
    'EPUB/viewer.css',
    'EPUB/viewer.js',
    'EPUB/data.json',
  ]) {
    assert.ok(
      byName.has(required),
      `${required} should exist`,
    );
  }
  const containerXml = text(
    byName.get('META-INF/container.xml')!,
  );
  assert.match(
    containerXml,
    /full-path="EPUB\/package\.opf"/,
  );
  const packageOpf = text(
    byName.get('EPUB/package.opf')!,
  );
  assert.match(packageOpf, /version="3\.0"/);
  assert.match(packageOpf, /properties="nav"/);
  assert.match(packageOpf, /properties="scripted"/);
  assert.match(packageOpf, /<itemref idref="viewer"\/>/);
  const viewerXhtml = text(
    byName.get('EPUB/viewer.xhtml')!,
  );
  assert.match(
    viewerXhtml,
    /xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/,
  );
  assert.match(viewerXhtml, /href="viewer\.css"/);
  assert.match(viewerXhtml, /src="viewer\.js"/);
  assert.match(viewerXhtml, /id="diagnostic-body"/);
  const viewerScript = text(
    byName.get('EPUB/viewer.js')!,
  );
  assert.match(viewerScript, /const PRESENTATION=/);
  assert.match(viewerScript, /function chooseFont\(/);
  assert.match(viewerScript, /function preferredSize\(/);
  assert.match(viewerScript, /function fitActive\(/);
  assert.match(viewerScript, /document\.fonts\.load/);
  assert.match(
    viewerScript,
    /window\.addEventListener\('resize'/,
  );
  assert.equal(/\bfetch\s*\(/.test(viewerScript), false);
  assert.equal(/\bXMLHttpRequest\b/.test(viewerScript), false);
  assert.deepEqual(
    JSON.parse(
      text(byName.get('EPUB/data.json')!),
    ),
    result,
  );
  for (const asset of OBSERVATION_FONT_ASSETS) {
    const fontName =
      `EPUB/fonts/${asset.fileName}`;
    const licenseName =
      `EPUB/licenses/${asset.licenseFileName}`;
    assert.ok(byName.has(fontName));
    assert.ok(byName.has(licenseName));
    assert.match(
      packageOpf,
      new RegExp(
        asset.fileName.replace('.', '\\.'),
      ),
    );
    assert.match(
      packageOpf,
      new RegExp(
        asset.licenseFileName.replace('.', '\\.'),
      ),
    );
  }
});
test('EPUB viewer CSS uses packaged relative fonts rather than remote or data URLs', () => {
  const bytes = buildEpubBytes(
    sampleExport(),
    sampleFontBundle(),
    {
      identifier: 'urn:test:telugu-now',
      modified: '2026-09-06T00:00:00Z',
    },
  );
  const byName = new Map(
    parseStoredZip(bytes).map(
      (entry) => [entry.name, entry],
    ),
  );
  const css = text(
    byName.get('EPUB/viewer.css')!,
  );
  assert.equal(
    (css.match(/@font-face/g) ?? []).length,
    10,
  );
  assert.equal(
    css.includes('data:font/woff2'),
    false,
  );
  assert.equal(
    /https?:\/\//.test(css),
    false,
  );
  for (const asset of OBSERVATION_FONT_ASSETS) {
    assert.ok(
      css.includes(
        `fonts/${asset.fileName}`,
      ),
    );
  }
});
test('prepared EPUB resolves only local font assets and exposes one downloadable epub blob', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
  ) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('/licenses/')) {
      return new Response(
        'OFL TEST',
        { status: 200 },
      );
    }
    return new Response(
      new Uint8Array([
        0x77,
        0x4f,
        0x46,
        0x32,
        1,
      ]),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const prepared =
      await prepareEpubExport(
        sampleExport(),
      );
    assert.equal(
      prepared.format,
      'epub',
    );
    assert.equal(
      prepared.entryCount,
      2,
    );
    assert.equal(
      prepared.fileName,
      'telugu-export-2.epub',
    );
    assert.equal(
      prepared.blob.type,
      'application/epub+zip',
    );
    assert.equal(
      requested.length,
      20,
    );
    assert.ok(
      requested.every(
        (url) =>
          url.startsWith('/fonts/'),
      ),
    );
    const bytes =
      new Uint8Array(
        await prepared.blob.arrayBuffer(),
      );
    const entries =
      parseStoredZip(bytes);
    assert.equal(
      entries[0]?.name,
      'mimetype',
    );
  } finally {
    globalThis.fetch =
      originalFetch;
  }
});

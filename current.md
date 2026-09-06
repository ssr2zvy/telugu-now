frontend/src/export-epub.ts

import type { ExportResponse } from '../../shared/contracts';
import type { PreparedExportArtifact } from './export-artifact';
import {
  OBSERVATION_FONT_ASSETS,
  loadObservationFontBundle,
  observationFontFaceCss,
  type ObservationFontBundle,
} from './font-assets';
import {
  buildStandaloneViewerCss,
  buildStandaloneViewerMarkup,
  buildStandaloneViewerScript,
} from './export-viewer';
import { createStoredZip, type StoredZipEntry } from './zip';
export interface EpubBuildOptions {
  identifier?: string;
  modified?: string;
}
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function makeIdentifier(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `urn:uuid:${crypto.randomUUID()}`;
  }
  return `urn:telugu-now:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
function epubModifiedNow(): string {
  return new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
}
function buildContainerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}
function buildNavXhtml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="te" xml:lang="te">
<head>
  <meta charset="utf-8" />
  <title>తెలుగు</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>తెలుగు</h1>
    <ol>
      <li><a href="viewer.xhtml">తెలుగు</a></li>
    </ol>
  </nav>
  <nav epub:type="landmarks">
    <h2>Landmarks</h2>
    <ol>
      <li><a epub:type="bodymatter" href="viewer.xhtml">తెలుగు</a></li>
    </ol>
  </nav>
</body>
</html>`;
}
function buildViewerXhtml(): string {
  const markup =
    buildStandaloneViewerMarkup();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="te" xml:lang="te">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>తెలుగు</title>
  <link rel="stylesheet" type="text/css" href="viewer.css" />
</head>
<body>
${markup}
<script type="text/javascript" src="viewer.js"></script>
</body>
</html>`;
}
function buildPackageOpf(
  identifier: string,
  modified: string,
  fontBundle: ObservationFontBundle,
): string {
  const fontItems =
    fontBundle.fonts
      .map(
        (font, index) =>
          `    <item id="font-${index + 1}" href="fonts/${xmlEscape(font.fileName)}" media-type="font/woff2"/>`,
      )
      .join('\n');
  const licenseItems =
    fontBundle.fonts
      .map(
        (font, index) =>
          `    <item id="font-license-${index + 1}" href="licenses/${xmlEscape(font.licenseFileName)}" media-type="text/plain"/>`,
      )
      .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="te" prefix="ibooks: http://vocabulary.itunes.apple.com/rdf/ibooks/vocabulary-extensions-1.0/">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${xmlEscape(identifier)}</dc:identifier>
    <dc:title>తెలుగు</dc:title>
    <dc:language>te</dc:language>
    <meta property="dcterms:modified">${xmlEscape(modified)}</meta>
    <meta property="ibooks:specified-fonts">true</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="viewer" href="viewer.xhtml" media-type="application/xhtml+xml" properties="scripted"/>
    <item id="viewer-css" href="viewer.css" media-type="text/css"/>
    <item id="viewer-js" href="viewer.js" media-type="application/javascript"/>
    <item id="export-data" href="data.json" media-type="application/json"/>
${fontItems}
${licenseItems}
  </manifest>
  <spine>
    <itemref idref="viewer"/>
  </spine>
</package>`;
}
function relativeFontCss(
  fontBundle: ObservationFontBundle,
): string {
  return observationFontFaceCss(
    fontBundle.fonts.map(
      (font) => ({
        family: font.family,
        source: `fonts/${font.fileName}`,
      }),
    ),
  );
}
export function buildEpubBytes(
  result: ExportResponse,
  fontBundle: ObservationFontBundle,
  options: EpubBuildOptions = {},
): Uint8Array {
  if (
    fontBundle.fonts.length !==
    OBSERVATION_FONT_ASSETS.length
  ) {
    throw new Error(
      'EPUB font bundle must contain the complete observation font collection.',
    );
  }
  const identifier =
    options.identifier ??
    makeIdentifier();
  const modified =
    options.modified ??
    epubModifiedNow();
  const viewerCss =
    buildStandaloneViewerCss(
      relativeFontCss(
        fontBundle,
      ),
    );
  const viewerScript =
    buildStandaloneViewerScript(
      result,
    );
  const viewerXhtml =
    buildViewerXhtml();
  const navXhtml =
    buildNavXhtml();
  const packageOpf =
    buildPackageOpf(
      identifier,
      modified,
      fontBundle,
    );
  const entries:
    StoredZipEntry[] = [
      {
        name: 'mimetype',
        data:
          'application/epub+zip',
      },
      {
        name:
          'META-INF/container.xml',
        data:
          buildContainerXml(),
      },
      {
        name:
          'EPUB/package.opf',
        data:
          packageOpf,
      },
      {
        name:
          'EPUB/nav.xhtml',
        data:
          navXhtml,
      },
      {
        name:
          'EPUB/viewer.xhtml',
        data:
          viewerXhtml,
      },
      {
        name:
          'EPUB/viewer.css',
        data:
          viewerCss,
      },
      {
        name:
          'EPUB/viewer.js',
        data:
          viewerScript,
      },
      {
        name:
          'EPUB/data.json',
        data:
          JSON.stringify(result),
      },
    ];
  for (
    const font
    of fontBundle.fonts
  ) {
    entries.push(
      {
        name:
          `EPUB/fonts/${font.fileName}`,
        data:
          font.bytes,
      },
      {
        name:
          `EPUB/licenses/${font.licenseFileName}`,
        data:
          font.licenseText,
      },
    );
  }
  return createStoredZip(
    entries,
  );
}
export async function prepareEpubExport(
  result: ExportResponse,
): Promise<PreparedExportArtifact> {
  const fontBundle =
    await loadObservationFontBundle();
  const bytes =
    buildEpubBytes(
      result,
      fontBundle,
    );
  return {
    format: 'epub',
    blob: new Blob(
      [
        bytes.buffer
          as ArrayBuffer,
      ],
      {
        type:
          'application/epub+zip',
      },
    ),
    fileName:
      `telugu-export-${result.entries.length}.epub`,
    entryCount:
      result.entries.length,
  };
}

tests/export-epub.test.ts

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
function readUint16(
  view: DataView,
  offset: number,
): number {
  return view.getUint16(
    offset,
    true,
  );
}
function readUint32(
  view: DataView,
  offset: number,
): number {
  return view.getUint32(
    offset,
    true,
  );
}
function parseStoredZip(
  bytes: Uint8Array,
): ParsedStoredZipEntry[] {
  const entries:
    ParsedStoredZipEntry[] = [];
  const view =
    new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
  const decoder =
    new TextDecoder();
  let offset = 0;
  while (
    offset + 4 <=
    bytes.length
  ) {
    const signature =
      readUint32(
        view,
        offset,
      );
    if (
      signature ===
        0x02014b50 ||
      signature ===
        0x06054b50
    ) {
      break;
    }
    assert.equal(
      signature,
      0x04034b50,
      `invalid local ZIP header at ${offset}`,
    );
    const method =
      readUint16(
        view,
        offset + 8,
      );
    const compressedSize =
      readUint32(
        view,
        offset + 18,
      );
    const uncompressedSize =
      readUint32(
        view,
        offset + 22,
      );
    const nameLength =
      readUint16(
        view,
        offset + 26,
      );
    const extraLength =
      readUint16(
        view,
        offset + 28,
      );
    assert.equal(
      method,
      0,
    );
    assert.equal(
      compressedSize,
      uncompressedSize,
    );
    const nameStart =
      offset + 30;
    const dataStart =
      nameStart +
      nameLength +
      extraLength;
    const dataEnd =
      dataStart +
      compressedSize;
    const name =
      decoder.decode(
        bytes.subarray(
          nameStart,
          nameStart +
            nameLength,
        ),
      );
    entries.push({
      name,
      method,
      data:
        bytes.slice(
          dataStart,
          dataEnd,
        ),
    });
    offset =
      dataEnd;
  }
  return entries;
}
function selection(
  sourceKey: string,
): SelectionSnapshot {
  return {
    sourceWeights: {
      source1: 1,
      source2: 1,
      source3: 1,
    },
    sourceId:
      'source1',
    sourceRowCount:
      12,
    sourceWeight:
      1,
    sourceMass:
      12,
    totalSourceMass:
      72,
    sourceProbability:
      12 / 72,
    sourceKey,
    wordCount:
      2,
    complexityReferenceVersion:
      1,
    complexityPercentileTarget:
      0.5,
    complexityPercentileSpread:
      0.25,
    derivedStandardDeviation:
      0.25 /
      2.326347874,
    globalPercentileStart:
      6 / 72,
    globalPercentileEnd:
      14 / 72,
    globalIntervalMass:
      0.1,
    globalRowsAtWordCount:
      8,
    globalPerRowComplexityMass:
      0.0125,
    selectedSourceRowsAtWordCount:
      3,
    selectedSourceNormalizationDenominator:
      0.1,
    rowProbabilityWithinSource:
      0.125,
    overallProbability:
      (12 / 72) *
      0.125,
  };
}
function sampleExport():
ExportResponse {
  return {
    settings: {
      sourceWeights: {
        source1: 1,
        source2: 1,
        source3: 1,
      },
      complexityPercentileTarget:
        0.5,
      complexityPercentileSpread:
        0.25,
      complexityReferenceVersion:
        1,
    },
    entries: [
      {
        position: 1,
        sourceId:
          'source1',
        sourceKey:
          'source1-001',
        text:
          'మొదటి',
        diagnostic: {
          selection:
            selection(
              'source1-001',
            ),
          cacheHit:
            false,
          requestStartedAt:
            1,
          requestCompletedAt:
            2,
          requestDurationMs:
            1,
        },
      },
      {
        position: 2,
        sourceId:
          'source1',
        sourceKey:
          'source1-002',
        text:
          'రెండవ పరిశీలన',
        diagnostic: {
          selection:
            selection(
              'source1-002',
            ),
          cacheHit:
            true,
          requestStartedAt:
            null,
          requestCompletedAt:
            null,
          requestDurationMs:
            null,
        },
      },
    ],
  };
}
function sampleFontBundle():
ObservationFontBundle {
  return {
    fonts:
      OBSERVATION_FONT_ASSETS.map(
        (
          asset,
          index,
        ) => ({
          family:
            asset.family,
          fileName:
            asset.fileName,
          licenseFileName:
            asset.licenseFileName,
          bytes:
            new Uint8Array([
              0x77,
              0x4f,
              0x46,
              0x32,
              index,
            ]),
          licenseText:
            `OFL notice for ${asset.family}`,
        }),
      ),
  };
}
function text(
  entry:
    ParsedStoredZipEntry,
): string {
  return new TextDecoder()
    .decode(
      entry.data,
    );
}
test(
  'EPUB is a real stored ZIP with mimetype first and uncompressed',
  () => {
    const bytes =
      buildEpubBytes(
        sampleExport(),
        sampleFontBundle(),
        {
          identifier:
            'urn:test:telugu-now',
          modified:
            '2026-09-06T00:00:00Z',
        },
      );
    const entries =
      parseStoredZip(
        bytes,
      );
    assert.equal(
      entries[0]?.name,
      'mimetype',
    );
    assert.equal(
      entries[0]?.method,
      0,
    );
    assert.equal(
      text(entries[0]!),
      'application/epub+zip',
    );
    assert.equal(
      entries[1]?.name,
      'META-INF/container.xml',
    );
  },
);
test(
  'EPUB contains the complete scripted viewer, data, fonts, and licenses',
  () => {
    const result =
      sampleExport();
    const bytes =
      buildEpubBytes(
        result,
        sampleFontBundle(),
        {
          identifier:
            'urn:test:telugu-now',
          modified:
            '2026-09-06T00:00:00Z',
        },
      );
    const entries =
      parseStoredZip(
        bytes,
      );
    const byName =
      new Map(
        entries.map(
          (entry) => [
            entry.name,
            entry,
          ],
        ),
      );
    for (
      const required
      of [
        'mimetype',
        'META-INF/container.xml',
        'EPUB/package.opf',
        'EPUB/nav.xhtml',
        'EPUB/viewer.xhtml',
        'EPUB/viewer.css',
        'EPUB/viewer.js',
        'EPUB/data.json',
      ]
    ) {
      assert.ok(
        byName.has(
          required,
        ),
        `${required} should exist`,
      );
    }
    const containerXml =
      text(
        byName.get(
          'META-INF/container.xml',
        )!,
      );
    assert.match(
      containerXml,
      /full-path="EPUB\/package\.opf"/,
    );
    const packageOpf =
      text(
        byName.get(
          'EPUB/package.opf',
        )!,
      );
    assert.match(
      packageOpf,
      /version="3\.0"/,
    );
    assert.match(
      packageOpf,
      /prefix="ibooks: http:\/\/vocabulary\.itunes\.apple\.com\/rdf\/ibooks\/vocabulary-extensions-1\.0\/"/,
    );
    assert.match(
      packageOpf,
      /<meta property="ibooks:specified-fonts">true<\/meta>/,
    );
    assert.match(
      packageOpf,
      /properties="nav"/,
    );
    assert.match(
      packageOpf,
      /properties="scripted"/,
    );
    assert.match(
      packageOpf,
      /<itemref idref="viewer"\/>/,
    );
    const viewerXhtml =
      text(
        byName.get(
          'EPUB/viewer.xhtml',
        )!,
      );
    assert.match(
      viewerXhtml,
      /xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/,
    );
    assert.match(
      viewerXhtml,
      /href="viewer\.css"/,
    );
    assert.match(
      viewerXhtml,
      /src="viewer\.js"/,
    );
    assert.match(
      viewerXhtml,
      /id="diagnostic-body"/,
    );
    const viewerScript =
      text(
        byName.get(
          'EPUB/viewer.js',
        )!,
      );
    assert.match(
      viewerScript,
      /const PRESENTATION=/,
    );
    assert.match(
      viewerScript,
      /function chooseFont\(/,
    );
    assert.match(
      viewerScript,
      /function preferredSize\(/,
    );
    assert.match(
      viewerScript,
      /function fitActive\(/,
    );
    assert.match(
      viewerScript,
      /document\.fonts\.load/,
    );
    assert.match(
      viewerScript,
      /window\.addEventListener\('resize'/,
    );
    assert.equal(
      /\bfetch\s*\(/.test(
        viewerScript,
      ),
      false,
    );
    assert.equal(
      /\bXMLHttpRequest\b/.test(
        viewerScript,
      ),
      false,
    );
    assert.deepEqual(
      JSON.parse(
        text(
          byName.get(
            'EPUB/data.json',
          )!,
        ),
      ),
      result,
    );
    for (
      const asset
      of OBSERVATION_FONT_ASSETS
    ) {
      const fontName =
        `EPUB/fonts/${asset.fileName}`;
      const licenseName =
        `EPUB/licenses/${asset.licenseFileName}`;
      assert.ok(
        byName.has(
          fontName,
        ),
      );
      assert.ok(
        byName.has(
          licenseName,
        ),
      );
      assert.match(
        packageOpf,
        new RegExp(
          asset.fileName
            .replace(
              '.',
              '\\.',
            ),
        ),
      );
      assert.match(
        packageOpf,
        new RegExp(
          asset
            .licenseFileName
            .replace(
              '.',
              '\\.',
            ),
        ),
      );
    }
  },
);
test(
  'EPUB viewer CSS uses packaged relative fonts rather than remote or data URLs',
  () => {
    const bytes =
      buildEpubBytes(
        sampleExport(),
        sampleFontBundle(),
        {
          identifier:
            'urn:test:telugu-now',
          modified:
            '2026-09-06T00:00:00Z',
        },
      );
    const byName =
      new Map(
        parseStoredZip(
          bytes,
        ).map(
          (entry) => [
            entry.name,
            entry,
          ],
        ),
      );
    const css =
      text(
        byName.get(
          'EPUB/viewer.css',
        )!,
      );
    assert.equal(
      (
        css.match(
          /@font-face/g,
        ) ?? []
      ).length,
      10,
    );
    assert.equal(
      css.includes(
        'data:font/woff2',
      ),
      false,
    );
    assert.equal(
      /https?:\/\//.test(
        css,
      ),
      false,
    );
    for (
      const asset
      of OBSERVATION_FONT_ASSETS
    ) {
      assert.ok(
        css.includes(
          `fonts/${asset.fileName}`,
        ),
      );
    }
  },
);
test(
  'prepared EPUB resolves only local font assets and exposes one downloadable epub blob',
  async () => {
    const originalFetch =
      globalThis.fetch;
    const requested:
      string[] = [];
    globalThis.fetch =
      (async (
        input:
          RequestInfo |
          URL,
      ) => {
        const url =
          String(input);
        requested.push(
          url,
        );
        if (
          url.includes(
            '/licenses/',
          )
        ) {
          return new Response(
            'OFL TEST',
            {
              status: 200,
            },
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
          {
            status: 200,
          },
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
            url.startsWith(
              '/fonts/',
            ),
        ),
      );
      const bytes =
        new Uint8Array(
          await prepared
            .blob
            .arrayBuffer(),
        );
      const entries =
        parseStoredZip(
          bytes,
        );
      assert.equal(
        entries[0]?.name,
        'mimetype',
      );
    } finally {
      globalThis.fetch =
        originalFetch;
    }
  },
);

tests/repository-contract.test.ts

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  spawnSync,
} from 'node:child_process';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';
const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );
function read(
  relativePath: string,
): string {
  return fs.readFileSync(
    path.join(
      root,
      relativePath,
    ),
    'utf8',
  );
}
test(
  'Iteration 2 controller is control.sh with no stale control-project.sh surface',
  () => {
    const control =
      path.join(
        root,
        'control.sh',
      );
    assert.equal(
      fs.existsSync(
        control,
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          root,
          'control-project.sh',
        ),
      ),
      false,
    );
    assert.ok(
      (
        fs.statSync(
          control,
        ).mode &
        0o111
      ) !== 0,
    );
    const syntax =
      spawnSync(
        'bash',
        [
          '-n',
          control,
        ],
        {
          encoding:
            'utf8',
        },
      );
    assert.equal(
      syntax.status,
      0,
      syntax.stderr,
    );
    const readme =
      read(
        'README.md',
      );
    assert.equal(
      readme.includes(
        'control-project.sh',
      ),
      false,
    );
    assert.ok(
      readme.includes(
        './control.sh',
      ),
    );
    assert.equal(
      fs.existsSync(
        path.join(
          root,
          'VALIDATION.md',
        ),
      ),
      false,
    );
    assert.equal(
      readme.includes(
        'VALIDATION.md',
      ),
      false,
    );
  },
);
test(
  'Iteration 2 frontend remains modular across profile, observation, settings, and export packaging',
  () => {
    const requiredFiles = [
      'frontend/src/components/icons.tsx',
      'frontend/src/profile/ProfileEntry.tsx',
      'frontend/src/profile/useProfileSession.ts',
      'frontend/src/observation/ObservationView.tsx',
      'frontend/src/observation/useObservationTypography.ts',
      'frontend/src/settings/types.ts',
      'frontend/src/settings/language.ts',
      'frontend/src/settings/settings-utils.ts',
      'frontend/src/settings/diagnostic.ts',
      'frontend/src/settings/SettingsShell.tsx',
      'frontend/src/settings/SettingsView.tsx',
      'frontend/src/settings/useSettingsController.ts',
      'frontend/src/settings/pages/SettingsIndex.tsx',
      'frontend/src/settings/pages/ComplexityPage.tsx',
      'frontend/src/settings/pages/SourceWeightsPage.tsx',
      'frontend/src/settings/pages/DiagnosticPage.tsx',
      'frontend/src/settings/pages/ExportPage.tsx',
      'frontend/src/export-artifact.ts',
      'frontend/src/export-viewer.ts',
      'frontend/src/export-html.ts',
      'frontend/src/export-epub.ts',
      'frontend/src/zip.ts',
      'frontend/src/font-assets.ts',
      'frontend/font-assets.json',
      'scripts/sync-fonts.mjs',
      'frontend/src/styles/base.css',
      'frontend/src/styles/profile.css',
      'frontend/src/styles/observation.css',
      'frontend/src/styles/settings.css',
    ];
    for (
      const relativePath
      of requiredFiles
    ) {
      assert.equal(
        fs.existsSync(
          path.join(
            root,
            relativePath,
          ),
        ),
        true,
        `${relativePath} should exist`,
      );
    }
    const app =
      read(
        'frontend/src/App.tsx',
      );
    assert.ok(
      app.includes(
        "from './profile/ProfileEntry'",
      ),
    );
    assert.ok(
      app.includes(
        "from './profile/useProfileSession'",
      ),
    );
    assert.ok(
      app.includes(
        "from './observation/ObservationView'",
      ),
    );
    assert.ok(
      app.includes(
        "from './settings/SettingsView'",
      ),
    );
    assert.ok(
      app.includes(
        "from './settings/useSettingsController'",
      ),
    );
    assert.equal(
      app.includes(
        'settings-modal',
      ),
      false,
    );
    assert.equal(
      app.includes(
        'chooseRandomObservationFont',
      ),
      false,
    );
    assert.ok(
      app.split(
        '\n',
      ).length <
        100,
    );
  },
);
test(
  'Settings export uses a transient format chooser and keeps format out of selection',
  () => {
    const settingsView =
      read(
        'frontend/src/settings/SettingsView.tsx',
      );
    const exportPage =
      read(
        'frontend/src/settings/pages/ExportPage.tsx',
      );
    const controller =
      read(
        'frontend/src/settings/useSettingsController.ts',
      );
    const language =
      read(
        'frontend/src/settings/language.ts',
      );
    const styles =
      read(
        'frontend/src/styles/settings.css',
      );
    assert.ok(
      settingsView.includes(
        'formatChooserOpen={formatChooserOpen}',
      ),
    );
    assert.ok(
      settingsView.includes(
        'onRequestExport={controller.requestExport}',
      ),
    );
    assert.ok(
      settingsView.includes(
        'controller.chooseExportFormat(format)',
      ),
    );
    assert.ok(
      exportPage.includes(
        'className="export-format-modal"',
      ),
    );
    assert.ok(
      exportPage.includes(
        "onChooseFormat('epub')",
      ),
    );
    assert.ok(
      exportPage.includes(
        "onChooseFormat('html')",
      ),
    );
    assert.ok(
      exportPage.includes(
        'downloadPreparedExportArtifact(preparedArtifact)',
      ),
    );
    assert.ok(
      controller.includes(
        'const [generatedExport, setGeneratedExport]',
      ),
    );
    assert.ok(
      controller.includes(
        'const [preparedArtifact, setPreparedArtifact]',
      ),
    );
    assert.ok(
      controller.includes(
        'setFormatChooserOpen(true)',
      ),
    );
    assert.ok(
      controller.includes(
        'result = await generateExport(profileCode, { count })',
      ),
    );
    assert.ok(
      controller.includes(
        "format === 'epub'",
      ),
    );
    assert.ok(
      controller.includes(
        'await prepareEpubExport(result)',
      ),
    );
    assert.ok(
      controller.includes(
        'await prepareHtmlExport(result)',
      ),
    );
    assert.equal(
      controller.includes(
        'generateExport(profileCode, { count, format',
      ),
      false,
    );
    assert.ok(
      language.includes(
        "chooseExportFormat: 'Choose export format'",
      ),
    );
    assert.ok(
      language.includes(
        "epubDescription: 'iPhone / iPad · Apple Books · Interactive · Offline'",
      ),
    );
    assert.ok(
      language.includes(
        "htmlDescription: 'Browser / Desktop · Interactive · Offline'",
      ),
    );
    assert.ok(
      styles.includes(
        '.export-format-backdrop',
      ),
    );
    assert.ok(
      styles.includes(
        '.export-format-modal',
      ),
    );
  },
);
test(
  'export packaging has one shared viewer runtime and separate HTML/EPUB wrappers',
  () => {
    const viewer =
      read(
        'frontend/src/export-viewer.ts',
      );
    const html =
      read(
        'frontend/src/export-html.ts',
      );
    const epub =
      read(
        'frontend/src/export-epub.ts',
      );
    const artifact =
      read(
        'frontend/src/export-artifact.ts',
      );
    for (
      const functionName
      of [
        'buildStandaloneViewerCss',
        'buildStandaloneViewerMarkup',
        'buildStandaloneViewerScript',
      ]
    ) {
      assert.ok(
        viewer.includes(
          `export function ${functionName}`,
        ),
      );
      assert.ok(
        html.includes(
          `${functionName}(`,
        ),
      );
      assert.ok(
        epub.includes(
          `${functionName}(`,
        ),
      );
    }
    assert.ok(
      viewer.includes(
        'const PRESENTATION=',
      ),
    );
    assert.ok(
      viewer.includes(
        'function chooseFont()',
      ),
    );
    assert.ok(
      viewer.includes(
        'function preferredSize(',
      ),
    );
    assert.ok(
      viewer.includes(
        'function fitActive()',
      ),
    );
    assert.ok(
      viewer.includes(
        'document.fonts.load',
      ),
    );
    assert.ok(
      viewer.includes(
        "window.addEventListener('resize'",
      ),
    );
    assert.ok(
      artifact.includes(
        "export type ExportFormat = 'html' | 'epub'",
      ),
    );
    assert.ok(
      artifact.includes(
        'downloadPreparedExportArtifact',
      ),
    );
  },
);
test(
  'EPUB wrapper declares a scripted EPUB 3 package with all local fonts and no ZIP dependency',
  () => {
    const epub =
      read(
        'frontend/src/export-epub.ts',
      );
    const zip =
      read(
        'frontend/src/zip.ts',
      );
    const packageJson =
      JSON.parse(
        read(
          'package.json',
        ),
      ) as {
        dependencies?:
          Record<
            string,
            string
          >;
      };
    assert.ok(
      epub.includes(
        "data: 'application/epub+zip'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'META-INF/container.xml'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/package.opf'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/nav.xhtml'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/viewer.xhtml'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/viewer.css'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/viewer.js'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/data.json'",
      ),
    );
    assert.ok(
      epub.includes(
        'properties="scripted"',
      ),
    );
    assert.ok(
      epub.includes(
        'properties="nav"',
      ),
    );
    assert.ok(
      epub.includes(
        'prefix="ibooks: http://vocabulary.itunes.apple.com/rdf/ibooks/vocabulary-extensions-1.0/"',
      ),
    );
    assert.ok(
      epub.includes(
        '<meta property="ibooks:specified-fonts">true</meta>',
      ),
    );
    assert.ok(
      epub.includes(
        'font/woff2',
      ),
    );
    assert.ok(
      epub.includes(
        'loadObservationFontBundle()',
      ),
    );
    assert.ok(
      epub.includes(
        'createStoredZip(entries)',
      ),
    );
    assert.ok(
      zip.includes(
        'const STORE_METHOD = 0',
      ),
    );
    assert.ok(
      zip.includes(
        '0x04034b50',
      ),
    );
    assert.ok(
      zip.includes(
        '0x02014b50',
      ),
    );
    assert.ok(
      zip.includes(
        '0x06054b50',
      ),
    );
    assert.equal(
      packageJson
        .dependencies
        ?.jszip,
      undefined,
    );
    assert.equal(
      packageJson
        .dependencies
        ?.fflate,
      undefined,
    );
  },
);
test(
  'live presentation remains local-font, monochrome, keyboard-stable, and activation-randomized',
  () => {
    const icons =
      read(
        'frontend/src/components/icons.tsx',
      );
    const profileEntry =
      read(
        'frontend/src/profile/ProfileEntry.tsx',
      );
    const observationView =
      read(
        'frontend/src/observation/ObservationView.tsx',
      );
    const typography =
      read(
        'frontend/src/observation/useObservationTypography.ts',
      );
    const presentation =
      read(
        'frontend/src/presentation.ts',
      );
    const fontAssets =
      read(
        'frontend/src/font-assets.ts',
      );
    const main =
      read(
        'frontend/src/main.tsx',
      );
    const baseStyles =
      read(
        'frontend/src/styles/base.css',
      );
    const profileStyles =
      read(
        'frontend/src/styles/profile.css',
      );
    const observationStyles =
      read(
        'frontend/src/styles/observation.css',
      );
    const indexHtml =
      read(
        'frontend/index.html',
      );
    assert.ok(
      icons.includes(
        'export function SettingsIcon',
      ),
    );
    assert.ok(
      icons.includes(
        'export function LanguageIcon',
      ),
    );
    assert.equal(
      icons.includes(
        '⚙',
      ),
      false,
    );
    assert.equal(
      icons.includes(
        '🌐',
      ),
      false,
    );
    assert.ok(
      baseStyles.includes(
        'stroke: currentColor',
      ),
    );
    assert.ok(
      profileEntry.includes(
        "'--entry-layout-height'",
      ),
    );
    assert.ok(
      /height:\s*var\(\s*--entry-layout-height/
        .test(
          profileStyles,
        ),
    );
    assert.ok(
      observationView.includes(
        '<SettingsIcon />',
      ),
    );
    assert.ok(
      observationView.includes(
        'useObservationTypography(',
      ),
    );
    assert.ok(
      typography.includes(
        'chooseRandomObservationFont()',
      ),
    );
    assert.ok(
      typography.includes(
        'OBSERVATION_PRESENTATION.fitIterations',
      ),
    );
    assert.ok(
      typography.includes(
        'document.fonts.load(',
      ),
    );
    assert.ok(
      observationStyles.includes(
        '.nav-zone:disabled',
      ),
    );
    assert.ok(
      observationStyles.includes(
        '.settings-trigger',
      ),
    );
    assert.ok(
      observationStyles.includes(
        'bottom:',
      ),
    );
    assert.ok(
      main.includes(
        'installLiveObservationFontFaces()',
      ),
    );
    assert.ok(
      fontAssets.includes(
        'loadObservationFontBundle',
      ),
    );
    assert.doesNotMatch(
      indexHtml,
      /https?:\/\/fonts\.googleapis\.com/,
    );
    for (
      const family
      of [
        'Noto Sans Telugu',
        'Noto Serif Telugu',
        'Mandali',
        'Ramabhadra',
        'NTR',
        'Peddana',
        'Ramaraja',
        'Sree Krushnadevaraya',
        'Suranna',
        'Tenali Ramakrishna',
      ]
    ) {
      assert.ok(
        presentation.includes(
          `'${family}'`,
        ),
      );
    }
  },
);

README.md

# Implementation Iteration 2
This repository contains Implementation Iteration 2 of the Telugu observation app. Iteration 1's persistent history/timing model, ten-item future queue, continuous one-for-one replenishment, sequential live preparation, and SQLite persistence remain the foundation.
Iteration 2 adds source/complexity selection, persistent profile settings, repeatable source-record caching, tap-revealed controls, full-page Settings navigation, bilingual Settings labels, structured diagnostics, activation-time randomized Telugu typography, and portable offline export as either standalone HTML or interactive EPUB 3.
## Stack
- TypeScript
- React + Vite
- Hono + Node.js
- SQLite (`better-sqlite3`)
## Project controller
The root `control.sh` is the normal development entry point.
Install dependencies on a new checkout:
```bash
./control.sh deps --option install
```
Start development:
```bash
./control.sh dev
```
The browser app is served by Vite on port `5173`. The Hono API runs on `127.0.0.1:8787`. Vite binds to `0.0.0.0` so development-container/Codespaces forwarding can expose the UI.
The configured prototype profile code is `001`.
## Build and tests
```bash
./control.sh build --option start
./control.sh test --option start
```
The tests preserve the accepted Iteration 1 history, timing, queue, and replenishment invariants and cover the Iteration 2 source selector, global complexity reference, probability snapshots, repeats, settings isolation, shared source-record cache, export isolation, migration, numerical edge cases, randomized presentation, local font assets, standalone HTML, and EPUB container generation.
Selection is additionally checked against an independent probability oracle, deterministic RNG boundaries, a 100-selection black-box audit, and a seeded 50,000-selection Monte Carlo comparison.
## Deterministic dummy sources
Iteration 2 has exactly three selectable dummy sources:
- `source1`: 12 rows
- `source2`: 24 rows
- `source3`: 36 rows
Their literal Telugu rows live under `server/src/sources/dummy/data/`. Each row has a stable source key. The fixture lengths were sampled once from fixed-seed right-skewed distributions and then committed literally. `source1` is shorter on average, `source2` is moderate, and `source3` is longer and broader. Across all 72 rows the current fixture spans 1 through 40 words.
An uncached dummy source retrieval waits 1–15 seconds by default. The delay can be overridden in the environment for tests.
## Source selection
Each profile stores one source weight per selectable source. Every weight is in `[0,1]`, and at least one weight must be exactly `1`. Configurations with every weight below `1` are rejected rather than normalized.
For source `i`, with `N_i` selectable rows and profile weight `w_i`:
```text
source mass = N_i * w_i
P(source i) = (N_i * w_i) / sum_j(N_j * w_j)
```
With all source weights at `1`, source probability is proportional to source row count.
## Global complexity reference
Iteration 2 uses word count only as the intrinsic measurement for one global complexity reference built from all 72 selectable dummy rows. The user does not configure a target word count.
For each word count `k`, tied rows occupy their empirical global percentile interval `[a_k,b_k]`.
The reference is versioned as:
```text
complexity_reference_version = 1
```
Each profile configures:
- global complexity percentile target `T` in `[0,1]`;
- global complexity percentile spread `R > 0`.
The desired complexity curve is a normal distribution centered at `T`. `R` is the half-width corresponding to the central 98% reference interval:
```text
sigma = R / 2.326347874
```
The normal is truncated and renormalized to `[0,1]`. Probability mass over each tied word-count percentile interval is divided by the global number of rows with that word count to produce per-row global complexity mass. Once a source has been selected, those masses are normalized over rows available in that source.
Source probability, conditional row probability, and overall source+row probability remain distinct and are stored in every normal acquisition's immutable selection snapshot.
## Repeats and shared source-record cache
Selections are independent and with replacement. The same `(source_id, source_key)` may appear in multiple acquisitions.
A stable source record and an acquisition are separate concepts:
- a source record is the underlying source row and normalized retrieved content;
- an acquisition is one particular probabilistic selection event.
`source_records` is the shared persistent cache, keyed by `(source_id, source_key)`. Once either the live queue or Export retrieves a source record, later live/export selections reuse it without another source request.
## Queue behavior
The live profile maintains ten selected unseen observations. Initial load fills a short queue to ten. Every first-time consumption moves one observation into history and atomically reserves exactly one replacement at the future-queue tail.
Back/forward movement through already-seen history does not consume the queue and creates no replacement. Live source-record preparation remains sequential and queue order remains authoritative regardless of later settings changes, cache-hit speed, or source latency.
Saved source/complexity settings affect only acquisitions selected after the save. Existing history, existing unseen selections, and already-pending preparation work are not resampled.
## Observation controls
Back, Next, and the bottom-right Settings icon are hidden by default. A single tap on the ordinary observation surface reveals all three; another background tap hides them. Successful Back/Next navigation hides them again.
Whenever controls are revealed, both Back and Next remain in fixed positions. An unavailable direction is greyed and disabled rather than removed.
The Settings and Settings-language controls are monochrome application-rendered SVGs using `currentColor` rather than platform emoji glyphs.
When a valid profile has no current observation yet, the observation area displays:
```text
...
```
The placeholder does not create history, an acquisition, source data, or timing state.
## Stable profile-code entry
The initial three-digit profile-code input is anchored to the viewport height captured when the entry screen first renders. Opening the software keyboard therefore does not recenter or move the bar upward as the mobile visual viewport changes.
## Observation typography
Each time an observation becomes actively displayed, the client randomly chooses one font from this fixed collection:
- Noto Sans Telugu
- Noto Serif Telugu
- Mandali
- Ramabhadra
- NTR
- Peddana
- Ramaraja
- Sree Krushnadevaraya
- Suranna
- Tenali Ramakrishna
Font selection is presentation-only and is not stored in history, acquisitions, source records, or selection snapshots. Navigating away and later returning rerolls the font. Closing Settings and returning also creates a fresh typography activation. Ordinary React rerenders, polling, timing refreshes, and queue-readiness changes do not reroll while the same observation remains continuously active.
The canonical presentation configuration lives in `frontend/src/presentation.ts` and is reused by the live viewer and both export formats.
The preferred size is derived continuously from observation length. After a font is selected, the browser waits for that font, measures the rendered observation, and reduces the preferred size only as necessary to fit the available area.
## Font assets
The live application, HTML export, and EPUB export use the same ten application-controlled Telugu WOFF2 assets under:
```text
frontend/public/fonts/
```
The canonical family/file mapping is `frontend/font-assets.json`.
Run:
```bash
npm run fonts:sync
```
The sync script stores the corresponding SIL Open Font License text and writes `frontend/public/fonts/font-assets.lock.json` with the resolved source URLs and SHA-256 hashes. The generated WOFF2 files, license files, and lock file are intended to remain committed so production behavior is tied to exact assets.
No font is fetched from the internet while a user generates or opens a completed export.
## Full-page Settings
Settings replaces the observation view while open; it is not a modal. The Settings root links to four child pages:
1. Complexity
2. Source weights
3. Diagnostic
4. Export
Each child page has Back to return to the Settings root. `×` exits the entire Settings hierarchy and returns to the same observation.
Because the observation is not visible while Settings is displayed, opening Settings pauses visible-time accumulation. The history-tail absolute timer continues under the accepted Iteration 1 timing model. Closing Settings resumes visible accumulation when appropriate.
A monochrome language control remains bottom-right throughout Settings and switches static Settings/Diagnostic labels between Telugu and English. This language preference is presentation-only.
## Diagnostic
Diagnostic has its own full page and renders the current acquisition as a two-column mapping table rather than free-form text. The table contains the Iteration 1 trigger/preparation fields and the complete persisted Iteration 2 selection snapshot.
If there is no current acquisition, the Diagnostic page displays `...`.
## Export selection semantics
Export is not a history export and does not simulate repeated Next presses.
The user enters a positive integer `N`. A completed export batch contains exactly `N` fresh independent source+row selections generated by the same selection engine used by normal acquisitions.
Export does not:
- advance the current history cursor;
- append profile history;
- consume or replenish the live queue;
- consume normal acquisition numbers;
- alter observation timing.
Export does use and populate the normal persistent source-record cache. Selected uncached rows are resolved sequentially; cached rows are reused immediately.
The completed `ExportResponse` is format-independent and remains the canonical generated batch.
## Export format choice
The Export page flow is:
```text
enter N
    ↓
Export
    ↓
choose format
    ├─ EPUB — iPhone / iPad · Apple Books · Interactive · Offline
    └─ HTML — Browser / Desktop · Interactive · Offline
    ↓
generate N selections if no current batch exists
    ↓
package the completed ExportResponse
    ↓
Download
```
Pressing Export opens a small transient format-choice modal. Cancel closes it without generating anything.
The selected format is not passed into source or row selection. EPUB versus HTML is only an artifact/container choice.
After the first format has generated the batch, pressing Export again and selecting the other format repackages the same retained `ExportResponse`; it does not generate another `N` selections.
Editing `N` or successfully saving source/complexity settings invalidates both the retained current batch and any prepared artifact shown by the Export page.
## Shared standalone viewer
`frontend/src/export-viewer.ts` owns the standalone viewer CSS, markup, diagnostic mapping, random-font activation semantics, continuous preferred-size formula integration, and DOM fit behavior shared by HTML and EPUB.
Both formats therefore preserve:
```text
entry becomes active
        ↓
randomly choose one of the same ten fonts
        ↓
wait for that font
        ↓
derive preferred size from observation length
        ↓
measure actual rendered text
        ↓
reduce only if necessary to fit
        ↓
display
```
Back/Next rerolls the newly activated entry's font. Diagnostic toggling does not. Resize/orientation changes refit the current entry without rerolling its active font.
## HTML export
Choosing HTML produces:
```text
telugu-export-N.html
```
It is one self-contained browser document containing all observations, diagnostics, inline CSS, inline JavaScript, canonical presentation configuration, all ten embedded WOFF2 fonts, and font-license notices.
It performs no runtime network requests after download.
## EPUB export
Choosing EPUB produces:
```text
telugu-export-N.epub
```
The Iteration 2 compatibility target is interactive offline use in Apple Books on iPhone/iPad, with macOS Apple Books tested where practical. Equivalent scripting behavior is not promised for every EPUB reader.
The EPUB is a real EPUB 3 ZIP container with this structure:
```text
mimetype
META-INF/
  container.xml
EPUB/
  package.opf
  nav.xhtml
  viewer.xhtml
  viewer.css
  viewer.js
  data.json
  fonts/
    <all 10 WOFF2 files>
  licenses/
    <all required font license files>
```
The `mimetype` entry contains exactly `application/epub+zip`, is the first ZIP entry, and is stored without compression. `META-INF/container.xml` points to `EPUB/package.opf`. The OPF manifest declares the navigation document, scripted viewer, shared viewer CSS/JavaScript, data, all fonts, and license resources. The viewer spine item is explicitly marked `scripted`.
Because Apple Books is the explicit EPUB target and the book embeds its own fonts, `package.opf` also declares the Apple Books `ibooks` vocabulary prefix and includes:
```xml
<meta property="ibooks:specified-fonts">true</meta>
```
This tells Apple Books to honor the packaged font faces used by the randomized typography viewer rather than substituting reader-selected fonts.
The browser-side EPUB packager is isolated in `frontend/src/export-epub.ts`. ZIP mechanics are isolated in `frontend/src/zip.ts`; the current implementation emits deterministic stored ZIP entries and requires no third-party ZIP runtime.
The EPUB contains the same immutable `ExportResponse` data and the same viewer behavior as HTML. All fonts and executable resources are inside the EPUB, so normal viewer operation requires no Telugu Now server, Fly.io, Codespaces, Google Fonts, installed Telugu fonts, APIs, external JavaScript, or external CSS.
## EPUB acceptance
Automated tests validate the EPUB ZIP/container structure, first uncompressed mimetype entry, OPF manifest, scripted declaration, Apple Books embedded-font metadata, viewer resources, data, ten fonts, licenses, and offline viewer code.
Before EPUB support is considered complete for release, it should additionally pass an actual-device acceptance test in Apple Books on iPhone:
```text
generate EPUB
→ open/save in Apple Books
→ enable airplane mode
→ close and reopen Books
→ open EPUB
→ verify Back / Next
→ verify random font rerolls
→ verify sizing/fitting
→ verify Diagnostic mapping table
→ rotate and verify refit without reroll
```
## Persistence and migration
The default SQLite file is:
```text
./data/app.sqlite
```
Override it with `DATABASE_PATH`.
Iteration 2 performs a non-destructive schema upgrade for Iteration 1 databases. It removes Iteration 1's observation-level uniqueness on `(source_id, source_key)` so repeats can create distinct acquisitions, creates the shared `source_records` cache, adds profile selection settings/weights, and adds persisted selection snapshots.
Already-ready Iteration 1 observations are backfilled into the shared source-record cache. A compatibility-only disabled Iteration 1 mock resolver remains available for old pending `mock` rows but is not one of the three selectable Iteration 2 sources.
## Environment defaults
See `.env.example`.
```text
SOURCE1_WEIGHT=1
SOURCE2_WEIGHT=1
SOURCE3_WEIGHT=1
COMPLEXITY_PERCENTILE_TARGET=0.5
COMPLEXITY_PERCENTILE_SPREAD=0.25
MOCK_DELAY_MIN_MS=1000
MOCK_DELAY_MAX_MS=15000
MAX_EXPORT_COUNT=500
```
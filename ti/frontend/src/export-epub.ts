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
        data: 'application/epub+zip',
      },
      {
        name: 'META-INF/container.xml',
        data:
          buildContainerXml(),
      },
      {
        name: 'EPUB/package.opf',
        data:
          packageOpf,
      },
      {
        name: 'EPUB/nav.xhtml',
        data:
          navXhtml,
      },
      {
        name: 'EPUB/viewer.xhtml',
        data:
          viewerXhtml,
      },
      {
        name: 'EPUB/viewer.css',
        data:
          viewerCss,
      },
      {
        name: 'EPUB/viewer.js',
        data:
          viewerScript,
      },
      {
        name: 'EPUB/data.json',
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
  return createStoredZip(entries);
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
        bytes.buffer as ArrayBuffer,
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

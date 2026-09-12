import type { ExportResponse } from '../../shared/contracts';
import type { PreparedExportArtifact } from './export-artifact';
import { prepareExportAudio, type ExportAudioAsset } from './export-audio';
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
  audioAssets?: ExportAudioAsset[];
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
function buildNavXhtml(hasAudio: boolean): string {
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
${hasAudio ? '      <li><a href="audio.xhtml">Text and audio (no scripting required)</a></li>' : ''}
      <li><a href="viewer.xhtml">తెలుగు</a></li>
    </ol>
  </nav>
  <nav epub:type="landmarks">
    <h2>Landmarks</h2>
    <ol>
      <li><a epub:type="bodymatter" href="${hasAudio ? 'audio.xhtml' : 'viewer.xhtml'}">తెలుగు</a></li>
    </ol>
  </nav>
</body>
</html>`;
}
function buildViewerXhtml(hasAudio: boolean): string {
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
${hasAudio ? '<a href="audio.xhtml" style="position:absolute;top:1rem;left:1rem;z-index:4" lang="en">Text and audio / playback help</a>' : ''}
${markup}
<script type="text/javascript" src="viewer.js"></script>
</body>
</html>`;
}
function buildAudioXhtml(result: ExportResponse): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="te" xml:lang="te">
<head>
  <meta charset="utf-8" />
  <title>Text and audio</title>
</head>
<body>
  <h1 lang="en">Text and audio</h1>
  <p lang="en">These controls do not require JavaScript. Playback and opening audio files depend on your EPUB reader. <a href="audio-help.xhtml">Playback help</a></p>
  <p lang="en"><a href="viewer.xhtml">Interactive viewer (requires scripting)</a></p>
  <ol>
${result.entries.map(entry => `    <li>
      <p>${xmlEscape(entry.text)}</p>
${entry.audio ? `      <audio controls="controls" preload="none">
        <source src="${xmlEscape(entry.audio.url)}" type="${xmlEscape(entry.audio.mimeType)}" />
      </audio>
      <p lang="en"><a href="${xmlEscape(entry.audio.url)}">Open audio file (MP3)</a></p>` : ''}
    </li>`).join('\n')}
  </ol>
</body>
</html>`;
}
function buildAudioHelpXhtml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">
<head><meta charset="utf-8" /><title>Audio playback help</title></head>
<body>
  <h1>Audio playback help</h1>
  <p>Not every EPUB reader supports inline audio or scripting. The text and audio page works without scripting, but playback still requires support for the packaged audio format.</p>
  <p>This EPUB contains MP3 copies of the recordings, an EPUB 3 core audio format supported by Apple Books. The original corpus recordings and HTML exports are unchanged.</p>
  <p>If playback fails, try the Open audio file link. Some readers cannot open these links either. You can instead extract the audio folder from the EPUB with a ZIP utility and play the MP3 files, or use the HTML export in a browser. Playback and scripting behavior still vary by reader and device; MP3 does not enable scripting in readers that disable it.</p>
  <p><a href="audio.xhtml">Return to text and audio</a></p>
</body>
</html>`;
}
function buildPackageOpf(
  identifier: string,
  modified: string,
  fontBundle: ObservationFontBundle,
  audioAssets: ExportAudioAsset[],
  hasAudio: boolean,
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
${hasAudio ? '    <item id="audio-page" href="audio.xhtml" media-type="application/xhtml+xml"/>\n    <item id="audio-help" href="audio-help.xhtml" media-type="application/xhtml+xml"/>' : ''}
    <item id="viewer-css" href="viewer.css" media-type="text/css"/>
    <item id="viewer-js" href="viewer.js" media-type="application/javascript"/>
    <item id="export-data" href="data.json" media-type="application/json"/>
${fontItems}
${licenseItems}
${audioAssets.map((asset, index) => `    <item id="audio-${index + 1}" href="${xmlEscape(asset.path)}" media-type="${xmlEscape(asset.mimeType)}"/>`).join('\n')}
  </manifest>
  <spine>
${hasAudio ? '    <itemref idref="audio-page"/>' : ''}
    <itemref idref="viewer"${hasAudio ? ' linear="no"' : ''}/>
${hasAudio ? '    <itemref idref="audio-help" linear="no"/>' : ''}
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
  const hasAudio = result.entries.some(entry => Boolean(entry.audio));
  const viewerXhtml =
    buildViewerXhtml(hasAudio);
  const navXhtml =
    buildNavXhtml(hasAudio);
  const packageOpf =
    buildPackageOpf(
      identifier,
      modified,
      fontBundle,
      options.audioAssets ?? [],
      hasAudio,
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
  if (hasAudio) {
    entries.push(
      { name: 'EPUB/audio.xhtml', data: buildAudioXhtml(result) },
      { name: 'EPUB/audio-help.xhtml', data: buildAudioHelpXhtml() },
    );
  }
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
  for (const asset of options.audioAssets ?? []) {
    entries.push({ name: `EPUB/${asset.path}`, data: asset.bytes });
  }
  return createStoredZip(entries);
}
export async function prepareEpubExport(
  result: ExportResponse,
): Promise<PreparedExportArtifact> {
  const [fontBundle, audio] = await Promise.all([
    loadObservationFontBundle(),
    prepareExportAudio(result, 'epub'),
  ]);
  const bytes =
    buildEpubBytes(
      audio.result,
      fontBundle,
      { audioAssets: audio.assets },
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

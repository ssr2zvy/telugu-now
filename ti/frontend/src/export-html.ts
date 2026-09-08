import type { ExportResponse } from '../../shared/contracts';
import type { PreparedExportArtifact } from './export-artifact';
import {
  createPlaceholderEmbeddedObservationFontBundle,
  loadEmbeddedObservationFontBundle,
  observationFontFaceCss,
  type EmbeddedObservationFontBundle,
} from './font-assets';
import {
  buildStandaloneViewerCss,
  buildStandaloneViewerMarkup,
  buildStandaloneViewerScript,
} from './export-viewer';
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
function embeddedFontCss(bundle: EmbeddedObservationFontBundle): string {
  return observationFontFaceCss(
    bundle.fonts.map((font) => ({
      family: font.family,
      source: font.dataUrl,
    })),
  );
}
export function buildStandaloneExportHtml(
  result: ExportResponse,
  fontBundle: EmbeddedObservationFontBundle =
    createPlaceholderEmbeddedObservationFontBundle(),
): string {
  const fontFaces = embeddedFontCss(fontBundle);
  const viewerCss = buildStandaloneViewerCss(fontFaces);
  const viewerMarkup = buildStandaloneViewerMarkup();
  const viewerScript = buildStandaloneViewerScript(result);
  const licenseNotices = safeJson(
    fontBundle.fonts.map((font) => ({
      family: font.family,
      licenseText: font.licenseText,
    })),
  );
  return `<!doctype html>
<html lang="te">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>తెలుగు</title>
<style>${viewerCss}</style>
</head>
<body>
${viewerMarkup}
<script type="application/json" id="font-license-notices">${licenseNotices}</script>
<script>${viewerScript}</script>
</body>
</html>`;
}
export async function prepareHtmlExport(
  result: ExportResponse,
): Promise<PreparedExportArtifact> {
  const fontBundle = await loadEmbeddedObservationFontBundle();
  const html = buildStandaloneExportHtml(result, fontBundle);
  return {
    format: 'html',
    blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
    fileName: `telugu-export-${result.entries.length}.html`,
    entryCount: result.entries.length,
  };
}

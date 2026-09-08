import rawFontAssets from '../font-assets.json' with { type: 'json' };
import {
  OBSERVATION_FONTS,
  OBSERVATION_PRESENTATION,
  type ObservationFontFamily,
} from './presentation';
export interface ObservationFontAsset {
  family: ObservationFontFamily;
  fileName: string;
  licenseFileName: string;
  googleFontsFolder: string;
}
export interface LoadedObservationFont {
  family: ObservationFontFamily;
  fileName: string;
  licenseFileName: string;
  bytes: Uint8Array;
  licenseText: string;
}
export interface ObservationFontBundle {
  fonts: readonly LoadedObservationFont[];
}
export interface EmbeddedObservationFont {
  family: ObservationFontFamily;
  dataUrl: string;
  licenseText: string;
}
export interface EmbeddedObservationFontBundle {
  fonts: readonly EmbeddedObservationFont[];
}
function isObservationFontFamily(value: string): value is ObservationFontFamily {
  return (OBSERVATION_FONTS as readonly string[]).includes(value);
}
function validateAsset(value: (typeof rawFontAssets)[number]): ObservationFontAsset {
  if (!isObservationFontFamily(value.family)) {
    throw new Error(`Unknown observation font family: ${value.family}`);
  }
  if (!/^[a-z0-9-]+\.woff2$/.test(value.fileName)) {
    throw new Error(`Invalid observation font file name: ${value.fileName}`);
  }
  if (!/^[a-z0-9-]+-OFL\.txt$/.test(value.licenseFileName)) {
    throw new Error(`Invalid observation font license file name: ${value.licenseFileName}`);
  }
  if (!/^[a-z0-9]+$/.test(value.googleFontsFolder)) {
    throw new Error(`Invalid Google Fonts folder: ${value.googleFontsFolder}`);
  }
  return {
    family: value.family,
    fileName: value.fileName,
    licenseFileName: value.licenseFileName,
    googleFontsFolder: value.googleFontsFolder,
  };
}
export const OBSERVATION_FONT_ASSETS: readonly ObservationFontAsset[] =
  rawFontAssets.map(validateAsset);
const assetFamilies = OBSERVATION_FONT_ASSETS.map((asset) => asset.family);
if (
  assetFamilies.length !== OBSERVATION_FONTS.length ||
  OBSERVATION_FONTS.some((family, index) => assetFamilies[index] !== family)
) {
  throw new Error('Observation font asset manifest must exactly match OBSERVATION_FONTS.');
}
function localFontUrl(fileName: string): string {
  return `/fonts/${fileName}`;
}
function localLicenseUrl(fileName: string): string {
  return `/fonts/licenses/${fileName}`;
}
function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
export function observationFontFaceCss(
  sources: readonly { family: ObservationFontFamily; source: string }[],
): string {
  return sources
    .map(
      ({ family, source }) =>
        `@font-face{font-family:"${cssString(family)}";src:url("${source}") format("woff2");font-style:normal;font-weight:${OBSERVATION_PRESENTATION.fontWeight};font-display:swap}`,
    )
    .join('\n');
}
let liveFontFacesInstalled = false;
export function installLiveObservationFontFaces(
  documentValue: Document = document,
): void {
  if (
    liveFontFacesInstalled ||
    documentValue.getElementById('telugu-now-observation-fonts')
  ) {
    liveFontFacesInstalled = true;
    return;
  }
  const style = documentValue.createElement('style');
  style.id = 'telugu-now-observation-fonts';
  style.textContent = observationFontFaceCss(
    OBSERVATION_FONT_ASSETS.map((asset) => ({
      family: asset.family,
      source: localFontUrl(asset.fileName),
    })),
  );
  documentValue.head.appendChild(style);
  liveFontFacesInstalled = true;
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
async function fetchRequired(
  fetchValue: typeof fetch,
  url: string,
): Promise<Response> {
  const response = await fetchValue(url);
  if (!response.ok) {
    throw new Error(`Failed to load application font asset ${url}: ${response.status}`);
  }
  return response;
}
export async function loadObservationFontBundle(
  fetchValue: typeof fetch = fetch,
): Promise<ObservationFontBundle> {
  const fonts = await Promise.all(
    OBSERVATION_FONT_ASSETS.map(async (asset): Promise<LoadedObservationFont> => {
      const [fontResponse, licenseResponse] = await Promise.all([
        fetchRequired(fetchValue, localFontUrl(asset.fileName)),
        fetchRequired(fetchValue, localLicenseUrl(asset.licenseFileName)),
      ]);
      const [fontBuffer, licenseText] = await Promise.all([
        fontResponse.arrayBuffer(),
        licenseResponse.text(),
      ]);
      return {
        family: asset.family,
        fileName: asset.fileName,
        licenseFileName: asset.licenseFileName,
        bytes: new Uint8Array(fontBuffer),
        licenseText,
      };
    }),
  );
  return { fonts };
}
export function toEmbeddedObservationFontBundle(
  bundle: ObservationFontBundle,
): EmbeddedObservationFontBundle {
  return {
    fonts: bundle.fonts.map((font) => ({
      family: font.family,
      dataUrl: `data:font/woff2;base64,${bytesToBase64(font.bytes)}`,
      licenseText: font.licenseText,
    })),
  };
}
export async function loadEmbeddedObservationFontBundle(
  fetchValue: typeof fetch = fetch,
): Promise<EmbeddedObservationFontBundle> {
  return toEmbeddedObservationFontBundle(
    await loadObservationFontBundle(fetchValue),
  );
}
export function createPlaceholderEmbeddedObservationFontBundle(): EmbeddedObservationFontBundle {
  return {
    fonts: OBSERVATION_FONTS.map((family) => ({
      family,
      dataUrl: 'data:font/woff2;base64,',
      licenseText: '',
    })),
  };
}

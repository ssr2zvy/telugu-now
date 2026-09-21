import type { ExportResponse } from '../../shared/contracts';
import type { ExportFormat } from './export-artifact';
import { bytesToBase64 } from './font-assets';

export interface ExportAudioAsset {
  path: string;
  mimeType: string;
  bytes: Uint8Array;
}

export async function prepareExportAudio(result: ExportResponse, format: ExportFormat): Promise<{
  result: ExportResponse;
  assets: ExportAudioAsset[];
}> {
  const assets: ExportAudioAsset[] = [];
  const urls = new Map<string, string>();
  for (const entry of result.entries) {
    if (!entry.audio || urls.has(entry.audio.url)) continue;
    if (format === 'epub' && !entry.audio.url.startsWith('/api/audio/')) {
      throw new Error('EPUB audio must reference a corpus audio object');
    }
    const url = format === 'epub' ? entry.audio.url.replace('/api/audio/', '/api/export-audio/') : entry.audio.url;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to ${format === 'epub' ? 'convert EPUB' : 'load export'} audio: ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error('Export audio is empty');
    const mimeType = format === 'epub' ? 'audio/mpeg' : entry.audio.mimeType;
    if (format === 'epub' && response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== mimeType) {
      throw new Error('EPUB audio conversion did not return MP3 audio');
    }
    const extensions: Record<string, string> = {
      'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac',
      'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'webm',
    };
    const extension = extensions[mimeType];
    if (!extension) throw new Error(`Unsupported export audio type: ${mimeType}`);
    const path = `audio/clip-${assets.length + 1}.${extension}`;
    assets.push({ path, mimeType, bytes });
    urls.set(entry.audio.url, format === 'epub' ? path : `data:${mimeType};base64,${bytesToBase64(bytes)}`);
  }
  return {
    result: {
      ...result,
      entries: result.entries.map(entry => ({
        ...entry,
        audio: entry.audio ? {
          ...entry.audio, url: urls.get(entry.audio.url)!,
          mimeType: format === 'epub' ? 'audio/mpeg' : entry.audio.mimeType,
        } : null,
      })),
    },
    assets,
  };
}
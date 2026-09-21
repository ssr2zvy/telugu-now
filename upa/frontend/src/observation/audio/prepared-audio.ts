import { WAVEFORM_PEAKS_PER_SECOND } from './magnifier-waveform';
import { computeNormalizationGain, type DecodedAudioLike } from './audio-normalization';
import { AUDIO_LEAD_IN_SECONDS } from './silent-lead-in';
import { reportClientTelemetry } from '../../api';

export const toPlayerTime = (time: number) => Math.round((time + AUDIO_LEAD_IN_SECONDS) * 1e6) / 1e6;
export const toSpeechTime = (time: number) => Math.max(0, Math.round((time - AUDIO_LEAD_IN_SECONDS) * 1e6) / 1e6);

export interface PreparedAudio {
  url: string;
  duration: number;
  waveformPeaks: number[];
  bytes: number;
}

const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_CLIP_BYTES = 16 * 1024 * 1024;

class AudioPreparationError extends Error {
  constructor(readonly category: string, message: string) {
    super(message);
    this.name = 'AudioPreparationError';
  }
}

export function audioPreparationFailureCategory(error: unknown): string {
  if (error instanceof AudioPreparationError) return error.category;
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  if (error instanceof DOMException && error.name === 'EncodingError') return 'decode-failed';
  return 'audio-preparation-failed';
}

export function parseAudioSegmentUrl(url: string): { requestUrl: string; startSeconds: number; endSeconds: number } | null {
  const match = /#t=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/u.exec(url);
  if (!match) return null;
  const startSeconds = Number(match[1]);
  const endSeconds = Number(match[2]);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) return null;
  return { requestUrl: url.slice(0, match.index), startSeconds, endSeconds };
}

export function cropDecodedAudio(
  buffer: DecodedAudioLike & { sampleRate: number },
  startSeconds: number,
  endSeconds: number,
): DecodedAudioLike & { sampleRate: number } {
  const start = Math.max(0, Math.min(buffer.length, Math.floor(startSeconds * buffer.sampleRate)));
  const end = Math.max(start + 1, Math.min(buffer.length, Math.ceil(endSeconds * buffer.sampleRate)));
  if (start >= buffer.length || end <= start) throw new AudioPreparationError('invalid-alignment', 'Audio alignment segment is outside the recording.');
  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    length: end - start,
    getChannelData: channel => buffer.getChannelData(channel).subarray(start, end),
  };
}

// Normalize only speech, then encode silence and speech into one native timeline.
export function encodePreparedAudio(buffer: DecodedAudioLike & { sampleRate: number }) {
  const { sampleRate, numberOfChannels: channels, length } = buffer;
  if (!Number.isInteger(sampleRate) || sampleRate % 2 || sampleRate < 8000 ||
      !Number.isInteger(channels) || channels < 1 || channels > 2 || !Number.isInteger(length) || length <= 0 || length / sampleRate > 120) {
    throw new AudioPreparationError('unsupported-audio', 'Audio exceeds the supported two-channel, two-minute clip limits.');
  }
  const silentFrames = sampleRate * AUDIO_LEAD_IN_SECONDS;
  const frames = length + silentFrames;
  const size = 44 + frames * channels * 2;
  if (size > MAX_CLIP_BYTES) throw new AudioPreparationError('prepared-clip-oversized', 'Prepared audio is too large.');
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, 'RIFF');
  view.setUint32(4, size - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, size - 44, true);
  const gain = computeNormalizationGain(buffer);
  const peakCount = Math.max(1, Math.ceil(frames / sampleRate * WAVEFORM_PEAKS_PER_SECOND));
  const waveformPeaks = new Array<number>(peakCount).fill(0);
  for (let channel = 0; channel < channels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < length; index++) {
      const sample = Math.max(-1, Math.min(1, (samples[index] ?? 0) * gain));
      const pcm = Number.isFinite(sample) ? Math.round(sample * (sample < 0 ? 32768 : 32767)) : 0;
      const frame = index + silentFrames;
      view.setInt16(44 + (frame * channels + channel) * 2, pcm, true);
      const bucket = Math.min(peakCount - 1, Math.floor(frame * peakCount / frames));
      waveformPeaks[bucket] = Math.max(waveformPeaks[bucket]!, Math.abs(pcm));
    }
  }
  const peak = Math.max(1, ...waveformPeaks);
  return { bytes, duration: frames / sampleRate, waveformPeaks: waveformPeaks.map(value => value / peak) };
}

let decoder: AudioContext | undefined;
type ProgressListener = (progress: number) => void;

async function prepareAudio(url: string, signal: AbortSignal, onProgress: ProgressListener = () => {}): Promise<PreparedAudio> {
  const segment = parseAudioSegmentUrl(url);
  onProgress(.02);
  const response = await fetch(segment?.requestUrl ?? url, { signal });
  if (!response.ok) throw new AudioPreparationError(response.status === 404 ? 'http-404' : response.status >= 500 ? 'http-5xx' : 'http-error', `Audio download failed (${response.status}).`);
  if (Number(response.headers.get('content-length')) > MAX_INPUT_BYTES) throw new AudioPreparationError('input-oversized', 'Audio download is too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new AudioPreparationError('empty-response', 'Audio download is unavailable.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const expectedBytes = Number(response.headers.get('content-length'));
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INPUT_BYTES) throw new AudioPreparationError('input-oversized', 'Audio download is too large.');
      chunks.push(value);
      onProgress(Number.isFinite(expectedBytes) && expectedBytes > 0
        ? .05 + Math.min(1, size / expectedBytes) * .6
        : .05 + Math.min(.6, size / MAX_INPUT_BYTES * .6));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const input = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const Context = window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) throw new AudioPreparationError('unsupported-browser', 'This browser cannot prepare audio.');
  // Decoding works while suspended. Never route native playback into this context.
  decoder ??= new Context({ sampleRate: 24000 });
  onProgress(.7);
  const decoded = await decoder.decodeAudioData(input.buffer);
  signal.throwIfAborted();
  onProgress(.84);
  const result = encodePreparedAudio(segment ? cropDecodedAudio(decoded, segment.startSeconds, segment.endSeconds) : decoded);
  signal.throwIfAborted();
  onProgress(.96);
  return {
    url: URL.createObjectURL(new Blob([result.bytes], { type: 'audio/wav' })),
    duration: result.duration,
    waveformPeaks: result.waveformPeaks,
    bytes: result.bytes.byteLength,
  };
}

type Entry = {
  key: string;
  refs: number;
  active: number;
  order: number;
  state: 'queued' | 'loading' | 'ready' | 'failed';
  controller: AbortController;
  value?: PreparedAudio;
  promise: Promise<PreparedAudio>;
  progress: number;
  progressListeners: Set<ProgressListener>;
  resolve: (value: PreparedAudio) => void;
  reject: (error: unknown) => void;
  startedAt?: number;
  failureReported?: boolean;
};

export interface AudioLease {
  ready: Promise<PreparedAudio>;
  value: () => PreparedAudio | undefined;
  progress: () => number;
  subscribeProgress: (listener: ProgressListener) => () => void;
  release: () => void;
}

export class PreparedAudioCache {
  private entries = new Map<string, Entry>();
  private running = new Set<Entry>();
  private sequence = 0;
  constructor(
    private prepare = prepareAudio,
    private revoke = (url: string) => URL.revokeObjectURL(url),
    private maxBytes = 64 * 1024 * 1024,
    private maxEntries = 6,
    private timeoutMs = 30_000,
  ) {}

  acquire(key: string, priority: 'active' | 'warm' = 'active', retry = false): AudioLease {
    let entry = this.entries.get(key);
    if (entry?.state === 'failed' && retry) {
      this.remove(entry);
      entry = undefined;
    }
    if (!entry) {
      let resolve!: Entry['resolve'];
      let reject!: Entry['reject'];
      const promise = new Promise<PreparedAudio>((yes, no) => { resolve = yes; reject = no; });
      void promise.catch(() => {});
      entry = { key, refs: 0, active: 0, order: ++this.sequence, state: 'queued', progress: 0, progressListeners: new Set(),
        controller: new AbortController(), promise, resolve, reject };
      this.entries.set(key, entry);
    }
    const owned = entry;
    owned.refs++;
    if (priority === 'active') owned.active++;
    owned.order = ++this.sequence;
    this.trim();
    this.pump();
    let released = false;
    return {
      ready: owned.promise,
      value: () => owned.value,
      progress: () => owned.progress,
      subscribeProgress: listener => {
        owned.progressListeners.add(listener);
        listener(owned.progress);
        return () => owned.progressListeners.delete(listener);
      },
      release: () => {
        if (released) return;
        released = true;
        owned.refs--;
        if (priority === 'active') owned.active--;
        if (!owned.refs && (owned.state === 'queued' || owned.state === 'loading')) this.remove(owned);
        this.trim();
        this.pump();
      },
    };
  }

  private remove(entry: Entry) {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    entry.controller.abort();
    entry.reject(new DOMException('Audio preparation cancelled.', 'AbortError'));
    if (entry.value) { this.revoke(entry.value.url); delete entry.value; }
  }

  private trim(incomingBytes = 0) {
    const bytes = () => [...this.entries.values()].reduce((sum, e) => sum + (e.value?.bytes ?? 0), incomingBytes);
    for (const entry of [...this.entries.values()].sort((a, b) => a.order - b.order)) {
      if (bytes() <= this.maxBytes && this.entries.size <= this.maxEntries) break;
      if (!entry.refs) this.remove(entry);
    }
    return bytes() <= this.maxBytes;
  }

  private pump() {
    const candidates = [...this.entries.values()].filter(e => e.state === 'queued' && e.refs)
      .sort((a, b) => Number(b.active > 0) - Number(a.active > 0) || a.order - b.order);
    for (const entry of candidates) {
      if (this.running.size >= 2) break;
      // Reserve a slot for a cold current clip; speculative downloads stay serial.
      if (!entry.active && [...this.running].some(running => !running.active)) continue;
      entry.state = 'loading';
      entry.startedAt = Date.now();
      this.running.add(entry);
      const timer = setTimeout(() => {
        entry.controller.abort();
        entry.state = 'failed';
        entry.failureReported = true;
        reportClientTelemetry({
          event: 'observation_audio_failed',
          stage: 'preparation',
          failureCategory: 'timeout',
          durationMs: Date.now() - (entry.startedAt ?? Date.now()),
        });
        entry.reject(new Error('Audio preparation timed out.'));
      }, this.timeoutMs);
      void this.prepare(entry.key, entry.controller.signal, progress => {
        entry.progress = Math.max(entry.progress, Math.min(1, progress));
        for (const listener of entry.progressListeners) listener(entry.progress);
      }).then(value => {
        if (entry.controller.signal.aborted || this.entries.get(entry.key) !== entry) {
          this.revoke(value.url);
          return;
        }
        if (!this.trim(value.bytes)) {
          this.revoke(value.url);
          throw new AudioPreparationError('cache-capacity-exhausted', 'Audio cache is full.');
        }
        entry.value = value;
        entry.state = 'ready';
        entry.progress = 1;
        for (const listener of entry.progressListeners) listener(1);
        entry.resolve(value);
      }).catch(error => {
        entry.controller.abort();
        entry.state = 'failed';
        const category = audioPreparationFailureCategory(error);
        if (!entry.failureReported && category !== 'cancelled') {
          entry.failureReported = true;
          reportClientTelemetry({
            event: 'observation_audio_failed',
            stage: 'preparation',
            failureCategory: category,
            durationMs: Date.now() - (entry.startedAt ?? Date.now()),
          });
        }
        entry.reject(error);
      }).finally(() => {
        clearTimeout(timer);
        this.running.delete(entry);
        this.trim();
        this.pump();
      });
    }
  }
}

export const preparedAudioCache = new PreparedAudioCache();

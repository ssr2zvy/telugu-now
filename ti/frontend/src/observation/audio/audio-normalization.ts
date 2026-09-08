// A minimal structural subset of the DOM AudioBuffer interface, so this pure
// math can run identically against a real AudioBuffer or a plain test fixture.
export interface DecodedAudioLike {
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

export const AUDIO_NORMALIZATION = {
  // Target root-mean-square amplitude every clip is normalized toward.
  targetRms: 0.1,
  minGain: 0.3,
  maxGain: 3,
  waveformBucketCount: 120,
} as const;

export function computeRmsLoudness(buffer: DecodedAudioLike): number {
  let sumSquares = 0;
  let sampleCount = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const sample = data[index] ?? 0;
      sumSquares += sample * sample;
      sampleCount += 1;
    }
  }
  return sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
}

export function computeNormalizationGain(
  buffer: DecodedAudioLike,
  targetRms: number = AUDIO_NORMALIZATION.targetRms,
  minGain: number = AUDIO_NORMALIZATION.minGain,
  maxGain: number = AUDIO_NORMALIZATION.maxGain,
): number {
  const measuredRms = computeRmsLoudness(buffer);
  if (!(measuredRms > 0)) return 1;
  return Math.min(maxGain, Math.max(minGain, targetRms / measuredRms));
}

// Per-bucket peak amplitude across the whole clip (all channels combined),
// normalized to [0, 1], used to render the scrubber's waveform silhouette.
export function computeWaveformPeaks(
  buffer: DecodedAudioLike,
  bucketCount: number = AUDIO_NORMALIZATION.waveformBucketCount,
): number[] {
  const buckets = Math.max(1, Math.floor(bucketCount));
  const peaks = new Array<number>(buckets).fill(0);
  if (buffer.length === 0 || buffer.numberOfChannels === 0) return peaks;

  const samplesPerBucket = Math.max(1, Math.floor(buffer.length / buckets));
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const start = bucket * samplesPerBucket;
      const end = bucket === buckets - 1 ? data.length : Math.min(data.length, start + samplesPerBucket);
      let peak = peaks[bucket] ?? 0;
      for (let index = start; index < end; index += 1) {
        const magnitude = Math.abs(data[index] ?? 0);
        if (magnitude > peak) peak = magnitude;
      }
      peaks[bucket] = peak;
    }
  }

  const maxPeak = Math.max(...peaks, 1e-6);
  return peaks.map((value) => value / maxPeak);
}

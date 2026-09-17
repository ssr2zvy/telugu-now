function audioContextConstructor(): typeof AudioContext | null {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null;
}

function encodeWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const bytes = new ArrayBuffer(44 + buffer.length * channels * 2);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, bytes.byteLength - 44, true);
  const samples = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, samples[channel]![frame] ?? 0));
      view.setInt16(44 + (frame * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export async function overwriteRecordingAtCursor(existingUrl: string | null, recording: Blob, cursorSeconds: number): Promise<Blob> {
  if (!existingUrl || cursorSeconds <= 0) return recording;
  const Context = audioContextConstructor();
  if (!Context) return recording;
  const context = new Context();
  try {
    const [existingResponse, recordingBytes] = await Promise.all([
      fetch(existingUrl, { cache: 'no-store' }),
      recording.arrayBuffer(),
    ]);
    if (!existingResponse.ok) return recording;
    const [existing, replacement] = await Promise.all([
      context.decodeAudioData(await existingResponse.arrayBuffer()),
      context.decodeAudioData(recordingBytes),
    ]);
    const prefixFrames = Math.min(existing.length, Math.max(0, Math.round(cursorSeconds * existing.sampleRate)));
    const channels = Math.min(2, Math.max(existing.numberOfChannels, replacement.numberOfChannels));
    const merged = context.createBuffer(channels, prefixFrames + replacement.length, existing.sampleRate);
    for (let channel = 0; channel < channels; channel += 1) {
      const output = merged.getChannelData(channel);
      output.set(existing.getChannelData(Math.min(channel, existing.numberOfChannels - 1)).subarray(0, prefixFrames));
      output.set(replacement.getChannelData(Math.min(channel, replacement.numberOfChannels - 1)), prefixFrames);
    }
    return encodeWav(merged);
  } finally {
    void context.close();
  }
}

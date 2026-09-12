export const AUDIO_LEAD_IN_SECONDS = 0.5;

export function silentLeadInWav(): Uint8Array {
  const sampleRate = 8000;
  const dataLength = sampleRate * AUDIO_LEAD_IN_SECONDS * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataLength, true);
  return bytes;
}

let silentUrl: string | undefined;
export function silentLeadInUrl(): string {
  silentUrl ??= `data:audio/wav;base64,${btoa(String.fromCharCode(...silentLeadInWav()))}`;
  return silentUrl;
}

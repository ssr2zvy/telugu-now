import { useCallback, useEffect, useRef, useState } from 'react';

export interface AnswerRecording {
  url: string;
  durationSeconds: number;
}

function encodeWav(channel: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + channel.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + channel.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, channel.length * 2, true);
  for (let index = 0; index < channel.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, channel[index] ?? 0));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function decode(context: AudioContext, blob: Blob): Promise<Float32Array> {
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const data = decoded.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) mono[index] = (mono[index] ?? 0) + (data[index] ?? 0) / decoded.numberOfChannels;
  }
  return mono;
}

/**
 * Records the user's spoken answer. Recording again does not discard the take:
 * it keeps everything before the current playhead and continues from there, so
 * the user can repair the tail of an answer.
 */
export function useAnswerRecorder() {
  const [recording, setRecording] = useState(false);
  const [answer, setAnswer] = useState<AnswerRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const keepRef = useRef<Float32Array | null>(null);
  const sampleRateRef = useRef(48000);
  const urlRef = useRef<string | null>(null);

  const publish = useCallback((blob: Blob, durationSeconds: number) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(blob);
    setAnswer({ url: urlRef.current, durationSeconds });
  }, []);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    recorderRef.current?.stream.getTracks().forEach(track => track.stop());
  }, []);

  const start = useCallback(async (fromSeconds: number) => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext();
      sampleRateRef.current = context.sampleRate;
      // Everything before the playhead survives; the new take replaces the rest.
      keepRef.current = answer && fromSeconds > 0
        ? (await decode(context, await (await fetch(answer.url)).blob())).slice(0, Math.floor(fromSeconds * context.sampleRate))
        : null;
      void context.close();
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const captured = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const merge = async () => {
          const context2 = new AudioContext();
          try {
            const fresh = await decode(context2, captured);
            const keep = keepRef.current;
            const rate = context2.sampleRate;
            const combined = new Float32Array((keep?.length ?? 0) + fresh.length);
            if (keep) combined.set(keep, 0);
            combined.set(fresh, keep?.length ?? 0);
            publish(encodeWav(combined, rate), combined.length / rate);
          } catch {
            setError('Could not process the recording.');
          } finally {
            void context2.close();
          }
        };
        void merge();
        setRecording(false);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Microphone permission is required to answer.');
      setRecording(false);
    }
  }, [answer, publish]);

  const stop = useCallback(() => {
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
  }, []);

  return { recording, answer, error, start, stop };
}

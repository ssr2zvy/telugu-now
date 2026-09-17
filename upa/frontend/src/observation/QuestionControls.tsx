import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CircleDot, Mic } from 'lucide-react';
import type { ObservationAudio, QuestionKeyboard, QuestionMode } from '../../../shared/contracts';
import { appearanceAudioGlass, useAppearance } from '../appearance';
import { updateQuestionAudio, updateQuestionText } from '../api';
import { GoogleTeluguKeyboard } from './GoogleTeluguKeyboard';
import type { RecordingTimeline } from './audio/AudioScrubber';

interface QuestionControlsProps {
  profileCode: string;
  observationId: string;
  mode: QuestionMode;
  keyboard: QuestionKeyboard | null;
  visible: boolean;
  initialText: string;
  beginRecording: () => number;
  durationSeconds: () => number;
  onAudioSaved: (audio: ObservationAudio) => void;
  onRecordingChange: (range: RecordingTimeline | null) => void;
  onSubmit: () => void;
}

const singleLineAnswer = (value: string) => value.replace(/\r\n?|\n/g, ' ');

export function QuestionControls({ profileCode, observationId, mode, keyboard: _keyboard, visible, initialText, beginRecording, durationSeconds, onAudioSaved, onRecordingChange, onSubmit }: QuestionControlsProps) {
  const { appearance } = useAppearance();
  const paintId = `record-glass-${useId().replace(/:/g, '')}`;
  const glass = useMemo(() => appearanceAudioGlass(appearance), [appearance.gradient]);
  const [text, setText] = useState(() => singleLineAnswer(initialText));
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordCursor = useRef(0);
  const recordingFrame = useRef<number | null>(null);
  const recordingSession = useRef(0);
  const preRoll = useRef<{ timer: number; resolve: () => void } | null>(null);
  const dirtyText = useRef(false);
  const latestText = useRef(singleLineAnswer(initialText));
  const textObservationId = useRef(observationId);
  useEffect(() => {
    if (textObservationId.current === observationId) return;
    textObservationId.current = observationId;
    const nextText = singleLineAnswer(initialText);
    setText(nextText);
    latestText.current = nextText;
    dirtyText.current = false;
  }, [observationId, initialText]);

  useEffect(() => {
    if (!dirtyText.current) return;
    const timer = window.setTimeout(() => {
      dirtyText.current = false;
      void updateQuestionText(profileCode, observationId, { text }).catch(() => { dirtyText.current = true; setError(true); });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text, profileCode, observationId]);

  useEffect(() => () => {
    if (dirtyText.current) void updateQuestionText(profileCode, observationId, { text: latestText.current }).catch(() => {});
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recordingSession.current += 1;
    if (preRoll.current) { window.clearTimeout(preRoll.current.timer); preRoll.current.resolve(); preRoll.current = null; }
    stream.current?.getTracks().forEach(track => track.stop());
    if (recordingFrame.current !== null) cancelAnimationFrame(recordingFrame.current);
    onRecordingChange(null);
  }, [profileCode, observationId]);

  const changeText = (value: string) => {
    const nextText = singleLineAnswer(value);
    setError(false);
    dirtyText.current = true;
    latestText.current = nextText;
    setText(nextText);
  };
  const submitText = useCallback(async () => {
    if (dirtyText.current) {
      dirtyText.current = false;
      try {
        await updateQuestionText(profileCode, observationId, { text: latestText.current });
      } catch {
        dirtyText.current = true;
        setError(true);
        return;
      }
    }
    onSubmit();
  }, [profileCode, observationId, onSubmit]);
  useEffect(() => {
    if (mode !== 'audio-given') return;
    const submitFromPhysicalKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      void submitText();
    };
    window.addEventListener('keydown', submitFromPhysicalKeyboard, true);
    return () => window.removeEventListener('keydown', submitFromPhysicalKeyboard, true);
  }, [mode, submitText]);

  const stopRecording = () => {
    recordingSession.current += 1;
    if (preRoll.current) { window.clearTimeout(preRoll.current.timer); preRoll.current.resolve(); preRoll.current = null; }
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return; }
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    recorder.current = null;
    if (recordingFrame.current !== null) cancelAnimationFrame(recordingFrame.current);
    recordingFrame.current = null;
    onRecordingChange(null);
    setRecording(false);
  };
  const startRecording = async () => {
    if (recording) { stopRecording(); return; }
    setError(false);
    const session = ++recordingSession.current;
    recordCursor.current = beginRecording();
    const recordingSpan = Math.max(10, durationSeconds());
    onRecordingChange({ start: recordCursor.current, end: recordCursor.current, span: recordingSpan });
    setRecording(true);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session !== recordingSession.current) { mediaStream.getTracks().forEach(track => track.stop()); return; }
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const mediaRecorder = preferred ? new MediaRecorder(mediaStream, { mimeType: preferred }) : new MediaRecorder(mediaStream);
      stream.current = mediaStream;
      recorder.current = mediaRecorder;
      chunks.current = [];
      await new Promise<void>(resolve => {
        const timer = window.setTimeout(() => { preRoll.current = null; resolve(); }, 500);
        preRoll.current = { timer, resolve };
      });
      if (session !== recordingSession.current) return;
      const recordingStartedAt = performance.now();
      const updateRecordingFeedback = (now: number) => {
        const elapsed = (now - recordingStartedAt) / 1000;
        onRecordingChange({ start: recordCursor.current, end: recordCursor.current + elapsed, span: recordingSpan });
        recordingFrame.current = requestAnimationFrame(updateRecordingFeedback);
      };
      mediaRecorder.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      mediaRecorder.onstop = () => {
        if (recordingFrame.current !== null) cancelAnimationFrame(recordingFrame.current);
        recordingFrame.current = null;
        onRecordingChange(null);
        const raw = new Blob(chunks.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        mediaStream.getTracks().forEach(track => track.stop());
        stream.current = null;
        recorder.current = null;
        setRecording(false);
        void updateQuestionAudio(profileCode, observationId, raw).then(() => {
          const responseUrl = `/api/profiles/${encodeURIComponent(profileCode)}/questions/${encodeURIComponent(observationId)}/audio`;
          onAudioSaved({ url: `${responseUrl}?v=${Date.now()}`, mimeType: raw.type, durationSeconds: 0 });
        }).catch(() => setError(true));
      };
      mediaRecorder.start();
      recordingFrame.current = requestAnimationFrame(updateRecordingFeedback);
    } catch {
      if (session === recordingSession.current) { stopRecording(); setError(true); }
    }
  };

  if (mode === 'text-given') return <div className="question-controls question-record-controls" data-visible={visible} aria-hidden={!visible} style={{
    '--audio-icon-paint': `url(#${paintId})`,
    '--audio-glass-gradient': glass.gradient,
    '--audio-glass-edge': glass.edge,
  } as CSSProperties}>
    <svg className="audio-paint-definitions" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={paintId} x1="0%" y1="0%" x2="100%" y2="100%">
          {glass.stops.map(stop => <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />)}
        </linearGradient>
      </defs>
    </svg>
    <button type="button" className="audio-transport-button question-record-button" aria-label={recording ? 'Stop recording' : 'Record'} aria-pressed={recording} disabled={!visible} onClick={(event) => { event.stopPropagation(); void startRecording(); }}>{recording ? <CircleDot className="control-icon" aria-hidden="true" /> : <Mic className="control-icon" aria-hidden="true" />}</button>
    {error ? <div className="question-response-error" role="alert">Recording could not be saved.</div> : null}
  </div>;

  return <div className="question-controls question-keyboard-controls" data-visible={visible} aria-hidden={!visible} inert={!visible}>
    <GoogleTeluguKeyboard value={text} onChange={changeText} onSubmit={() => { void submitText(); }} />
    {error ? <div className="question-response-error" role="alert">Answer could not be saved.</div> : null}
  </div>;
}

import { useCallback, useImperativeHandle, type Ref, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CircleDot, Mic } from 'lucide-react';
import type { ObservationAudio, QuestionKeyboard, QuestionMode } from '../../../shared/contracts';
import { appearanceAudioGlass, useAppearance } from '../appearance';
import { reportClientTelemetry, updateQuestionAudio, updateQuestionText } from '../api';
import { GoogleTeluguKeyboard } from './GoogleTeluguKeyboard';
import type { RecordingTimeline } from './audio/AudioScrubber';

export interface QuestionControlsHandle { prepareToLeave: () => Promise<boolean>; canExplore: () => boolean }

interface QuestionControlsProps {
  ref?: Ref<QuestionControlsHandle>;
  profileCode: string;
  observationId: string;
  mode: QuestionMode;
  keyboard: QuestionKeyboard | null;
  visible: boolean;
  initialText: string;
  fontFamily?: string;
  beginRecording: () => number;
  durationSeconds: () => number;
  onAudioSaved: (audio: ObservationAudio) => void;
  onRecordingChange: (range: RecordingTimeline | null) => void;
  onSubmit: () => void;
}

const singleLineAnswer = (value: string) => value.replace(/\r\n?|\n/g, ' ');

function recordingErrorMessage(error: unknown): string {
  if (!window.isSecureContext) return 'Microphone access requires a secure HTTPS connection.';
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser does not provide microphone access.';
  if (typeof MediaRecorder === 'undefined') return 'This browser cannot record audio.';
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return 'Microphone permission was denied. Allow microphone access in browser settings and try again.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No microphone was found.';
  return 'Recording could not be started.';
}

function recordingFailureCategory(error: unknown): string {
  if (!window.isSecureContext) return 'insecure-context';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported-browser';
  if (typeof MediaRecorder === 'undefined') return 'media-recorder-unavailable';
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) return 'permission-denied';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'no-microphone';
  return 'recording-creation-failed';
}

export function QuestionControls({ ref, profileCode, observationId, mode, keyboard: _keyboard, visible, initialText, fontFamily, beginRecording, durationSeconds, onAudioSaved, onRecordingChange, onSubmit }: QuestionControlsProps) {
  const { appearance } = useAppearance();
  const paintId = `record-glass-${useId().replace(/:/g, '')}`;
  const glass = useMemo(() => appearanceAudioGlass(appearance), [appearance.gradient]);
  const [text, setText] = useState(() => singleLineAnswer(initialText));
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestingMicrophone, setRequestingMicrophone] = useState(false);
  const savePending = useRef<Promise<boolean> | null>(null);
  const finishSave = useRef<((saved: boolean) => void) | null>(null);
  const saveFailed = useRef(false);
  const failedRecording = useRef<Blob | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recordCursor = useRef(0);
  const recordingFrame = useRef<number | null>(null);
  const recordingSession = useRef(0);
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
      void updateQuestionText(profileCode, observationId, { text }).catch(() => { dirtyText.current = true; setError('Answer could not be saved.'); });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text, profileCode, observationId]);

  useEffect(() => () => {
    if (dirtyText.current) void updateQuestionText(profileCode, observationId, { text: latestText.current }).catch(() => {});
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recordingSession.current += 1;
    stream.current?.getTracks().forEach(track => track.stop());
    if (recordingFrame.current !== null) cancelAnimationFrame(recordingFrame.current);
    onRecordingChange(null);
  }, [profileCode, observationId]);

  const changeText = (value: string) => {
    const nextText = singleLineAnswer(value);
    setError(null);
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
        setError('Answer could not be saved.');
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
    setRequestingMicrophone(false);
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return; }
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    recorder.current = null;
    if (recordingFrame.current !== null) cancelAnimationFrame(recordingFrame.current);
    recordingFrame.current = null;
    onRecordingChange(null);
    setRecording(false);
  };
  useImperativeHandle(ref, () => ({ canExplore: () => !recording && !requestingMicrophone && !savePending.current, prepareToLeave: async () => {
    if (requestingMicrophone) return false;
    if (recorder.current?.state === 'recording') stopRecording();
    if (savePending.current) return savePending.current;
    return !saveFailed.current;
  }}));
  const persistRecording = async (raw: Blob): Promise<boolean> => {
    try {
      if (!raw.size) throw new Error('No audio was captured. Record again.');
      await updateQuestionAudio(profileCode, observationId, raw);
      failedRecording.current = null; saveFailed.current = false;
      if (mounted.current) {
        setError(null);
        onAudioSaved({ url: `/api/profiles/${encodeURIComponent(profileCode)}/questions/${encodeURIComponent(observationId)}/audio?v=${Date.now()}`, mimeType: 'audio/wav', durationSeconds: 0 });
      }
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Recording could not be saved.';
      const retryable = raw.size > 0 && !/decoded|Unsupported|empty|two minutes|Evaluation is final|not found/i.test(message);
      failedRecording.current = retryable ? raw : null; saveFailed.current = true;
      if (mounted.current) setError(`${message}${retryable ? ' Tap record to retry saving.' : ''}`);
      reportClientTelemetry({event:'recording_failed',observationId,stage:'upload',failureCategory:'upload-rejected'});
      return false;
    }
  };
  const startRecording = async () => {
    if (recording) { stopRecording(); return; }
    if (requestingMicrophone || savePending.current) return;
    setError(null);
    if (failedRecording.current) {
      const retry = persistRecording(failedRecording.current);
      savePending.current = retry;
      try { await retry; } finally { savePending.current = null; }
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(recordingErrorMessage(null));
      reportClientTelemetry({
        event: 'recording_failed',
        observationId,
        stage: 'capability',
        failureCategory: recordingFailureCategory(null),
      });
      return;
    }
    const session = ++recordingSession.current;
    recordCursor.current = beginRecording();
    const recordingSpan = Math.max(10, durationSeconds());
    setRequestingMicrophone(true);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session !== recordingSession.current) {
        mediaStream.getTracks().forEach(track => track.stop());
        setRequestingMicrophone(false);
        return;
      }
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const mediaRecorder = preferred ? new MediaRecorder(mediaStream, { mimeType: preferred }) : new MediaRecorder(mediaStream);
      stream.current = mediaStream;
      recorder.current = mediaRecorder;
      saveFailed.current = false;
      savePending.current = new Promise(resolve => { finishSave.current = resolve; });
      const completeSave = (saved: boolean) => {
        saveFailed.current = !saved;
        finishSave.current?.(saved);
        finishSave.current = null;
        savePending.current = null;
      };
      const recordedChunks:Blob[]=[];
      let recordingStartedAt = 0;
      const updateRecordingFeedback = (now: number) => {
        const elapsed = (now - recordingStartedAt) / 1000;
        onRecordingChange({ start: recordCursor.current, end: recordCursor.current + elapsed, span: recordingSpan });
        recordingFrame.current = requestAnimationFrame(updateRecordingFeedback);
      };
      mediaRecorder.ondataavailable = event => { if (event.data.size) recordedChunks.push(event.data); };
      mediaRecorder.onstop = () => {
        if (recordingFrame.current !== null) cancelAnimationFrame(recordingFrame.current);
        recordingFrame.current = null;
        onRecordingChange(null);
        const raw = new Blob(recordedChunks, { type: mediaRecorder.mimeType || recordedChunks[0]?.type || preferred || 'audio/mp4' });
        mediaStream.getTracks().forEach(track => track.stop());
        stream.current = null;
        recorder.current = null;
        setRecording(false);
        void persistRecording(raw).then(completeSave);
      };
      mediaRecorder.onerror = () => {
        if (mounted.current) { setRequestingMicrophone(false); setError('Audio capture failed. Record again.'); }
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        else {
          mediaStream.getTracks().forEach(track => track.stop());
          if (recordingFrame.current !== null) cancelAnimationFrame(recordingFrame.current);
          recordingFrame.current = null;
          stream.current = null; recorder.current = null;
          onRecordingChange(null);
          if (mounted.current) setRecording(false);
          completeSave(false);
        }
      };
      mediaRecorder.onstart = () => {
        if (session !== recordingSession.current) return;
        recordingStartedAt = performance.now();
        setRequestingMicrophone(false);
        setRecording(true);
        onRecordingChange({ start: recordCursor.current, end: recordCursor.current, span: recordingSpan });
        recordingFrame.current = requestAnimationFrame(updateRecordingFeedback);
      };
      mediaRecorder.start(1000);
    } catch (caught) {
      finishSave.current?.(false);
      finishSave.current = null;
      savePending.current = null;
      setRequestingMicrophone(false);
      if (session === recordingSession.current) {
        reportClientTelemetry({
          event: 'recording_failed',
          observationId,
          stage: 'capture',
          failureCategory: recordingFailureCategory(caught),
        });
        stopRecording();
        setError(recordingErrorMessage(caught));
      }
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
    <button type="button" className="audio-transport-button question-record-button" aria-label={requestingMicrophone ? 'Requesting microphone access' : recording ? 'Stop recording' : 'Record'} aria-pressed={recording} disabled={!visible || requestingMicrophone} onClick={(event) => { event.stopPropagation(); void startRecording(); }}>{recording ? <CircleDot className="control-icon" aria-hidden="true" /> : <Mic className="control-icon" aria-hidden="true" />}</button>
    {error ? <div className="question-response-error" role="alert">{error}</div> : null}
  </div>;

  return <div className="question-controls question-keyboard-controls" data-visible={visible} aria-hidden={!visible} inert={!visible}>
    <GoogleTeluguKeyboard fontFamily={fontFamily} value={text} onChange={changeText} onSubmit={() => { void submitText(); }} />
    {error ? <div className="question-response-error" role="alert">{error}</div> : null}
  </div>;
}

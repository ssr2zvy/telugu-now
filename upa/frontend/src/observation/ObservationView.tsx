import { ExplorationSurface } from './ExplorationSurface';
import { explorationSteps, explorationIndex } from './exploration-steps';
import { useObservationTravel } from './useObservationTravel';
import { useGradientTravel } from '../GradientBackdrop';
import { gradientSwipeFraction, swipeChangesObservation } from './gradient-travel';
import { useReaderSettingsFade } from './useReaderSettingsFade';
import { readerNeedsLoadingDots } from './reader-loading';
import { useReaderSwipes } from './useReaderSwipes';
import { copyOriginalReaderText } from './reader-hyphenation';
import { GrammarEvaluation, type GrammarEvaluationHandle } from './GrammarEvaluation';
import {
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { ArrowRight, Settings } from 'lucide-react';
import type {
  ProfileStateResponse,
} from '../../../shared/contracts';
import {
  AudioPlayerBar,
  type AudioPlayerBarHandle,
} from './audio/AudioPlayerBar';
import type { RecordingTimeline } from './audio/AudioScrubber';
import {
  prewarmObservationTypography,
  useObservationTypography,
} from './useObservationTypography';
import { useObservationFontQueue } from './useObservationFontQueue';
import { WordProfile } from './word/WordProfile';
import { appearanceModificationColor, useAppearance } from '../appearance';
import { LoadingSlit } from '../components/LoadingSlit';
import { ReaderTaps, readerTapRegions } from './reader-taps';
import { type ScrollDirection } from './reader-scroll';
import { reportClientTelemetry } from '../api';
import { QuestionControls, type QuestionControlsHandle } from './QuestionControls';
import { teluguHighlightRuns } from './telugu-highlighting';
import { TeluguWordText } from './TeluguGradientText';
import { getTeluguGradientCacheSnapshot, hasTeluguGradientTexture, renderTeluguGradientTexture, type TeluguGradientTexture } from './telugu-gradient-renderer';
import { observationShowsText } from './observation-content';
import { visibleWordAtPoint } from './visible-glyph-hit-testing';
import type { VisibleGlyphHit } from './visible-glyph-hit-testing';
import { ComparisonPage } from './ComparisonPage';

function fontAvailability(fontFamily: string, text: string): boolean | null {
  try {
    return document.fonts.check(`400 24px "${fontFamily}"`, text.slice(0, 64));
  } catch {
    return null;
  }
}
interface ObservationViewProps {
  state: ProfileStateResponse | null;
  busy: boolean;
  navigationEvent: { sequence: number; direction: 'back' | 'next' } | null;
  onMove: (
    direction: 'back' | 'next',
  ) => Promise<boolean>;
  onOpenSettings: (fontFamily: string) => void;
}
interface ReaderPoint {
  clientX: number;
  clientY: number;
  target: EventTarget;
}
export function ObservationView({
  state,
  busy,
  navigationEvent,
  onMove,
  onOpenSettings,
}: ObservationViewProps) {
  const { appearance } = useAppearance();
  const gradientTravel = useGradientTravel();
  const [
    controlsVisible,
    setControlsVisible,
  ] = useState(false);
  const [audioMotion, setAudioMotion] = useState<'idle' | 'enter' | 'exit'>('idle');
  const [audioMotionDirection, setAudioMotionDirection] = useState<ScrollDirection>(1);
  const [precisionInteraction, setPrecisionInteraction] = useState(0);
  const [audioReadiness, setAudioReadiness] = useState<{ key: string; loading: boolean; progress: number } | null>(null);
  const seamlessAudioKey = useRef<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const questionControlsRef = useRef<QuestionControlsHandle>(null);
  const evaluationRef=useRef<GrammarEvaluationHandle>(null);
  const evaluationNavigation=useRef(false);
  const [phaseMotion, setPhaseMotion] = useState<'idle' | 'exit' | 'enter'>('idle');
  const phaseDirection = useRef<'back' | 'next'>('next');
  const evaluationDrafts = useRef(new Map<string, boolean>());
  const [comparisonReady, setComparisonReady] = useState(false);
  const [responseAudio, setResponseAudio] = useState(state?.currentObservation?.question?.responseAudio ?? null);
  const [recordingRange, setRecordingRange] = useState<RecordingTimeline | null>(null);
  const [selectedWord, setSelectedWord] = useState<{ word: string; start: number; end: number; observationId: string; grapheme?: {text:string;start:number;end:number} } | null>(null);
  const [gradientPresentation, setGradientPresentation] = useState<{
    key: string;
    textures: Array<TeluguGradientTexture | null>;
  } | null>(null);
  const [gradientProgress, setGradientProgress] = useState<{ key: string; completed: number; total: number } | null>(null);
  const screenRef = useRef<HTMLElement>(null);
  const settingsIdle = useReaderSettingsFade(screenRef);
  const playerRef = useRef<AudioPlayerBarHandle>(null);
  const [taps] = useState(() => new ReaderTaps());
  const gesturePausedPlayback = useRef(false);
  const observationLoadStartedAt = useRef<number | null>(null);
  const questionPhase = state?.currentObservation?.kind === 'question' && state.currentObservation.question?.phase === 'question';
  const comparisonQuestionPhase = state?.currentObservation?.kind === 'question' && state.currentObservation.question?.phase === 'comparison';
  const textGivenFlow = state?.currentObservation?.question?.mode === 'text-given';
  const textComparison = textGivenFlow && comparisonQuestionPhase;
  const audioGivenQuestionPhase = questionPhase && state.currentObservation?.question?.mode === 'audio-given';
  useEffect(() => {
    const screen = screenRef.current;
    if (textGivenFlow || !controlsVisible || !screen) return;
    let idleTimer: number;
    const activePointers = new Set<number>();
    const scheduleHide = (event?: Event) => {
      window.clearTimeout(idleTimer);
      if (event instanceof PointerEvent) {
        if (event.type === 'pointerdown') activePointers.add(event.pointerId);
        if (event.type === 'pointerup' || event.type === 'pointercancel' || event.type === 'lostpointercapture') activePointers.delete(event.pointerId);
      }
      if (activePointers.size > 0) return;
      idleTimer = window.setTimeout(() => {
        setAudioMotion('exit');
        setControlsVisible(false);
      }, appearance.autoFadeSeconds * 1000);
    };
    const events = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave', 'keydown', 'focusin', 'focusout'];
    for (const event of events) screen.addEventListener(event, scheduleHide);
    scheduleHide();
    return () => {
      window.clearTimeout(idleTimer);
      for (const event of events) screen.removeEventListener(event, scheduleHide);
    };
  }, [controlsVisible, appearance.autoFadeSeconds, precisionInteraction, textGivenFlow]);
  const observation =
    state?.currentObservation ?? null;
  useEffect(() => {
    if (!observation) return;
    observationLoadStartedAt.current = performance.now();
    reportClientTelemetry({ event: 'observation_load_started', observationId: observation.id });
  }, [observation?.id]);
  const fontAssignments = useObservationFontQueue(state, appearance.fonts);
  const assignedFont = fontAssignments.find(assignment => assignment.id === observation?.id)?.fontFamily
    ?? 'Noto Sans Telugu';
  const steps = useMemo(() => explorationSteps(observation?.text ?? ''), [observation?.text]);
  const [exploration, setExploration] = useState<number | null>(null);
  const exploring = exploration !== null && Boolean(steps[exploration]);
  const activeQuestion = observation?.kind === 'question' && observation.question?.phase === 'question' ? observation.question : null;
  const comparisonPhase = comparisonQuestionPhase;
  const questionAudio = activeQuestion?.mode === 'text-given' ? responseAudio : observation?.audio ?? null;
  const visibleAudio = textComparison ? observation?.audio ?? null : comparisonPhase ? null : activeQuestion ? questionAudio : observation?.audio ?? null;
  const audioReadinessKey = observation && visibleAudio ? `${observation.id}\0${visibleAudio.url}` : null;
  const handleAudioLoadingChange = useCallback((key: string | null, loading: boolean, progress: number) => {
    if (!key) return;
    setAudioReadiness(current => current?.key === key && current.loading === loading && current.progress === progress
      ? current : { key, loading, progress });
  }, []);
  const audioControlsVisible = !exploring && (controlsVisible || Boolean(recordingRange));
  // Reset page-owned presentation before paint, including any old exit animation.
  useLayoutEffect(() => {
    taps.cancel();
    setExploration(null);
    seamlessAudioKey.current = null;
    setAudioError(null);
    setAudioMotion('idle');
    setPhaseMotion(textGivenFlow ? 'enter' : 'idle');
    playerRef.current?.dismissPrecision();
    setComparisonReady(false);
    setResponseAudio(observation?.question?.responseAudio ?? null);
    setRecordingRange(null);
    setControlsVisible(Boolean(questionPhase && textGivenFlow && observation?.question?.responseAudio) || Boolean(observation?.kind === 'question' && observation.question?.phase === 'question' && observation.question.mode === 'audio-given' && observation.audio));
    return () => taps.cancel();
  }, [taps, state?.profileCode, observation?.id, observation?.question?.phase, observation?.question?.mode, appearance.scrollMode]);
  const showsObservationText = observationShowsText(observation);
  const typography =
    useObservationTypography(
      observation,
      assignedFont,
      showsObservationText,
    );
  const presentationHighlightRuns = appearance.highlightMods && observation
    ? teluguHighlightRuns(observation.text)
    : null;
  const highlightRuns = showsObservationText ? presentationHighlightRuns : null;
  const gradientEndColor = appearanceModificationColor(appearance);
  // The rolling prewarm window covers every deck entry adjacent to the
  // current observation - the one behind and the one ahead - so that by the
  // time the user navigates either direction, its font, size-fit, and
  // (if enabled) gradient texture are already computed and cached.
  const neighborAssignments = fontAssignments.filter(assignment => assignment.id !== observation?.id);
  const [neighborPrewarmReadyIds, setNeighborPrewarmReadyIds] = useState<Set<string>>(new Set());
  const neighborKey = neighborAssignments.map(assignment => [assignment.id, assignment.fontFamily, assignment.text].join('\0')).join('\u0001');
  useEffect(() => {
    if (!neighborKey) {
      setNeighborPrewarmReadyIds(new Set());
      return;
    }
    let cancelled = false;
    const waitForIdle = () => new Promise<void>(resolve => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 250 });
      else window.setTimeout(resolve, 0);
    });
    const worker = async () => {
      for (const assignment of neighborAssignments) {
        if (cancelled) return;
        try {
          await waitForIdle();
          if (cancelled) return;
          await document.fonts.load(`400 220px "${assignment.fontFamily}"`, assignment.text.slice(0, 64));
          if (cancelled) return;
          const container = typography.containerRef.current;
          if (container) {
            const containerRect = container.getBoundingClientRect();
            const audioBounds = container.querySelector('.audio-player-bar[data-has-audio="true"]')?.getBoundingClientRect();
            await prewarmObservationTypography({
              id: assignment.id,
              text: assignment.text,
              fontFamily: assignment.fontFamily,
              fontScale: appearance.fontScale,
              textOffset: appearance.textOffset,
              containerRect: {
                left: containerRect.left,
                top: containerRect.top,
                width: containerRect.width,
                height: containerRect.height,
              },
              audioTop: audioBounds ? audioBounds.top : null,
            });
          }
          if (cancelled) return;
          if (appearance.highlightMods) {
            const runs = teluguHighlightRuns(assignment.text).filter(run => run.highlighted);
            for (const run of runs) {
              if (cancelled) return;
              await waitForIdle();
              if (cancelled) return;
              await renderTeluguGradientTexture(run.text, assignment.fontFamily, appearance.foreground, gradientEndColor, appearance.gradientBarrier);
            }
          }
        } catch {
          // The current observation can still fit or render this item on demand.
          if (!cancelled) reportClientTelemetry({
            event: 'observation_render_failed',
            observationId: assignment.id,
            stage: 'neighbor-prewarm',
            failureCategory: 'render-fallback',
          });
        } finally {
          if (!cancelled) setNeighborPrewarmReadyIds(current => {
            if (current.has(assignment.id)) return current;
            const next = new Set(current);
            next.add(assignment.id);
            return next;
          });
        }
      }
    };
    void worker().catch(() => {});
    return () => { cancelled = true; };
  }, [neighborKey, appearance.highlightMods, appearance.foreground, appearance.fontScale, appearance.textOffset, gradientEndColor, appearance.gradientBarrier]);
  const neighborsPrewarmed = neighborAssignments.every(assignment => neighborPrewarmReadyIds.has(assignment.id));
  // On the first load, do not reveal an interactive reader while prewarm work
  // can still monopolize the main thread. Individual failures are marked done
  // above and fall back to on-demand rendering, so no timeout escape is needed.
  const initialGateAppliedRef = useRef(false);
  const [initialGateResolved, setInitialGateResolved] = useState(false);
  useEffect(() => {
    if (initialGateAppliedRef.current || !observation) return;
    if (!neighborsPrewarmed) return;
    initialGateAppliedRef.current = true;
    setInitialGateResolved(true);
  }, [observation?.id, neighborsPrewarmed]);
  const presentationGradientKey = presentationHighlightRuns?.some(run => run.highlighted) && observation
    ? [observation.id, typography.fontFamily, appearance.foreground, gradientEndColor, appearance.gradientBarrier, observation.text].join('\0')
    : null;
  const gradientKey = showsObservationText ? presentationGradientKey : null;
  useEffect(() => {
    if (showsObservationText || !observation) return;
    const hiddenObservation = observation;
    let cancelled = false;
    const waitForIdle = () => new Promise<void>(resolve => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 250 });
      else window.setTimeout(resolve, 0);
    });
    const run = async () => {
      await document.fonts.load(`400 220px "${typography.fontFamily}"`, hiddenObservation.text.slice(0, 64));
      if (!presentationGradientKey || !presentationHighlightRuns
        || gradientPresentation?.key === presentationGradientKey) return;
      const textures: Array<TeluguGradientTexture | null> = [];
      for (const highlightRun of presentationHighlightRuns) {
        if (cancelled) return;
        if (!highlightRun.highlighted) {
          textures.push(null);
          continue;
        }
        await waitForIdle();
        if (cancelled) return;
        textures.push(await renderTeluguGradientTexture(
          highlightRun.text, typography.fontFamily, appearance.foreground, gradientEndColor, appearance.gradientBarrier,
        ));
      }
      if (!cancelled) setGradientPresentation({ key: presentationGradientKey, textures });
    };
    void run().catch(() => {
      if (!cancelled) reportClientTelemetry({
        event: 'observation_render_failed',
        observationId: hiddenObservation.id,
        stage: 'hidden-prewarm',
        failureCategory: 'render-fallback',
      });
    });
    return () => { cancelled = true; };
  }, [showsObservationText, observation?.id, observation?.text, presentationGradientKey, typography.fontFamily, appearance.foreground, gradientEndColor, appearance.gradientBarrier]);
  useEffect(() => {
    if (!gradientKey || !highlightRuns || gradientPresentation?.key === gradientKey) return;
    let cancelled = false;
    const total = highlightRuns.filter(run => run.highlighted).length;
    setGradientProgress({ key: gradientKey, completed: 0, total });
    // Each texture is a heavy synchronous canvas computation; yielding to a
    // frame between runs keeps the main thread free so the cursor (and any
    // other input handling) doesn't freeze while a whole observation's worth
    // of gradient textures render back-to-back.
    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const run = async () => {
      const textures: Array<TeluguGradientTexture | null> = [];
      for (const highlightRun of highlightRuns) {
        if (cancelled) return;
        if (highlightRun.highlighted) {
          if (!hasTeluguGradientTexture(
            highlightRun.text, typography.fontFamily, appearance.foreground, gradientEndColor, appearance.gradientBarrier,
          )) await nextFrame();
          if (cancelled) return;
          const texture = await renderTeluguGradientTexture(highlightRun.text, typography.fontFamily, appearance.foreground, gradientEndColor, appearance.gradientBarrier);
          textures.push(texture);
          if (!cancelled) setGradientProgress(current => current?.key === gradientKey
            ? { ...current, completed: current.completed + 1 } : current);
        } else {
          textures.push(null);
        }
      }
      if (!cancelled) setGradientPresentation({ key: gradientKey, textures });
    };
    void run().catch(() => {
      if (!cancelled) {
        setGradientPresentation({ key: gradientKey, textures: highlightRuns.map(() => null) });
        reportClientTelemetry({
          event: 'observation_render_failed',
          ...(observation ? { observationId: observation.id } : {}),
          stage: 'gradient',
          failureCategory: 'render-fallback',
        });
      }
    });
    return () => { cancelled = true; };
  }, [gradientKey, gradientPresentation?.key]);
  const gradientsReady = !gradientKey || gradientPresentation?.key === gradientKey;
  const textReady = typography.ready && gradientsReady;
  const audioLoading = Boolean(audioReadinessKey)
    && audioReadinessKey !== seamlessAudioKey.current
    && (audioReadiness?.key !== audioReadinessKey || audioReadiness.loading);
  const entryPrepared = Boolean(observation) && (comparisonPhase && !textComparison
    ? comparisonReady
    : (!showsObservationText || textReady) && !audioLoading && initialGateResolved);
  const presentationKey = observation
    ? `${observation.id}\0${observation.question?.phase ?? observation.kind}`
    : null;
  const [paintedPresentationKey, setPaintedPresentationKey] = useState<string | null>(null);
  useEffect(() => {
    if (!entryPrepared || !presentationKey) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setPaintedPresentationKey(presentationKey));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [entryPrepared, presentationKey]);
  const [navigationError, setNavigationError] = useState('');
  const pageTransition = useObservationTravel(screenRef, state?.currentPosition ?? null, Boolean(observation && (textGivenFlow ? textReady : entryPrepared)));
  const entryReady = entryPrepared && paintedPresentationKey === presentationKey;
  useEffect(() => {
    if (!entryReady || !observation || observationLoadStartedAt.current === null) return;
    reportClientTelemetry({
      event: 'observation_ready',
      observationId: observation.id,
      durationMs: performance.now() - observationLoadStartedAt.current,
    });
    observationLoadStartedAt.current = null;
  }, [entryReady, observation?.id]);
  const showEntryLoadingIndicator = readerNeedsLoadingDots({
    entryReady,
    textVisible: pageTransition.hasOutgoing || Boolean(observation && showsObservationText && (textGivenFlow ? textReady : entryReady)),
    audioVisible: Boolean(entryReady && audioControlsVisible && visibleAudio),
    comparisonVisible: Boolean(comparisonPhase && !textComparison && entryReady),
    errorVisible: Boolean(audioError || state?.grammarError),
    startVisible: Boolean(!observation && state?.canNext && !busy),
  });
  const progressParts = [
    ...(showsObservationText ? [typography.ready ? 1 : 0] : []),
    ...(gradientKey ? [gradientProgress?.key === gradientKey && gradientProgress.total
      ? gradientProgress.completed / gradientProgress.total : 0] : []),
    ...(audioReadinessKey ? [audioReadiness?.key === audioReadinessKey ? audioReadiness.progress : 0] : []),
    ...(!initialGateResolved && neighborAssignments.length
      ? [neighborPrewarmReadyIds.size / neighborAssignments.length] : []),
  ];
  const entryProgress = entryReady ? 1 : progressParts.reduce((sum, progress) => sum + progress, 0) / Math.max(1, progressParts.length);
  useEffect(() => {
    if (entryReady || !observation) return;
    const timer = window.setTimeout(() => {
      console.warn('[telugu-now] observation readiness stalled', {
        observationId: observation.id,
        progress: Math.round(entryProgress * 100),
        gates: {
          initialPrewarm: initialGateResolved,
          typography: !showsObservationText || typography.ready,
          typographyFont: typography.fontFamily,
          typographyDiagnostics: typography.diagnostics(),
          fontSetStatus: document.fonts.status,
          fontAvailable: fontAvailability(typography.fontFamily, observation.text),
          gradients: !gradientKey || gradientPresentation?.key === gradientKey,
          gradientProgress: gradientKey && gradientProgress?.key === gradientKey
            ? { completed: gradientProgress.completed, total: gradientProgress.total }
            : null,
          audio: !audioReadinessKey || !audioLoading,
          audioProgress: audioReadiness?.key === audioReadinessKey ? audioReadiness.progress : null,
        },
        gradientCache: getTeluguGradientCacheSnapshot(),
      });
      reportClientTelemetry({
        event: 'observation_render_failed',
        observationId: observation.id,
        stage: 'readiness',
        failureCategory: 'readiness-stalled',
        durationMs: 5000,
      });
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [entryReady, observation?.id, entryProgress, initialGateResolved, showsObservationText,
    typography.ready, gradientKey, gradientPresentation?.key, gradientProgress,
    audioReadinessKey, audioLoading, audioReadiness]);
  const canBack =
    Boolean(state?.canBack) &&
    !busy &&
    (!observation || entryReady);
  const canNext =
    Boolean(state?.canNext) &&
    !busy &&
    (!observation || entryReady);
  // Going back while the current entry is still loading shows the previous
  // page immediately; the abandoned load keeps running in the background and
  // its result is discarded if the user never returns to it.
  const canBackWhileLoading = Boolean(state?.canBack) && !busy;
  const move = async (
    direction: 'back' | 'next',
  ) => {
    if(evaluationNavigation.current)return;
    evaluationNavigation.current=true;
    let moved = false;
    try {
      if (textGivenFlow && questionPhase && !(await questionControlsRef.current?.prepareToLeave())) return;
      if(direction==='next' && observation?.question?.phase === 'observation' && observation?.grammar && !observation.grammar.discarded &&
        !(await evaluationRef.current?.commit()))return;
      setNavigationError('');
      phaseDirection.current = direction;
      if (swipeChangesObservation(observation?.question?.phase, direction)) pageTransition.prepare(direction);
      moved=await onMove(direction);
      if (!moved) { pageTransition.cancel(); setNavigationError('Could not move. Try again.'); }
      if(moved && !textGivenFlow)setControlsVisible(false);
    } catch (error) {
      pageTransition.cancel();
      setNavigationError(error instanceof Error ? error.message : 'Could not move. Try again.');
    } finally {
      if (!moved) gradientTravel.cancelPreview();
      evaluationNavigation.current=false;
    }
  };
  const verticalSwipe = (direction: 'up' | 'down') => {
    if (recordingRange || busy || (activeQuestion?.mode === 'text-given' && !questionControlsRef.current?.canExplore())) return;
    if (exploring) {
      const next = explorationIndex(exploration, direction, steps.length);
      setExploration(next);
      if (next === null) { if(direction === 'up') playerRef.current?.rewind(); setAudioMotion('enter'); setControlsVisible(Boolean(visibleAudio)); }
      return;
    }
    if (direction === 'up') {
      if (controlsVisible) {
        if (!playerRef.current?.dismissPrecision()) { setAudioMotion('exit'); setControlsVisible(false); }
      } else if (showsObservationText && observation && steps.length) {
        playerRef.current?.pause(); taps.cancel(); setExploration(0);
      }
      return;
    }
    if (!entryReady || (activeQuestion?.mode === 'text-given' && !responseAudio)) return;
    if (!controlsVisible) { setAudioMotion('enter'); setControlsVisible(true); }
    else playerRef.current?.openAssociatedControls();
  };
  const swipeHandlers = useReaderSwipes(screenRef, Boolean(!selectedWord),
    `${observation?.id}:${observation?.question?.phase}`, direction => {
      taps.cancel();
      if (direction === 'up' || direction === 'down') {
        verticalSwipe(direction);
      }
      else if (direction === 'back' ? canBackWhileLoading : canNext) void move(direction);
      else gradientTravel.cancelPreview();
    }, () => taps.cancel(), {
      onDrag: (dx, dy, width) => {
        if (evaluationNavigation.current || busy) return;
        const fraction = gradientSwipeFraction(dx, dy, width);
        const direction = fraction < 0 ? 'back' : 'next';
        const allowed = direction === 'back' ? canBackWhileLoading : canNext;
        if (fraction && allowed && swipeChangesObservation(observation?.question?.phase, direction)) {
          gradientTravel.preview(fraction);
        } else gradientTravel.cancelPreview();
      },
      onCancel: () => { if (!evaluationNavigation.current) gradientTravel.cancelPreview(); },
    });
  const wordHitAtPoint = (event: ReaderPoint, contextMenu = false): VisibleGlyphHit | null => {
    const element = event.target instanceof Element ? event.target.closest('.observation-text') : null;
    if (!element || !observation) return null;
    return visibleWordAtPoint(
      element,
      observation.text,
      event.clientX,
      event.clientY,
      contextMenu ? 8 : 2,
      contextMenu ? 4 : 2,
    );
  };
  const wordAtPoint = (event: ReaderPoint, contextMenu = false): string | null => wordHitAtPoint(event, contextMenu)?.text ?? null;
  return (
    <main
      ref={screenRef}
      {...swipeHandlers}
      data-swipe-navigation="true"
      data-exploring={exploring}
      data-text-given-flow={textGivenFlow}
      data-phase-motion={phaseMotion}
      onAnimationEnd={event => { if (event.animationName === 'question-controls-arrive') setPhaseMotion('idle'); }}
      data-entry-ready={entryReady}
      data-settings-idle={settingsIdle}
      data-phase-direction={phaseDirection.current}
      data-scroll-mode={appearance.scrollMode}
      data-question-mode={textComparison ? 'text-given' : activeQuestion?.mode}
      data-question-phase={observation?.question?.phase}
      data-audio-motion={audioMotion}
      data-swipe-direction={audioMotionDirection === 1 ? 'right' : 'left'}
      className={
        `app-shell observation-screen ${
          audioControlsVisible
            ? 'controls-visible'
            : ''
        }`
      }
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) {
          if (event.target.closest('.audio-player-bar')) {
            setControlsVisible(true);
          }
        }
      }}
      onKeyDownCapture={(event) => {
        if (observation && !entryReady) return;
        if (event.target === event.currentTarget && (event.key === ' ' || event.key === 'Enter')) {
          event.preventDefault();
          if (!event.repeat) playerRef.current?.togglePlay();
          return;
        }
        if (event.target instanceof Element) {
          if (event.target.closest('.audio-player-bar')) {
            setControlsVisible(true);
          }
        }
      }}
      tabIndex={0}
      aria-label="Reader. Tap to play or pause. Swipe left or right to navigate, down to open audio controls, up to close. Arrow keys do the same."
      onContextMenu={event => { if (!(event.target instanceof Element && event.target.closest('input, textarea'))) event.preventDefault(); }}
      onClick={(event) => {
        // Typing in the keyboard must never count toward the reader's own
        // single/double-click gestures (playback toggle, back/next navigation).
        if (event.target instanceof Element && event.target.closest('.google-telugu-input')) return;
        if (observation && !entryReady) return;
        const bounds = screenRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const region = readerTapRegions(event.clientX, event.clientY, bounds);
        const word = wordHitAtPoint(event);
        const doubleRegion = word ? `word:${word.start}` : region.double;
        if (!window.getSelection()?.isCollapsed && !taps.matches(doubleRegion, event.clientX, event.clientY)) {
          taps.cancel();
          return;
        }
        // A single tap that will end up pausing playback must stop the audio
        // immediately, before the double-tap resolution delay, so the pause
        // lands exactly where the user tapped instead of bleeding later.
        const eagerlyPaused = Boolean(playerRef.current?.isPlaying());
        if (eagerlyPaused) {
          gesturePausedPlayback.current = true;
          playerRef.current?.pause();
        }
        taps.tap(doubleRegion, event.clientX, event.clientY, () => {
          if (gesturePausedPlayback.current) playerRef.current?.resume();
          gesturePausedPlayback.current = false;
          window.getSelection()?.removeAllRanges();
          if (word && observation) {
            setControlsVisible(false);
            setSelectedWord({ word: word.text, start: word.start, end: word.end, observationId: observation.id });
          }

        }, () => {
          gesturePausedPlayback.current = false;
          if (!eagerlyPaused) playerRef.current?.togglePlay();
        });
      }}
      onMouseDownCapture={(event) => {
        if (event.button !== 0 || event.detail < 2) return;
        if (event.target instanceof Element && event.target.closest('button, .audio-player-bar, .word-profile, .google-telugu-input')) return;
        event.preventDefault();
      }}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest('.google-telugu-input')) return;
        event.preventDefault();
      }}
    >
      <div className="nav-region">
        <button
          className="nav-zone nav-zone-left"
          type="button"
          aria-label="వెనుక"
          disabled={!canBack}
          onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}
          onClick={(
            event:
              MouseEvent<HTMLButtonElement>,
          ) => {
            if (event.detail === 0) {
              event.stopPropagation();
              if (canBack) void move('back');
            }
          }}
        />
      </div>
      {exploring && observation ? <ExplorationSurface observation={observation} step={steps[exploration!]!}
        profileCode={state?.profileCode ?? ''} fontFamily={typography.fontFamily} active={!selectedWord}
        playbackRate={state?.audioSettings.playbackRate ?? 1}
        onFocus={focus => setSelectedWord({...focus,observationId:observation.id})}/> : null}
      <section
        ref={typography.containerRef}
        className="observation-center"
        data-entry-loading={Boolean(observation && !entryReady)}
      >
        {observation && comparisonPhase && !textComparison ? (
          <ComparisonPage
            observation={observation}
            fontFamily={typography.fontFamily}
            playbackRate={state?.audioSettings.playbackRate ?? 1}
            onReady={() => setComparisonReady(true)}
            onBack={() => { if (canBack) void move('back'); }}
            onAdvance={() => { if (canNext) void move('next'); }}
          />
        ) : observation && showsObservationText ? (
          <div
            ref={typography.textRef}
            className="observation-text"
            onCopy={copyOriginalReaderText}
            style={{ ...typography.style, opacity: (textGivenFlow ? textReady : entryReady) ? 1 : 0 }}
          >
            <TeluguWordText
              text={observation.text}
              runs={highlightRuns}
              textures={gradientPresentation?.key === gradientKey ? gradientPresentation.textures : null}
            />
          </div>
        ) : observation && activeQuestion && visibleAudio ? null : canNext ? (
          <button
            className="observation-start"
            type="button"
            aria-label="Start observations"
            onClick={(event) => {
              event.stopPropagation();
              void move('next');
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <ArrowRight size={32} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : (
          <div className="observation-placeholder" />
        )}
          {showEntryLoadingIndicator ? (
            <div
              className="observation-entry-loading"
              onClick={(event) => {
                event.stopPropagation();
                if (textGivenFlow || event.detail < 2 || !canBackWhileLoading) return;
                const bounds = screenRef.current?.getBoundingClientRect();
                if (bounds && readerTapRegions(event.clientX, event.clientY, bounds).double === 'back') void move('back');
              }}
              onContextMenu={(event) => event.preventDefault()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <LoadingSlit key={presentationKey ?? "empty"} delayMs={250} label={observation ? "Preparing observation" : "Loading observation"} progress={entryProgress} />
            </div>
          ) : null}
          {!comparisonPhase || textComparison ? <AudioPlayerBar
            ref={playerRef}
            observationId={observation?.id ?? null}
            audio={visibleAudio}
            sourceId={activeQuestion?.mode === 'text-given' ? 'question-response' : observation?.sourceId ?? null}
            sourceKey={activeQuestion?.mode === 'text-given' ? `${state?.profileCode}:${observation?.id}` : observation?.sourceKey ?? null}
            defaultPlaybackRate={state?.audioSettings.playbackRate ?? 1}
            autoplay={textGivenFlow && (questionPhase || comparisonPhase) ? false : state?.audioSettings.autoplay ?? true}
            persistentDisclosure={Boolean(textGivenFlow)}
            controlsVisible={audioControlsVisible}
            playbackEnabled={entryReady && !selectedWord && !exploring}
            readinessKey={audioReadinessKey}
            onLoadingChange={handleAudioLoadingChange}
            onPlaybackErrorChange={setAudioError}
            recordingRange={activeQuestion?.mode === 'text-given' ? recordingRange : null}
            reserveAudioSpace={activeQuestion?.mode === 'text-given' || Boolean(textComparison)}
            onPrecisionInteraction={() => {
              taps.cancel();
              setControlsVisible(true);
              setPrecisionInteraction(value => value + 1);
            }}
          /> : null}
          {observation && activeQuestion ? <QuestionControls
            key={`${state?.profileCode}:${observation.id}`}
            ref={questionControlsRef}
            profileCode={state?.profileCode ?? ''}
            observationId={observation.id}
            mode={activeQuestion.mode}
            keyboard={activeQuestion.keyboard}
            visible={!exploring}
            initialText={activeQuestion.responseText}
            fontFamily={typography.fontFamily}
            beginRecording={() => playerRef.current?.beginRecording() ?? 0}
            durationSeconds={() => playerRef.current?.duration() ?? 0}
            onAudioSaved={(audio) => {
              playerRef.current?.prepareAudioReplacement(0);
              seamlessAudioKey.current = observation ? `${observation.id}\0${audio.url}` : null;
              setResponseAudio(audio);
              setControlsVisible(true);
            }}
            onRecordingChange={range => { setRecordingRange(range); if (range) setControlsVisible(true); }}
            onSubmit={() => { if (canNext) void move('next'); }}
          /> : null}
      </section>
      <div className="nav-region">
        <button
          className="nav-zone nav-zone-right"
          type="button"
          aria-label="తర్వాత"
          disabled={!canNext}
          onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}
          onClick={(
            event:
              MouseEvent<HTMLButtonElement>,
          ) => {
            if (event.detail === 0) {
              event.stopPropagation();
              if (canNext) void move('next');
            }
          }}
        />
      </div>
      {observation?.grammar && (comparisonPhase || observation.question?.phase === 'observation') ? <GrammarEvaluation showSwitch={Boolean(comparisonPhase) && !exploring} ref={evaluationRef} key={`${state?.profileCode}:${observation.id}`} profileCode={state?.profileCode??''} observationId={observation.id} result={observation.grammar.result} discarded={observation.grammar.discarded??false} initialDraft={evaluationDrafts.current.get(`${state?.profileCode}:${observation.id}`) ?? false} onDraftChange={value => evaluationDrafts.current.set(`${state?.profileCode}:${observation.id}`, value)}/> : null}
      {state?.grammarError ? <div className="audio-reader-error" role="alert">{state.grammarError}</div> : null}
      {navigationError ? <div className="audio-reader-error" role="alert">{navigationError}</div> : null}
      {audioError ? <div className="audio-reader-error" role="alert">{audioError}</div> : null}
      {selectedWord && selectedWord.observationId === observation?.id ? (
        <WordProfile key={`${selectedWord.observationId}:${selectedWord.start}`} word={selectedWord.word} sentence={observation.text} initialGrapheme={selectedWord.grapheme} suppressAudioControls={exploring}
          observationId={selectedWord.observationId} wordStart={selectedWord.start} wordEnd={selectedWord.end}
          fontFamily={typography.fontFamily} playbackRate={state?.audioSettings.playbackRate ?? 1}
          onClose={() => setSelectedWord(null)} />
      ) : null}
      <button type="button" className="reader-settings" aria-label="Settings" onClick={event=>{event.stopPropagation();taps.cancel();onOpenSettings(typography.fontFamily);}}><Settings aria-hidden="true"/></button>

    </main>
  );
}

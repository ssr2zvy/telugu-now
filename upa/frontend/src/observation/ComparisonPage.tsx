import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { DisplayObservation, ObservationAudio } from '../../../shared/contracts';
import { appearanceAudioGlass, appearanceModificationColor, useAppearance } from '../appearance';
import type { ObservationFontFamily } from '../presentation';
import { AudioPlayerBar, type AudioPlayerBarHandle } from './audio/AudioPlayerBar';
import { teluguHighlightRuns } from './telugu-highlighting';
import { TeluguWordText } from './TeluguGradientText';
import { renderTeluguGradientTexture, type TeluguGradientTexture } from './telugu-gradient-renderer';

function ComparisonText({ text, fontFamily, onReady }: {
  text: string;
  fontFamily: ObservationFontFamily;
  onReady: () => void;
}) {
  const { appearance } = useAppearance();
  const runs = appearance.highlightMods ? teluguHighlightRuns(text) : null;
  const gradientEndColor = appearanceModificationColor(appearance);
  const key = runs?.some(run => run.highlighted)
    ? [text, fontFamily, appearance.foreground, gradientEndColor].join('\0')
    : null;
  const [presentation, setPresentation] = useState<{ key: string; textures: Array<TeluguGradientTexture | null> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const prepare = async () => {
      await document.fonts.load(`400 160px "${fontFamily}"`, text.slice(0, 64));
      if (!key || !runs) {
        if (!cancelled) onReady();
        return;
      }
      const textures = await Promise.all(runs.map(run => run.highlighted
        ? renderTeluguGradientTexture(run.text, fontFamily, appearance.foreground, gradientEndColor)
        : Promise.resolve(null)));
      if (cancelled) return;
      setPresentation({ key, textures });
      onReady();
    };
    void prepare().catch(() => {});
    return () => { cancelled = true; };
  }, [key, text, fontFamily, appearance.foreground, gradientEndColor, onReady]);

  return <div className="question-comparison-text" lang="te" style={{ fontFamily: `"${fontFamily}", "Noto Sans Telugu", sans-serif` }}>
    <TeluguWordText text={text} runs={runs} textures={presentation?.key === key ? presentation.textures : null} />
  </div>;
}

function ComparisonAudio({ audio, observationId, sourceId, sourceKey, playbackRate, player, onToggle, onReady }: {
  audio: ObservationAudio | null;
  observationId: string;
  sourceId: string;
  sourceKey: string;
  playbackRate: number;
  player: RefObject<AudioPlayerBarHandle | null>;
  onToggle: () => void;
  onReady: () => void;
}) {
  const clickTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!audio) onReady();
  }, [audio, onReady]);
  useEffect(() => () => {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
  }, []);
  return <div className="question-comparison-audio" onClick={event => {
    if (event.target instanceof Element && event.target.closest('button, [role="slider"]')) return;
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      onToggle();
    }, 220);
  }} onDoubleClick={() => {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    clickTimer.current = null;
  }}>
    {audio ? <AudioPlayerBar
      ref={player}
      observationId={observationId}
      audio={audio}
      sourceId={sourceId}
      sourceKey={sourceKey}
      defaultPlaybackRate={playbackRate}
      autoplay={false}
      controlsVisible
      onLoadingChange={(_key, loading) => { if (!loading) onReady(); }}
    /> : <span className="question-comparison-empty" role="img" aria-label="No response recorded">—</span>}
  </div>;
}

export function ComparisonPage({ observation, fontFamily, playbackRate, onReady, onBack, onAdvance }: {
  observation: DisplayObservation;
  fontFamily: ObservationFontFamily;
  playbackRate: number;
  onReady: () => void;
  onBack: () => void;
  onAdvance: () => void;
}) {
  const { appearance } = useAppearance();
  const glass = useMemo(() => appearanceAudioGlass(appearance, 0.45), [appearance.gradient]);
  const question = observation.question!;
  const correctPlayer = useRef<AudioPlayerBarHandle>(null);
  const userPlayer = useRef<AudioPlayerBarHandle>(null);
  const [userReady, setUserReady] = useState(false);
  const [correctReady, setCorrectReady] = useState(false);
  const markUserReady = useCallback(() => setUserReady(true), []);
  const markCorrectReady = useCallback(() => setCorrectReady(true), []);
  useEffect(() => {
    if (userReady && correctReady) onReady();
  }, [userReady, correctReady, onReady]);

  const textComparison = question.mode === 'audio-given';
  const toggleCorrectAudio = () => {
    if (!correctPlayer.current?.isPlaying()) userPlayer.current?.pause();
    correctPlayer.current?.togglePlay();
  };
  const toggleUserAudio = () => {
    if (!userPlayer.current?.isPlaying()) correctPlayer.current?.pause();
    userPlayer.current?.togglePlay();
  };
  return <div className="question-comparison" data-ready={userReady && correctReady}
    style={{ '--audio-glass-gradient': glass.gradient, '--audio-glass-edge': glass.edge } as CSSProperties}
    onClick={event => event.stopPropagation()}
    onDoubleClickCapture={event => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = event.currentTarget.getBoundingClientRect();
      const horizontal = (event.clientX - bounds.left) / bounds.width;
      if (horizontal < 1 / 3) onBack();
      else if (horizontal >= 2 / 3) onAdvance();
    }}>
    <section className="question-comparison-side question-comparison-correct" aria-label="Correct answer">
      {textComparison
        ? <ComparisonText text={observation.text} fontFamily={fontFamily} onReady={markCorrectReady} />
        : <ComparisonAudio audio={observation.audio} observationId={`${observation.id}:correct`}
          sourceId={observation.sourceId} sourceKey={observation.sourceKey} playbackRate={playbackRate}
          player={correctPlayer} onToggle={toggleCorrectAudio} onReady={markCorrectReady} />}
    </section>
    <section className="question-comparison-side question-comparison-user" aria-label="Your answer">
      {textComparison
        ? <ComparisonText text={question.responseText || '—'} fontFamily={fontFamily} onReady={markUserReady} />
        : <ComparisonAudio audio={question.responseAudio} observationId={`${observation.id}:user`}
          sourceId="question-response" sourceKey={observation.id} playbackRate={playbackRate}
          player={userPlayer} onToggle={toggleUserAudio} onReady={markUserReady} />}
    </section>
  </div>;
}

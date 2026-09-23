import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { AlignedLetterAudio } from '../../../../shared/contracts';
import { getAlignedLetterAudio } from '../../api';
import { appearanceModificationColor, useAppearance } from '../../appearance';
import { LoadingSlit } from '../../components/LoadingSlit';
import type { ObservationFontFamily } from '../../presentation';
import { ReadingContextMenu, readingContextMenuState, type ReadingContextMenuState } from '../ReadingContextMenu';
import { TeluguGradientText } from '../TeluguGradientText';
import { teluguHighlightRuns } from '../telugu-highlighting';
import { renderTeluguGradientTexture, type TeluguGradientTexture } from '../telugu-gradient-renderer';
import { AudioPlayerBar, type AudioPlayerBarHandle } from '../audio/AudioPlayerBar';

interface LetterProfileProps {
  letter: string;
  observationId: string;
  word: string;
  wordStart: number;
  wordEnd: number;
  graphemeStart: number;
  graphemeEnd: number;
  profileCode: string;
  fontFamily: ObservationFontFamily;
  playbackRate: number;
  onCopy: (word: string) => void | Promise<void>;
  onBack: () => void;
}

interface LetterRun {
  text: string;
  highlighted: boolean;
}

export function LetterProfile({ letter, observationId, word, wordStart, wordEnd, graphemeStart, graphemeEnd,
  profileCode, fontFamily, playbackRate,
  onCopy, onBack }: LetterProfileProps) {
  const { appearance } = useAppearance();
  const [selection, setSelection] = useState<AlignedLetterAudio | null>(null);
  const [error, setError] = useState('');
  const [audioLoading, setAudioLoading] = useState(true);
  const player = useRef<AudioPlayerBarHandle>(null);
  const [menu, setMenu] = useState<ReadingContextMenuState | null>(null);
  const [gradientPresentation, setGradientPresentation] = useState<{ key: string; textures: Array<TeluguGradientTexture | null> } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setSelection(null);
    setError('');
    setAudioLoading(true);
    void getAlignedLetterAudio(profileCode, observationId, wordStart, wordEnd, graphemeStart, graphemeEnd, controller.signal).then(result => {
      setSelection(result);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not find a word for this letter.');
    });
    return () => controller.abort();
  }, [profileCode, observationId, wordStart, wordEnd, graphemeStart, graphemeEnd]);
  const runs = useMemo<LetterRun[]>(() => selection
    ? appearance.highlightMods ? teluguHighlightRuns(selection.text) : [{ text: selection.text, highlighted: false }]
    : [], [selection?.text, letter, appearance.highlightMods]);
  const modificationColor = appearanceModificationColor(appearance);
  const gradientKey = selection
    ? [selection.text, fontFamily, appearance.foreground, modificationColor, appearance.highlightMods].join('\0')
    : null;
  useEffect(() => {
    if (!gradientKey) return;
    let cancelled = false;
    void Promise.all(runs.map(run => run.highlighted
      ? renderTeluguGradientTexture(run.text, fontFamily,
          appearance.foreground, modificationColor)
      : Promise.resolve(null))).then(textures => {
        if (!cancelled) setGradientPresentation({ key: gradientKey, textures });
      }).catch(() => {
        if (!cancelled) setGradientPresentation({ key: gradientKey, textures: runs.map(() => null) });
      });
    return () => { cancelled = true; };
  }, [gradientKey]);
  const gradientsReady = Boolean(selection) && gradientPresentation?.key === gradientKey;
  const ready = gradientsReady && !audioLoading;
  const openMenu = (event: MouseEvent<HTMLElement>) => {
    if (!selection) return;
    event.preventDefault();
    setMenu(readingContextMenuState(event.clientX, event.clientY, selection.word));
  };

  return (
    <section className="letter-profile-page controls-visible" aria-labelledby="letter-profile-title" aria-busy={!ready && !error}>
      <button type="button" className="word-profile-back" aria-label="Back to word" onClick={onBack}>
        <ArrowLeft size={20} aria-hidden="true" />
      </button>
      {!ready && !error ? <LoadingSlit label="Finding a word for this letter" /> : null}
      {selection ? <div className="letter-profile-center" data-ready={ready} onClick={event => {
        if ((event.target as HTMLElement).closest('.audio-player-bar')) return;
        player.current?.togglePlay();
      }}>
        <h2 id="letter-profile-title" lang="te" aria-label={selection.text} onContextMenu={openMenu}
          style={{ '--word-graphemes': 1,
            fontFamily: `"${fontFamily}", "Noto Sans Telugu", sans-serif` } as CSSProperties}>
          {runs.map((run, index) => <span key={index}>
            {run.highlighted
              ? <TeluguGradientText text={run.text} texture={gradientPresentation?.key === gradientKey ? gradientPresentation.textures[index] ?? null : null} />
              : run.text}
          </span>)}
        </h2>
        <AudioPlayerBar ref={player} audio={selection.audio} sourceId={selection.sourceId} sourceKey={selection.sourceKey}
          defaultPlaybackRate={playbackRate} autoplay={false} controlsVisible playbackEnabled
          readinessKey={`${selection.sourceId}:${selection.sourceKey}`}
          onLoadingChange={(_key, loading) => setAudioLoading(loading)}
          onPlaybackErrorChange={message => setError(message ?? '')} />
      </div> : null}
      {menu ? <ReadingContextMenu menu={menu} onCopy={onCopy} onClose={() => setMenu(null)} /> : null}
      {error ? <p className="word-profile-error" role="alert">{error}</p> : null}
    </section>
  );
}

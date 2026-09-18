import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { GraphemeWord } from '../../../../shared/contracts';
import { getGraphemeWord } from '../../api';
import { appearanceFocusedLetterColor, appearanceModificationColor, useAppearance } from '../../appearance';
import { LoadingSlit } from '../../components/LoadingSlit';
import type { ObservationFontFamily } from '../../presentation';
import { ReadingContextMenu, readingContextMenuState, type ReadingContextMenuState } from '../ReadingContextMenu';
import { TeluguGradientText } from '../TeluguGradientText';
import { teluguHighlightRuns } from '../telugu-highlighting';
import { renderTeluguGradientTexture, type TeluguGradientTexture } from '../telugu-gradient-renderer';
import { AudioPlayerBar } from '../audio/AudioPlayerBar';

interface LetterProfileProps {
  letter: string;
  profileCode: string;
  fontFamily: ObservationFontFamily;
  playbackRate: number;
  onCopy: (word: string) => void;
  onBlacklistTranscript: () => void;
  onBack: () => void;
}

interface LetterRun {
  text: string;
  highlighted: boolean;
  focused: boolean;
}

export function LetterProfile({ letter, profileCode, fontFamily, playbackRate,
  onCopy, onBlacklistTranscript, onBack }: LetterProfileProps) {
  const { appearance } = useAppearance();
  const [selection, setSelection] = useState<GraphemeWord | null>(null);
  const [error, setError] = useState('');
  const [audioLoading, setAudioLoading] = useState(true);
  const [menu, setMenu] = useState<ReadingContextMenuState | null>(null);
  const [gradientPresentation, setGradientPresentation] = useState<{ key: string; textures: Array<TeluguGradientTexture | null> } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setSelection(null);
    setError('');
    setAudioLoading(true);
    void getGraphemeWord(profileCode, letter, controller.signal).then(result => {
      setSelection(result);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not find a word for this letter.');
    });
    return () => controller.abort();
  }, [profileCode, letter]);
  const runs = useMemo<LetterRun[]>(() => selection
    ? [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(selection.word)].flatMap(grapheme => {
        const focused = grapheme.segment.normalize('NFC') === letter.normalize('NFC');
        const pieces = appearance.highlightMods ? teluguHighlightRuns(grapheme.segment) : [{ text: grapheme.segment, highlighted: false }];
        return pieces.map(piece => ({ ...piece, focused }));
      })
    : [], [selection?.word, letter, appearance.highlightMods]);
  const modificationColor = appearanceModificationColor(appearance);
  const focusColor = appearanceFocusedLetterColor(appearance);
  const gradientKey = selection
    ? [selection.word, letter, fontFamily, appearance.foreground, modificationColor, focusColor, appearance.highlightMods].join('\0')
    : null;
  useEffect(() => {
    if (!gradientKey) return;
    let cancelled = false;
    void Promise.all(runs.map(run => run.highlighted
      ? renderTeluguGradientTexture(run.text, fontFamily,
          run.focused ? focusColor : appearance.foreground,
          run.focused ? appearance.foreground : modificationColor)
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
      {selection ? <div className="letter-profile-center" data-ready={ready}>
        <h2 id="letter-profile-title" lang="te" aria-label={selection.word} onContextMenu={openMenu}
          style={{ '--word-graphemes': Math.max(1, selection.wordGraphemeCount), '--letter-focus-color': focusColor,
            fontFamily: `"${fontFamily}", "Noto Sans Telugu", sans-serif` } as CSSProperties}>
          {runs.map((run, index) => <span key={index} className={run.focused ? 'letter-profile-focus' : undefined}>
            {run.highlighted
              ? <TeluguGradientText text={run.text} texture={gradientPresentation?.key === gradientKey ? gradientPresentation.textures[index] ?? null : null} />
              : run.text}
          </span>)}
        </h2>
        <AudioPlayerBar audio={selection.audio} sourceId={selection.sourceId} sourceKey={selection.sourceKey}
          defaultPlaybackRate={playbackRate} autoplay={false} controlsVisible playbackEnabled
          readinessKey={`${selection.sourceId}:${selection.sourceKey}`}
          onLoadingChange={(_key, loading) => setAudioLoading(loading)}
          onPlaybackErrorChange={message => { if (message) setError(message); }} />
      </div> : null}
      {menu ? <ReadingContextMenu menu={menu} onCopy={onCopy} onBlacklistTranscript={onBlacklistTranscript} onClose={() => setMenu(null)} /> : null}
      {error ? <p className="word-profile-error" role="alert">{error}</p> : null}
    </section>
  );
}

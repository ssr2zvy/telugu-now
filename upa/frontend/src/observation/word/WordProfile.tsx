import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Info, LoaderCircle, Search, Sparkles, X } from 'lucide-react';
import { analyzeWord, wordDisplayParts } from './word-analysis';
import {
  catalogEntryUrl, generateWordImage, letterAudioUrl, saveSearchedImage, searchWordImages,
  wordImageCatalog, wordImageError, type CatalogEntry, type SearchResult,
} from './word-images';
import { useAppearance } from '../../appearance';

type Page =
  | { kind: 'word' }
  | { kind: 'image'; index: number }
  | { kind: 'search' }
  | { kind: 'letter'; letter: string };

function useDoubleTap(handler: (value: string) => void) {
  const last = useRef<{ value: string; at: number } | null>(null);
  return (value: string) => {
    const now = Date.now();
    const previous = last.current;
    if (previous && previous.value === value && now - previous.at < 400) {
      last.current = null;
      handler(value);
      return;
    }
    last.current = { value, at: now };
  };
}

/** A letter's own page: the letter alone with speech generated for it. */
function LetterPage({ letter, onBack }: { letter: string; onBack: () => void }) {
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    setError('');
    const element = audio.current;
    if (element) void element.play().catch(() => undefined);
  }, [letter]);
  return (
    <div className="word-page word-letter-page">
      <header className="word-page-header">
        <button type="button" className="word-profile-close" aria-label="Back to word" title="Back to word" onClick={onBack}>
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
      </header>
      <p className="word-letter" lang="te">{letter}</p>
      <audio ref={audio} className="word-letter-audio" controls preload="auto" src={letterAudioUrl(letter)}
        onError={() => setError('Could not load speech for this letter.')} />
      {error ? <p className="word-profile-error" role="alert">{error}</p> : null}
    </div>
  );
}

/** Full-page image view; a tap on the image toggles its controls. */
function ImagePage({ entries, index, onIndex, onGenerate, onExit, generating, error }: {
  entries: CatalogEntry[];
  index: number;
  onIndex: (index: number) => void;
  onGenerate: () => void;
  onExit: () => void;
  generating: boolean;
  error: string;
}) {
  const [controls, setControls] = useState(true);
  const [info, setInfo] = useState(false);
  const entry = entries[index];
  if (!entry) return null;
  const atEnd = index >= entries.length - 1;
  return (
    <div className="word-page word-image-page" data-controls={controls ? 'shown' : 'hidden'}>
      <button type="button" className="word-image-surface" aria-label="Toggle image controls"
        onClick={() => setControls(shown => !shown)}>
        <img src={catalogEntryUrl(entry.id)} alt={`Image ${index + 1} of ${entries.length}`} />
      </button>
      <div className="word-image-controls" aria-hidden={!controls}>
        <button type="button" className="word-profile-close" aria-label="Previous image" title="Previous image"
          disabled={!controls || index === 0} onClick={() => onIndex(index - 1)}><ArrowLeft size={20} aria-hidden="true" /></button>
        <button type="button" className="word-profile-close" aria-label="Image information" title="Image information"
          disabled={!controls} aria-pressed={info} onClick={() => setInfo(shown => !shown)}><Info size={20} aria-hidden="true" /></button>
        <button type="button" className="word-profile-close" aria-label="Exit image view" title="Exit image view"
          disabled={!controls} onClick={onExit}><X size={20} aria-hidden="true" /></button>
        <button type="button" className="word-profile-close"
          aria-label={atEnd ? 'Generate another image' : 'Next image'} title={atEnd ? 'Generate another image' : 'Next image'}
          disabled={!controls || generating}
          onClick={() => { if (atEnd) onGenerate(); else onIndex(index + 1); }}>
          {generating ? <LoaderCircle className="word-image-spinner" size={20} aria-hidden="true" />
            : atEnd ? <Sparkles size={20} aria-hidden="true" /> : <ArrowRight size={20} aria-hidden="true" />}
        </button>
      </div>
      {info && controls ? (
        <dl className="word-image-info">
          <dt>Added</dt><dd>{new Date(entry.createdAt).toLocaleString()}</dd>
          <dt>Source</dt><dd>{entry.source === 'search' ? 'Web search' : 'Generated'}</dd>
          {entry.sentence ? <><dt>Sentence</dt><dd lang="te">{entry.sentence}</dd></> : null}
          {entry.prompt ? <><dt>Prompt</dt><dd>{entry.prompt}</dd></> : null}
          {entry.sourceUrl ? <><dt>Page</dt><dd>{entry.sourceUrl}</dd></> : null}
        </dl>
      ) : null}
      {error ? <p className="word-profile-error" role="alert">{error}</p> : null}
    </div>
  );
}

function SearchPage({ root, sentence, onBack, onSaved }: {
  root: string;
  sentence: string;
  onBack: () => void;
  onSaved: (entry: CatalogEntry) => void;
}) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  useEffect(() => {
    let cancelled = false;
    setError('');
    setResults(null);
    void searchWordImages(root)
      .then(found => { if (!cancelled) setResults(found); })
      .catch(reason => { if (!cancelled) setError(wordImageError(reason)); });
    return () => { cancelled = true; };
  }, [root]);
  return (
    <div className="word-page word-search-page">
      <header className="word-page-header">
        <button type="button" className="word-profile-close" aria-label="Back to word" title="Back to word" onClick={onBack}>
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
      </header>
      {error ? <p className="word-profile-error" role="alert">{error}</p> : null}
      {!results && !error ? <p className="word-search-status" role="status">Searching</p> : null}
      <div className="word-search-results">
        {(results ?? []).map(result => (
          <button key={result.imageUrl} type="button" className="word-search-result" disabled={saving !== ''}
            title={result.title || root} aria-label={result.title || `Save image for ${root}`}
            onClick={() => {
              setSaving(result.imageUrl);
              setError('');
              void saveSearchedImage(root, result, sentence)
                .then(onSaved)
                .catch(reason => setError(wordImageError(reason)))
                .finally(() => setSaving(''));
            }}>
            <img src={result.imageUrl} alt="" loading="lazy" />
            {saving === result.imageUrl ? <LoaderCircle className="word-image-spinner" size={20} aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WordProfile({ word, sentence = '', onClose }: { word: string; sentence?: string; onClose: () => void }) {
  const { profileCode } = useAppearance();
  const analysis = analyzeWord(word);
  const parts = wordDisplayParts(analysis);
  const dialog = useRef<HTMLDialogElement>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [page, setPage] = useState<Page>({ kind: 'word' });
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const letters = useMemo(
    () => [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(analysis.word)].map(entry => entry.segment),
    [analysis.word],
  );
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void wordImageCatalog(analysis.root)
      .then(found => { if (!cancelled) setEntries(found); })
      .catch(reason => { if (!cancelled) setError(wordImageError(reason)); });
    return () => { cancelled = true; };
  }, [analysis.root]);

  const generate = async (): Promise<void> => {
    if (running.current || !profileCode) return;
    running.current = true;
    setGenerating(true);
    setError('');
    try {
      const updated = await generateWordImage(analysis.root, profileCode, sentence);
      setEntries(updated);
      setPage({ kind: 'image', index: Math.max(updated.length - 1, 0) });
    } catch (reason) {
      setError(wordImageError(reason));
    } finally {
      running.current = false;
      setGenerating(false);
    }
  };
  const openLetter = useDoubleTap(letter => setPage({ kind: 'letter', letter }));

  return (
    <dialog ref={dialog} className="word-profile" aria-labelledby="word-profile-title"
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        if (page.kind === 'word') onClose(); else setPage({ kind: 'word' });
      }}
      onDoubleClick={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}>
      {page.kind === 'letter' ? <LetterPage letter={page.letter} onBack={() => setPage({ kind: 'word' })} /> : null}
      {page.kind === 'search' ? (
        <SearchPage root={analysis.root} sentence={sentence} onBack={() => setPage({ kind: 'word' })}
          onSaved={entry => {
            setEntries(current => {
              const updated = [...current, entry];
              setPage({ kind: 'image', index: updated.length - 1 });
              return updated;
            });
          }} />
      ) : null}
      {page.kind === 'image' ? (
        <ImagePage entries={entries} index={page.index} generating={generating} error={error}
          onIndex={index => setPage({ kind: 'image', index })}
          onGenerate={() => void generate()}
          onExit={() => setPage({ kind: 'word' })} />
      ) : null}
      {page.kind === 'word' ? (
        <div className="word-page">
          <header className="word-page-header word-profile-header">
            <h2 id="word-profile-title" lang="te" aria-label={analysis.word} title={analysis.root}>
              {letters.map((letter, index) => (
                <span key={`${letter}-${index}`} className="word-letter-target" role="button" tabIndex={0}
                  onClick={() => openLetter(letter)}
                  onDoubleClick={() => setPage({ kind: 'letter', letter })}
                  onKeyDown={event => { if (event.key === 'Enter') setPage({ kind: 'letter', letter }); }}>
                  {letter}
                </span>
              ))}
            </h2>
            <span className="word-profile-parts" aria-hidden="true">{parts.ending}</span>
            <button type="button" className="word-profile-close" aria-label="Close word view" title="Close word view"
              onClick={onClose}><X size={20} aria-hidden="true" /></button>
          </header>
          <div className="word-page-actions">
            <button type="button" className="word-profile-close" aria-label="Copy word" title="Copy word"
              onClick={() => {
                setCopyFailed(false);
                void navigator.clipboard?.writeText(analysis.word).catch(() => setCopyFailed(true));
              }}><Copy size={18} aria-hidden="true" /></button>
            <button type="button" className="word-profile-close" aria-label="Generate image" title="Generate image"
              disabled={generating}
              onClick={() => { if (entries.length) setPage({ kind: 'image', index: 0 }); else void generate(); }}>
              {generating ? <LoaderCircle className="word-image-spinner" size={18} aria-hidden="true" />
                : <Sparkles size={18} aria-hidden="true" />}
            </button>
            <button type="button" className="word-profile-close" aria-label="Search for images" title="Search for images"
              onClick={() => setPage({ kind: 'search' })}><Search size={18} aria-hidden="true" /></button>
          </div>
          {copyFailed ? <p className="word-profile-error" role="alert">Could not copy the word.</p> : null}
          {error ? <p className="word-profile-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </dialog>
  );
}

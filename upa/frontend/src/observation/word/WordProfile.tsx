import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { ArrowLeft, Ban, Copy, Images, Info, Plus, Search, Sparkles } from 'lucide-react';
import { analyzeWord, wordDisplayParts } from './word-analysis';
import { generateWordImage, insertOrderedWordImage, navigateWordImages, removeWordImage, searchWordImages, wordImageBlob, wordImageError, wordImageGallery, wordImageUrl, type WordImageMetadata } from './word-images';
import { appearanceAudioGlass, appearanceModificationColor, useAppearance } from '../../appearance';
import { CustomCursor } from '../../components/CustomCursor';
import { ReadingContextMenu, readingContextMenuState, type ReadingContextMenuState } from '../ReadingContextMenu';
import { teluguHighlightRuns } from '../telugu-highlighting';
import { TeluguGradientText } from '../TeluguGradientText';
import { renderTeluguGradientTexture, type TeluguGradientTexture } from '../telugu-gradient-renderer';
import type { ObservationFontFamily } from '../../presentation';
import { visibleGraphemeAtPoint } from '../visible-glyph-hit-testing';
import { ReaderTaps } from '../reader-taps';
import { LetterProfile } from './LetterProfile';
import { getAlignedWordAudio } from '../../api';
import { useAudioPlayer } from '../audio/useAudioPlayer';
import type { AlignedWordAudio } from '../../../../shared/contracts';

async function copyWord(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(textarea); }
  }
}

async function copyImage(blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image copying is not supported by this browser.');
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

type ImagePane = 'action' | 'image' | 'gallery' | 'info';

function WordImage({ root }: { root: string }) {
  const { appearance, profileCode } = useAppearance();
  const [images, setImages] = useState<WordImageMetadata[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pane, setPane] = useState<ImagePane>('action');
  const [boundary, setBoundary] = useState<'before' | 'after'>('after');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'generating' | 'searching' | 'error'>('loading');
  const [error, setError] = useState('');
  const active = useRef(true);
  const running = useRef(false);
  const imagesRef = useRef<WordImageMetadata[]>([]);
  const current = images[currentIndex];
  const currentThumbnail = useRef<HTMLButtonElement>(null);
  const paintId = `word-image-glass-${useId().replace(/:/g, '')}`;
  const glass = useMemo(() => appearanceAudioGlass(appearance), [appearance.gradient]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    void wordImageGallery(root).then(saved => {
      if (cancelled) return;
      imagesRef.current = saved;
      setImages(saved);
      setCurrentIndex(0);
      setPane(saved.length ? 'image' : 'action');
      setStatus('ready');
    }).catch(reason => {
      if (!cancelled) { setError(wordImageError(reason)); setStatus('error'); }
    });
    return () => { cancelled = true; };
  }, [root]);
  useEffect(() => {
    if (pane === 'gallery') currentThumbnail.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [pane, currentIndex]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);
  const generate = async () => {
    if (running.current || !profileCode) return;
    running.current = true;
    setStatus('generating');
    setError('');
    const existingIds = new Set(images.map(image => image.id));
    try {
      await generateWordImage(root, profileCode, false, images.length > 0);
      const saved = await wordImageGallery(root);
      if (active.current) {
        imagesRef.current = saved;
        setImages(saved);
        const generated = saved.findIndex(image => !existingIds.has(image.id));
        setCurrentIndex(generated < 0 ? 0 : generated);
        setPane(saved.length ? 'image' : 'action');
        setStatus('ready');
      }
    } catch (reason) {
      if (active.current) { setError(wordImageError(reason)); setStatus('error'); }
    } finally {
      running.current = false;
    }
  };
  const searchImages = async () => {
    if (running.current || !profileCode) return;
    running.current = true;
    setStatus('searching');
    setError('');
    let firstId: string | null = null;
    let batchId: string | null = null;
    try {
      const { added, inspected, pagesSearched } = await searchWordImages(root, profileCode, image => {
        if (!active.current) return;
        if (!firstId) {
          firstId = image.id;
          batchId = image.batchId ?? null;
        }
        const ordered = insertOrderedWordImage(imagesRef.current, image);
        imagesRef.current = ordered;
        setImages(ordered);
        setCurrentIndex(Math.max(0, ordered.findIndex(saved => saved.id === firstId)));
        setPane('image');
      });
      if (!active.current) return;
      const saved = await wordImageGallery(root);
      imagesRef.current = saved;
      setImages(saved);
      if (firstId) {
        const batchFirst = batchId ? saved.findIndex(image => image.batchId === batchId) : -1;
        setCurrentIndex(batchFirst >= 0 ? batchFirst : Math.max(0, saved.findIndex(image => image.id === firstId)));
      }
      if (!added) setError(`Found 0 images after checking ${inspected} candidates across ${pagesSearched} ${pagesSearched === 1 ? 'page' : 'pages'}.`);
      setStatus('ready');
    } catch (reason) {
      if (active.current) { setError(wordImageError(reason)); setStatus('error'); }
    } finally {
      running.current = false;
    }
  };
  const navigate = (direction: -1 | 1) => {
    setMenu(null);
    if (busy && direction > 0) return;
    if (pane !== 'image' && pane !== 'action') return;
    const next = navigateWordImages(pane === 'action' ? { pane: 'action' } : { pane: 'image', index: currentIndex }, images.length, direction);
    if (next.pane === 'action') {
      setBoundary(direction < 0 ? 'before' : 'after');
      setPane('action');
    } else {
      setCurrentIndex(next.index);
      setPane('image');
    }
  };
  const navigateFromDoubleClick = (event: MouseEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    navigate(event.clientX < bounds.left + bounds.width / 2 ? -1 : 1);
  };
  const blacklist = async () => {
    if (!profileCode || !current) return;
    setMenu(null);
    setError('');
    try {
      await removeWordImage(root, profileCode, current.id);
      const saved = images.filter(image => image.id !== current.id);
      imagesRef.current = saved;
      setImages(saved);
      if (!saved.length) { setCurrentIndex(0); setPane('action'); return; }
      setCurrentIndex(Math.min(currentIndex, saved.length - 1));
      setPane('image');
    } catch (reason) { setError(wordImageError(reason)); }
  };
  const copyCurrent = async () => {
    if (!current) return;
    setMenu(null);
    setError('');
    try { await copyImage(await wordImageBlob(root, current.id)); }
    catch (reason) { setError(wordImageError(reason)); }
  };
  const busy = status === 'loading' || status === 'generating' || status === 'searching';
  return (
    <section className="word-image-section" aria-label="Concept images" aria-busy={busy}
      style={{ '--audio-icon-paint': `url(#${paintId})`, '--audio-glass-edge': glass.edge } as CSSProperties}
      onDoubleClick={event => { event.stopPropagation(); navigateFromDoubleClick(event); }}>
      <svg className="audio-paint-definitions" width="0" height="0" aria-hidden="true" focusable="false">
        <defs><linearGradient id={paintId} x1="0%" y1="0%" x2="100%" y2="100%">
          {glass.stops.map(stop => <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />)}
        </linearGradient></defs>
      </svg>
      {pane === 'image' && current ? <div className="word-image-preview" onContextMenu={event => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}>
        <img src={wordImageUrl(root, current.id)} alt={`Drawing of the concept of ${root}`} />
      </div> : null}
      {pane === 'action' ? <div className="word-image-entry" data-boundary={boundary}>
        <button className="word-image-glass-action" type="button" disabled={busy || !profileCode}
          aria-label={images.length ? 'Generate another image' : 'Generate image'}
          onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void generate(); }}>
          <Sparkles aria-hidden="true" />
        </button>
        <button className="word-image-glass-action" type="button" disabled={busy || !profileCode}
          aria-label="Search for licensed images"
          onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void searchImages(); }}>
          <Search aria-hidden="true" />
        </button>
      </div>
      : null}
      {pane === 'gallery' ? <div className="word-image-gallery" role="dialog" aria-label="Image gallery">
        {images.map((image, index) => <button key={image.id} ref={index === currentIndex ? currentThumbnail : undefined}
          type="button" aria-label={`Open image ${index + 1}`} aria-current={index === currentIndex}
          onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setCurrentIndex(index); setPane('image'); }}>
          <img src={wordImageUrl(root, image.id)} alt="" />
        </button>)}
      </div> : null}
      {pane === 'info' && current ? <div className="word-image-info" role="dialog" aria-label="Image information" onDoubleClick={event => event.stopPropagation()}>
        <dl>{current.title ? <div><dt>Title</dt><dd>{current.title}</dd></div> : null}
          <div><dt>Retrieval</dt><dd>{current.method === 'generation' ? 'Generated' : 'Search'}</dd></div>
          <div><dt>Vendor</dt><dd>{current.vendor}</dd></div>
          {current.sourceUrl ? <div><dt>Source</dt><dd><a href={current.sourceUrl} target="_blank" rel="noreferrer">{current.sourceName ?? 'Open source page'}</a></dd></div> : null}
          {current.license && current.licenseUrl ? <div><dt>License</dt><dd><a href={current.licenseUrl} target="_blank" rel="noreferrer">{current.license}</a></dd></div> : null}
          <div><dt>Added</dt><dd>{new Date(current.createdAt).toLocaleString()}</dd></div></dl>
        <button type="button" onClick={() => setPane('image')}>Close</button>
      </div> : null}
      {menu && current ? <div className="reading-context-menu word-image-context-menu" role="menu" aria-label="Image actions"
        style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
        <button className="reading-context-menu-action" role="menuitem" type="button" title="Copy" aria-label="Copy image" onClick={() => void copyCurrent()}><Copy size={18} /></button>
        <button className="reading-context-menu-action" role="menuitem" type="button" title="Blacklist" aria-label="Blacklist image" onClick={() => void blacklist()}><Ban size={18} /></button>
        <button className="reading-context-menu-action" role="menuitem" type="button" title="Gallery" aria-label="Open gallery" onClick={() => { setMenu(null); setPane('gallery'); }}><Images size={18} /></button>
        <button className="reading-context-menu-action" role="menuitem" type="button" title="Info" aria-label="Image information" onClick={() => { setMenu(null); setPane('info'); }}><Info size={18} /></button>
        <button className="reading-context-menu-action" role="menuitem" type="button" title="Add" aria-label="Add image" onClick={() => { setMenu(null); setBoundary('after'); setPane('action'); }}><Plus size={18} /></button>
      </div> : null}
      <div className="word-image-status" role="status" aria-live="polite">
        {status === 'loading' ? 'Checking saved images' : status === 'generating' ? 'Generating image' : status === 'searching' ? 'Searching for licensed images' : ''}
      </div>
      {error ? <p className="word-profile-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function WordProfile({ word, observationId, wordStart, wordEnd, fontFamily, playbackRate, onBlacklistTranscript, onClose }: {
  word: string;
  observationId: string;
  wordStart: number;
  wordEnd: number;
  fontFamily: ObservationFontFamily;
  playbackRate: number;
  onBlacklistTranscript: () => void;
  onClose: () => void;
}) {
  const { appearance, profileCode } = useAppearance();
  const analysis = analyzeWord(word);
  const parts = wordDisplayParts(analysis);
  const highlightRuns = appearance.highlightMods ? teluguHighlightRuns(analysis.word) : null;
  const gradientEndColor = appearanceModificationColor(appearance);
  const gradientKey = highlightRuns?.some(run => run.highlighted)
    ? [analysis.word, fontFamily, appearance.foreground, gradientEndColor].join('\0')
    : null;
  const [gradientPresentation, setGradientPresentation] = useState<{
    key: string;
    textures: Array<TeluguGradientTexture | null>;
  } | null>(null);
  const graphemeCount = [...new Intl.Segmenter('te', { granularity: 'grapheme' }).segment(analysis.word)].length;
  const [copyMenu, setCopyMenu] = useState<ReadingContextMenuState | null>(null);
  const [selectedGrapheme, setSelectedGrapheme] = useState<{ text: string; start: number; end: number } | null>(null);
  const [alignedWord, setAlignedWord] = useState<AlignedWordAudio | null>(null);
  const [letterTaps] = useState(() => new ReaderTaps());
  const dialog = useRef<HTMLDialogElement>(null);
  const wordPlayer = useAudioPlayer(alignedWord?.audio ?? null, null, null, playbackRate, observationId, false, true);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { letterTaps.cancel(); element?.close(); };
  }, [letterTaps]);
  useEffect(() => {
    if (!gradientKey || !highlightRuns) return;
    let cancelled = false;
    void Promise.all(highlightRuns.map(run => run.highlighted
      ? renderTeluguGradientTexture(run.text, fontFamily, appearance.foreground, gradientEndColor)
      : Promise.resolve(null))).then(textures => {
        if (!cancelled) setGradientPresentation({ key: gradientKey, textures });
      }).catch(() => {
        if (!cancelled) setGradientPresentation({ key: gradientKey, textures: highlightRuns.map(() => null) });
      });
    return () => { cancelled = true; };
  }, [gradientKey]);
  useEffect(() => {
    if (!profileCode) return;
    const controller = new AbortController();
    setAlignedWord(null);
    void getAlignedWordAudio(profileCode, observationId, wordStart, wordEnd, controller.signal)
      .then(result => { if (!controller.signal.aborted) setAlignedWord(result); })
      .catch(() => {});
    return () => controller.abort();
  }, [profileCode, observationId, wordStart, wordEnd]);
  return (
    <dialog ref={dialog} className="word-profile" data-letter-page={Boolean(selectedGrapheme)} aria-labelledby={selectedGrapheme ? 'letter-profile-title' : 'word-profile-title'}
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        if (selectedGrapheme) setSelectedGrapheme(null);
        else onClose();
      }}
      onDoubleClick={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <CustomCursor />
      <audio ref={wordPlayer.audioRef} preload="auto" hidden />
      <div className="gradient-field word-profile-gradient" aria-hidden="true"><div /><div /><div /></div>
      {selectedGrapheme && profileCode ? <LetterProfile letter={selectedGrapheme.text}
        observationId={observationId} word={analysis.word} wordStart={wordStart} wordEnd={wordEnd}
        graphemeStart={selectedGrapheme.start} graphemeEnd={selectedGrapheme.end}
        profileCode={profileCode} fontFamily={fontFamily} playbackRate={playbackRate}
        onCopy={text => void copyWord(text)} onBlacklistTranscript={onBlacklistTranscript}
        onBack={() => setSelectedGrapheme(null)} /> : <>
      <header className="word-profile-header" onClick={event => {
        const hit = visibleGraphemeAtPoint(event.currentTarget, analysis.word, event.clientX, event.clientY);
        if (!hit) { letterTaps.cancel(); return; }
        letterTaps.tap(`grapheme:${hit.start}`, event.clientX, event.clientY, () => {
          wordPlayer.pause();
          setCopyMenu(null);
          setSelectedGrapheme({ text: hit.text, start: hit.start, end: hit.end });
        }, wordPlayer.togglePlay);
      }} onContextMenu={event => {
        event.preventDefault();
        setCopyMenu(readingContextMenuState(event.clientX, event.clientY, analysis.word));
      }}>
        <h2 id="word-profile-title" lang="te" aria-label={analysis.word}
          style={{ '--word-graphemes': Math.max(1, graphemeCount), fontFamily: `"${fontFamily}", "Noto Sans Telugu", sans-serif` } as CSSProperties}>
          {highlightRuns ? highlightRuns.map((run, index) => run.highlighted
            ? <TeluguGradientText key={index} text={run.text} texture={gradientPresentation?.key === gradientKey ? gradientPresentation.textures[index] ?? null : null} />
            : run.text) : <><span>{parts.core}</span><span className="word-profile-ending">{parts.ending}</span></>}
        </h2>
      </header>
      <button type="button" className="word-profile-back" aria-label="Back to reading" onClick={onClose}><ArrowLeft size={20} aria-hidden="true" /></button>
      <WordImage key={analysis.root} root={analysis.root} />
      {copyMenu ? <ReadingContextMenu
        menu={copyMenu}
        onCopy={(text) => void copyWord(text)}
        onClose={() => setCopyMenu(null)}
      /> : null}
      </>}
    </dialog>
  );
}
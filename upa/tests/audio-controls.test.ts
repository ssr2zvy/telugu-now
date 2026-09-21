import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AudioScrubber } from '../frontend/src/observation/audio/AudioScrubber';
import { AudioPlayerBar } from '../frontend/src/observation/audio/AudioPlayerBar';
import { PlaybackSpeedPopover } from '../frontend/src/observation/audio/PlaybackSpeedPopover';
import { AudioGlassIcon } from '../frontend/src/observation/audio/AudioGlassIcon';
import { AUDIO_ICON_SHAPES } from '../frontend/src/components/icons';
import { precisionControls } from '../frontend/src/observation/audio/precision-controls';
import { CLOSED_PRECISION_MODE } from '../frontend/src/observation/audio/precision-controls';
import { AUDIO_PLAYER_PRESENTATION } from '../frontend/src/observation/audio/audio-player-presentation';

const scrubberProps = {
  currentTime: 2,
  duration: 10,
  waveformPeaks: [0, 0.5, 1],
  bookmarks: [1],
  disabled: false,
  onSeek: () => {},
  onPointerSeekStart: () => {},
  onPointerSeekMove: () => {},
  onPointerSeekEnd: () => {},
  onMagnifierOpen: () => {},
  onMagnifierClose: () => {},
};

test('normal audio controls do not render precision until explicitly opened', () => {
  const closed = renderToStaticMarkup(createElement(AudioScrubber, { ...scrubberProps, magnifierOpen: false }));
  assert.match(closed, /aria-label="Audio position"/);
  assert.match(closed, /aria-expanded="false"/);
  assert.doesNotMatch(closed, /class="audio-magnifier-track"/);
  assert.doesNotMatch(closed, /Precise audio position/);
  assert.match(closed, /class="audio-scrubber-thumb"/);
  const open = renderToStaticMarkup(createElement(AudioScrubber, { ...scrubberProps, magnifierOpen: true }));
  assert.match(open, /class="audio-magnifier-track"/);
  assert.doesNotMatch(open, /class="audio-scrubber-thumb"/);
  assert.match(open, /aria-label="Precise audio position"/);
  assert.match(open, /aria-expanded="true"/);
  assert.equal(AUDIO_PLAYER_PRESENTATION.magnifierHoldMs, 300);
  assert.ok(AUDIO_PLAYER_PRESENTATION.magnifierPressureThreshold > 0.5);
});

test('recording draws the growing gradient on the main bar while the magnifier stays hidden', () => {
  const markup = renderToStaticMarkup(createElement(AudioScrubber, {
    ...scrubberProps, duration: 30, currentTime: 0, magnifierOpen: false, disabled: true,
    recordingRange: { start: 4, end: 7, span: 30 },
  }));
  const range = markup.match(/class="audio-scrubber-recording-range" style="left:([^%]+)%;width:([^%]+)%"/);
  assert.ok(range);
  assert.ok(Math.abs(Number(range[1]) - 13.333) < .001);
  assert.ok(Math.abs(Number(range[2]) - 10) < .001);
  assert.match(markup, /aria-disabled="true"/);
  assert.doesNotMatch(markup, /audio-magnifier|audio-scrubber-thumb/);
});

test('main recording timeline keeps its scale when its viewport advances', () => {
  const markup = renderToStaticMarkup(createElement(AudioScrubber, {
    ...scrubberProps, duration: 10, currentTime: 9, magnifierOpen: false, disabled: true,
    recordingRange: { start: 9, end: 13, span: 10 },
  }));
  assert.match(markup, /audio-scrubber-recording-range" style="left:60%;width:40%/);
  assert.doesNotMatch(markup, /audio-magnifier/);
});

test('normal player has no play button and keeps precision-only actions hidden', () => {
  const markup = renderToStaticMarkup(createElement(AudioPlayerBar, {
    audio: { url: '/api/audio/fixture.wav', mimeType: 'audio/wav', durationSeconds: 10 },
    sourceId: 'fixture', sourceKey: 'one', defaultPlaybackRate: 1, controlsVisible: true,
  }));
  assert.match(markup, /data-magnifier-position="below"/);
  assert.doesNotMatch(markup, /audio-play-button/);
  assert.doesNotMatch(markup, /audio-speed-button|audio-bookmark-button|audio-speed-popover/);
  assert.equal((markup.match(/<button /g) ?? []).length, 0);
  assert.match(markup, /<audio[^>]*preload="auto"/);
  assert.match(markup, /aria-label="Audio position"/);
  assert.match(markup, /--audio-icon-paint:url\(#audio-glass-/);
  assert.match(markup, /--audio-glass-gradient:linear-gradient/);
  assert.ok(markup.includes(`--audio-slide-duration:${AUDIO_PLAYER_PRESENTATION.controlsSlideMs}ms`));
  assert.match(markup, /<linearGradient id="audio-glass-/);
  assert.equal((markup.match(/<stop /g) ?? []).length, 3);
  const opacities = [...markup.matchAll(/stop-opacity="([^"]+)"/g)].map(match => Number(match[1]));
  assert.equal(opacities.length, 3);
  assert.ok(opacities[0]! < opacities[1]! && opacities[2]! < opacities[1]!, 'glass edges fade more than the center');
  assert.doesNotMatch(markup, /audio-primary-controls|class="audio-magnifier-track"/);
});

test('text-given questions reserve audio layout before recording starts', () => {
  const markup = renderToStaticMarkup(createElement(AudioPlayerBar, {
    audio: null, sourceId: 'question-response', sourceKey: 'question',
    defaultPlaybackRate: 1, controlsVisible: true, reserveAudioSpace: true,
  }));
  assert.match(markup, /class="audio-player-bar"[^>]*data-has-audio="true"/);
  const observationSource = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  assert.match(observationSource, /reserveAudioSpace=\{activeQuestion\?\.mode === 'text-given'\}/);
});

test('timestamp defaults off but remains optional and accessible during precision seeking', () => {
  for (const showTimestamp of [undefined, false, true]) {
    for (const magnifierOpen of [false, true]) {
      const markup = renderToStaticMarkup(createElement(AudioScrubber, {
        ...scrubberProps, ...(showTimestamp === undefined ? {} : { showTimestamp }), magnifierOpen,
      }));
      assert.equal(markup.includes('class="audio-magnifier-time"'), showTimestamp === true && magnifierOpen);
      assert.equal(markup.includes('class="audio-magnifier-track"'), magnifierOpen);
      assert.match(markup, /aria-valuetext="00:02\.000"/);
    }
  }
});

test('stable side slots preserve scrubber length while controls mount only when open', () => {
  const bookmarkButton = createElement('button', { className: 'audio-bookmark-button', 'aria-label': 'Bookmarks' });
  const speedButton = createElement('button', { className: 'audio-speed-button', 'aria-label': 'Playback settings' });
  for (const open of [false, true, false]) {
    const markup = renderToStaticMarkup(createElement(AudioScrubber, {
      ...scrubberProps, magnifierOpen: open, showTimestamp: true, bookmarkButton, speedButton,
    }));
    assert.equal(markup.includes('class="audio-magnifier-track"'), open);
    assert.equal(markup.includes('class="audio-precision-panel"'), open);
    assert.equal(markup.includes('class="audio-scrubber-window"'), open);
    assert.equal(markup.includes('aria-label="Bookmarks"'), open);
    assert.equal(markup.includes('aria-label="Playback settings"'), open);
    assert.match(markup, /class="audio-bookmark-controls-slot"/);
    assert.match(markup, /class="audio-playback-controls-slot"/);
    assert.match(markup, /aria-label="Audio position"/);
    if (open) {
      const row = markup.match(/class="audio-scrubber-row"[\s\S]*?class="audio-precision-panel"/)?.[0] ?? '';
      // Bookmark precedes the scrubber bar, which precedes the speed button, within the same row.
      assert.ok(row.indexOf('aria-label="Bookmarks"') < row.indexOf('aria-label="Audio position"'));
      assert.ok(row.indexOf('aria-label="Audio position"') < row.indexOf('aria-label="Playback settings"'));
      assert.ok(markup.indexOf('class="audio-magnifier-track"') < markup.indexOf('class="audio-magnifier-time"'));
    }
  }
});

test('magnifier highlight can be hidden without closing precision controls', () => {
  const markup = renderToStaticMarkup(createElement(AudioScrubber, {
    ...scrubberProps, magnifierOpen: true, precisionPanelOpen: true, showMagnifierHighlight: false,
  }));
  assert.match(markup, /class="audio-magnifier-track"/);
  assert.doesNotMatch(markup, /class="audio-scrubber-window"/);
});

test('playback settings reveal speed and loop before the speed editor opens', () => {
  let mode = precisionControls(CLOSED_PRECISION_MODE, 'open');
  for (const action of ['toggle-controls', 'toggle-speed', 'close-speed', 'toggle-controls', 'close'] as const) {
    mode = precisionControls(mode, action);
    const playbackControls = createElement(PlaybackSpeedPopover, {
      playbackRate: 0.8, onChange: () => {}, onClose: () => {}, dismissOnOutside: false,
      view: 'controls', onToggleSpeed: () => {},
    });
    const speedEditor = createElement(PlaybackSpeedPopover, {
      playbackRate: 0.8, onChange: () => {}, onClose: () => {}, dismissOnOutside: false,
      view: 'editor', speedOpen: true,
    });
    const markup = renderToStaticMarkup(createElement(AudioScrubber, {
      ...scrubberProps, magnifierOpen: mode.surface !== 'closed',
      precisionPanelOpen: mode.surface === 'magnifier' || mode.playback === 'speed',
      playbackControls: mode.playback === 'controls' ? playbackControls : undefined,
      speedControls: mode.playback === 'speed' ? speedEditor : undefined,
    }));
    assert.equal(markup.includes('audio-speed-popover-controls'), mode.playback === 'controls');
    assert.equal(markup.includes('audio-speed-popover-editor'), mode.playback === 'speed');
    assert.equal(markup.includes('class="audio-magnifier-track"'), mode.surface === 'magnifier' && mode.playback !== 'speed');
    assert.equal(markup.includes('class="audio-scrubber-window"'), mode.surface === 'magnifier' && mode.playback !== 'speed');
    assert.match(markup, /aria-label="Audio position"/);
    if (mode.playback === 'controls') {
      assert.match(markup, /aria-label="Playback controls"/);
      assert.match(markup, /aria-label="Playback speed"/);
      assert.match(markup, /aria-label="Loop audio"[^>]*aria-pressed="false"[^>]*data-loop-mode="off"/);
      assert.doesNotMatch(markup, /aria-label="Loop from bookmark"/);
    }
    if (mode.playback === 'speed') {
      assert.match(markup, /aria-orientation="horizontal"/);
      assert.doesNotMatch(markup, /class="audio-magnifier-track"/);
      assert.match(markup, /class="audio-speed-readout">0\.80x/);
      assert.doesNotMatch(markup, /aria-label="Loop audio"/);
    }
  }
  const bookmarkLoop = renderToStaticMarkup(createElement(PlaybackSpeedPopover, {
    playbackRate: 1, onChange: () => {}, onClose: () => {}, dismissOnOutside: false,
    view: 'controls', loopMode: 'bookmark',
  }));
  assert.match(bookmarkLoop, /data-loop-mode="bookmark"/);
  const bookmarkLoopMask = decodeURIComponent([...bookmarkLoop.matchAll(/data:image\/svg\+xml,([^&"]+)/g)][1]?.[1] ?? '');
  for (const path of AUDIO_ICON_SHAPES.bookmarkLoop.paths) assert.ok(bookmarkLoopMask.includes(`d="${path}"`));
  for (const path of AUDIO_ICON_SHAPES.loop.paths) assert.ok(!bookmarkLoopMask.includes(`d="${path}"`));
});

test('expanded playback settings stay compact and collapse on the configured fade delay', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  const playerSource = readFileSync(new URL('../frontend/src/observation/audio/AudioPlayerBar.tsx', import.meta.url), 'utf8');
  assert.match(css, /\.audio-bookmark-controls-slot \{ left: 0; \}/);
  assert.match(css, /\.audio-playback-controls-slot \{ right: 0; \}/);
  assert.match(css, /\.audio-playback-controls-slot > \.audio-speed-button \{ transform: none; \}/);
  assert.match(css, /\.audio-playback-settings-row \{[^}]*gap: 0;/);
  assert.match(css, /\.audio-playback-option \{[^}]*width: 36px;/);
  assert.match(playerSource, /precisionMode\.playback !== 'controls'/);
  assert.match(playerSource, /appearance\.autoFadeSeconds \* 1000/);
  assert.match(playerSource, /dispatchPrecision\('toggle-controls'\)/);
});

test('record control overrides the shared transport glyph size', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  assert.match(css, /\.audio-transport-button \.control-icon \{ width: 17px; height: 17px; \}/);
  assert.match(css, /--audio-row-height: 48px; --audio-detail-height: 92px; --record-button-size: 48px; --record-gap:/);
  assert.match(css, /\.question-record-button \{ width: var\(--record-button-size\); height: var\(--record-button-size\); \}/);
  assert.match(css, /\.question-record-button \.control-icon \{ width: 25px; height: 25px; \}/);
  assert.match(css, /\.audio-scrubber-window \{[^}]*z-index: 3;/);
  assert.match(css, /data-question-mode='text-given'\] \.question-record-controls \{ top: auto; bottom: calc\(var\(--audio-bottom\) \+ var\(--audio-row-height\) \+ var\(--audio-detail-height\) \+ var\(--record-gap\)\); \}/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.observation-screen \{ --record-gap: clamp\(16px, 3dvh, 36px\); \}/);
  assert.match(css, /--audio-row-height: 56px; --audio-detail-height: 112px; --record-button-size: 56px; --record-gap:/);
  assert.match(css, /@media \(max-width: 600px\) and \(hover: none\) and \(pointer: coarse\) and \(orientation: portrait\) \{\s*\.observation-screen \{ --record-gap: clamp\(19px, 3\.5dvh, 42px\); \}/);
  assert.doesNotMatch(css, /data-question-mode='text-given'\] \.(?:observation-text|audio-player-bar)/);
});

test('audio-given questions keep the compact keyboard permanently visible', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  const controls = readFileSync(new URL('../frontend/src/observation/QuestionControls.tsx', import.meta.url), 'utf8');
  const observation = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(controls, /if \(!visible\) return null/);
  assert.match(controls, /question-keyboard-controls" data-visible=\{visible\} aria-hidden=\{!visible\} inert=\{!visible\}/);
  assert.match(controls, /GoogleTeluguKeyboard fontFamily=\{fontFamily\} value=\{text\} onChange=\{changeText\} onSubmit=/);
  assert.match(controls, /await updateQuestionText\(profileCode, observationId, \{ text: latestText\.current \}\);[\s\S]*onSubmit\(\)/);
  assert.match(observation, /const questionControlsAreVisible = activeQuestion\?\.mode === 'audio-given' \|\| questionControlsVisible/);
  assert.match(observation, /visible=\{questionControlsAreVisible\}/);
  assert.match(observation, /onSubmit=\{\(\) => \{ if \(canNext\) void move\('next'\); \}\}/);
  assert.match(observation, /appearance\.toggleTrigger === 'scroll' && !audioGivenQuestionPhase/);
  assert.doesNotMatch(observation, /if \(audioGivenQuestionPhase\) \{\s*setQuestionControlsVisible/);
  assert.doesNotMatch(observation, /Boolean\(audioGivenQuestionPhase\)\)\);/);
  assert.match(observation, /activeQuestion\?\.mode === 'text-given' && appearance\.toggleTrigger === 'tap'/);
  assert.match(css, /data-question-mode='audio-given'\] \.question-controls \{ top: calc\(35% \+ 50px\); bottom: max\(0px, env\(safe-area-inset-bottom\)\); width: min\(860px, calc\(100vw - 2rem\)\); overflow: hidden; \}/);
  assert.match(css, /\.question-answer-editor \{[^}]*width: min\(100%, 725px\); height: 72px;[^}]*font-size: 25px; line-height: 33px;/);
  assert.match(css, /\.question-keyboard \{[^}]*gap: 7px 0; padding: 7px;[^}]*border-radius: 11px;/);
  assert.match(css, /\.question-keyboard-row button \{[^}]*flex: 0 1 58px;[^}]*height: 48px;/);
  assert.doesNotMatch(css, /\.question-keyboard-row button[^\n]*::after/);
  assert.doesNotMatch(css, /\.google-telugu-input \{[^}]*transform: scale/);
  assert.match(css, /\.question-keyboard-controls \{[^}]*contain: paint;[^}]*transform: translate3d\(-50%, 32px, 0\);[^}]*will-change: transform;/);
  assert.match(css, /\.question-keyboard-controls\[data-visible='true'\] \{[^}]*transform: translate3d\(-50%, 0, 0\);/);
  assert.match(css, /data-question-mode='audio-given'\][\s\S]*\.question-keyboard-controls \{\s*bottom: max\(0px, env\(safe-area-inset-bottom\)\);\s*align-content: end;/);
});

test('physical and on-screen Enter submit from above the right Shift key', () => {
  const keyboard = readFileSync(new URL('../frontend/src/observation/GoogleTeluguKeyboard.tsx', import.meta.url), 'utf8');
  const controls = readFileSync(new URL('../frontend/src/observation/QuestionControls.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  assert.match(keyboard, /event\.key === 'Enter'[\s\S]*event\.preventDefault\(\);[\s\S]*onSubmit\(\)/);
  assert.ok(keyboard.indexOf("event.key === 'Enter'") < keyboard.indexOf('event.ctrlKey || event.metaKey || event.altKey || event.shiftKey'));
  assert.match(keyboard, /event\.target\.value\.replace\(\/\\r\\n\?\|\\n\/g, ' '\)/);
  assert.match(keyboard, /className="question-enter-key" aria-label="Show comparison" onClick=\{onSubmit\}/);
  assert.match(keyboard, /question-home-row">\{homeRow\.map\(characterKey\)\}\{enterKey\}<\/div>[\s\S]*question-bottom-row">\{shiftKey\}/);
  assert.match(keyboard, /question-keyboard-actions">\{controlKey\}[\s\S]*\{controlKey\}<\/div>/);
  assert.match(css, /\.question-home-row \.question-enter-key \{[^}]*flex-basis: 104px;/);
  assert.match(controls, /window\.addEventListener\('keydown', submitFromPhysicalKeyboard, true\)/);
  assert.match(controls, /event\.key !== 'Enter' \|\| event\.repeat \|\| event\.isComposing[\s\S]*event\.preventDefault\(\);[\s\S]*void submitText\(\)/);
});

test('recording replaces the response from zero and waits for explicit playback', () => {
  const playerSource = readFileSync(new URL('../frontend/src/observation/audio/AudioPlayerBar.tsx', import.meta.url), 'utf8');
  const controlsSource = readFileSync(new URL('../frontend/src/observation/QuestionControls.tsx', import.meta.url), 'utf8');
  const hookSource = readFileSync(new URL('../frontend/src/observation/audio/useAudioPlayer.ts', import.meta.url), 'utf8');
  const observationSource = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  assert.match(playerSource, /precisionBeforeRecording\.current = precisionMode;[\s\S]*dispatchPrecision\('close'\);[\s\S]*player\.pause\(\);[\s\S]*player\.seek\(0\);[\s\S]*return 0/);
  assert.match(playerSource, /const presentedPrecisionMode = recordingActive \? CLOSED_PRECISION_MODE : precisionMode/);
  assert.match(playerSource, /dispatchPrecision\(\{ type: 'restore', mode: precisionBeforeRecording\.current \}\)/);
  assert.match(controlsSource, /recordCursor\.current = beginRecording\(\);[\s\S]*getUserMedia[\s\S]*mediaRecorder\.onstart = \(\) => \{[\s\S]*setRecording\(true\)[\s\S]*mediaRecorder\.start\(\);/);
  assert.doesNotMatch(controlsSource, /preRoll|setTimeout\([^,]+, 500\)/);
  assert.match(controlsSource, /audio\/mp4;codecs=mp4a\.40\.2/);
  assert.match(controlsSource, /window\.isSecureContext[\s\S]*navigator\.mediaDevices\?\.getUserMedia[\s\S]*typeof MediaRecorder/);
  assert.match(controlsSource, /NotAllowedError[\s\S]*Microphone permission was denied/);
  assert.match(controlsSource, /requestAnimationFrame\(updateRecordingFeedback\)/);
  assert.doesNotMatch(controlsSource, /AnalyserNode|createAnalyser|recordingPeaks/);
  assert.match(controlsSource, /updateQuestionAudio\(profileCode, observationId, raw\)[\s\S]*onAudioSaved\(\{ url:[\s\S]*mimeType: raw\.type/);
  assert.doesNotMatch(controlsSource, /overwriteRecordingAtCursor|responseAudio/);
  assert.match(observationSource, /prepareAudioReplacement\(0\);[\s\S]*seamlessAudioKey\.current = observation \? `\$\{observation\.id\}\\0\$\{audio\.url\}` : null;[\s\S]*setResponseAudio\(audio\)/);
  assert.match(observationSource, /audioReadinessKey !== seamlessAudioKey\.current/);
  assert.match(hookSource, /if \(!replacingAudio\) \{\s*setCurrentTime\(0\);\s*setDuration\(0\);\s*setWaveformPeaks\(\[\]\)/);
  assert.match(hookSource, /element\.pause\(\);\s*element\.currentTime = restoredTime;\s*setCurrentTime\(restoredTime\);\s*setPlaying\(false\)/);
  assert.match(hookSource, /replacementCursorRef\.current = speechTime === 0 \? 0 : toPlayerTime\(speechTime\)/);
  assert.match(hookSource, /suppressReplacementAutoplayRef\.current = true;\s*pause\(\)/);
  assert.match(hookSource, /if \(suppressReplacementAutoplayRef\.current \|\| !playbackEnabled \|\| !autoplay/);
  assert.match(hookSource, /const togglePlay = \(\) => \{\s*suppressReplacementAutoplayRef\.current = false/);
});

test('precision mode cannot leave speed open or reopen the magnifier after dismissal', () => {
  assert.deepEqual(precisionControls(CLOSED_PRECISION_MODE, 'toggle-speed'), CLOSED_PRECISION_MODE);
  assert.deepEqual(precisionControls(CLOSED_PRECISION_MODE, 'toggle-controls'), CLOSED_PRECISION_MODE);
  const magnifier = precisionControls(CLOSED_PRECISION_MODE, 'open');
  assert.deepEqual(magnifier, { surface: 'magnifier', playback: 'closed' });
  const controls = precisionControls(magnifier, 'toggle-controls');
  assert.deepEqual(controls, { surface: 'magnifier', playback: 'controls' });
  const speed = precisionControls(controls, 'toggle-speed');
  assert.deepEqual(speed, { surface: 'magnifier', playback: 'speed' });
  assert.deepEqual(precisionControls(CLOSED_PRECISION_MODE, { type: 'restore', mode: speed }), speed);
  assert.deepEqual(precisionControls(speed, 'toggle-speed'), controls);
  assert.deepEqual(precisionControls(speed, 'close-speed'), controls);
  assert.deepEqual(precisionControls(controls, 'toggle-controls'), magnifier);
  const controlsOnly = precisionControls(CLOSED_PRECISION_MODE, 'toggle-visibility');
  assert.deepEqual(controlsOnly, { surface: 'controls', playback: 'closed' });
  assert.deepEqual(precisionControls(controlsOnly, 'open'), { surface: 'magnifier', playback: 'closed' });
  assert.deepEqual(precisionControls({ surface: 'controls', playback: 'controls' }, 'toggle-visibility'), CLOSED_PRECISION_MODE);
  const dismissed = precisionControls(speed, 'close');
  assert.deepEqual(dismissed, CLOSED_PRECISION_MODE);
  assert.deepEqual(precisionControls(dismissed, 'close-speed'), CLOSED_PRECISION_MODE);
  assert.deepEqual(precisionControls(magnifier, 'close'), CLOSED_PRECISION_MODE);
  const view = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  assert.match(view, /const willTogglePlay = appearance\.scrollMode \|\| region\.single === 'playback'/);
  assert.match(view, /if \(appearance\.scrollMode\) \{\s*if \(!eagerlyPaused\) playerRef\.current\?\.togglePlay\(\)/);
  assert.doesNotMatch(view, /region\.single === 'controls'/);
  const scrubber = readFileSync(new URL('../frontend/src/observation/audio/AudioScrubber.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(scrubber, /magnifierOpen && !speedControls/);
  const popover = readFileSync(new URL('../frontend/src/observation/audio/PlaybackSpeedPopover.tsx', import.meta.url), 'utf8');
  assert.match(popover, /view === 'editor' \? '\.audio-scrubber' : undefined/);
  const player = readFileSync(new URL('../frontend/src/observation/audio/useAudioPlayer.ts', import.meta.url), 'utf8');
  assert.match(player, /pointerSeekRef\.current = \{ startTime: time, wasPlaying, dragging: false \};\s*seekTo\(time, false\)/);
  assert.match(player, /const updatePointerSeek =[^]*?seekTo\(time, false\)/);
  assert.match(player, /interaction\?\.dragging && interaction\.wasPlaying && element\) requestPlayback\(element\)/);
});

test('glass icon masks reuse the SVG geometry, including playback and loop icons', () => {
  for (const name of ['play', 'pause', 'speed', 'bookmark', 'loop', 'bookmarkLoop'] as const) {
    const markup = renderToStaticMarkup(createElement(AudioGlassIcon, { name }));
    const encoded = markup.match(/data:image\/svg\+xml,([^&"]+)/)?.[1];
    assert.ok(encoded);
    const mask = decodeURIComponent(encoded);
    const shape = AUDIO_ICON_SHAPES[name];
    assert.ok(mask.includes(`fill="${shape.filled ? 'black' : 'none'}"`));
    assert.ok(mask.includes(`stroke="${shape.filled ? 'none' : 'black'}"`));
    for (const path of shape.paths) assert.ok(mask.includes(`d="${path}"`));
    assert.match(markup, /<svg class="control-icon/);
    assert.match(markup, /aria-hidden="true"/);
  }
});

test('the bar and dot share icon glass with no play-button row', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.audio-play-button/);
  const paint = css.match(/(\.audio-scrubber::before,[^{]+)\{ background: var\(--audio-glass-gradient\);/);
  for (const selector of ['audio-scrubber-progress', 'audio-scrubber-thumb', 'audio-scrubber-bookmark', 'audio-scrubber-window',
    'audio-magnifier-bar', 'audio-magnifier-playhead', 'audio-speed-track::before', 'audio-speed-fill', 'audio-speed-thumb']) {
    assert.ok(paint?.[1]?.includes(`.${selector}`), `${selector} must share the glass gradient`);
  }
  assert.match(css, /\.audio-glass-icon \{ background: var\(--audio-glass-gradient\);/);
  assert.match(css, /\.audio-transport-button svg \{ stroke: var\(--audio-icon-paint\)/);
  assert.match(css, /\.audio-transport-button \.control-icon-fill \{ fill: var\(--audio-icon-paint\); stroke: none/);
  assert.match(css, /--audio-base-bottom: var\(--audio-placement-bottom\)/);
  assert.match(css, /--audio-min-bottom: var\(--audio-placement-bottom\)/);
  assert.doesNotMatch(css, /safe-area-inset-bottom\) \+ (48|64)px/);
  assert.match(css, /\.audio-transport-button \{[^}]*background: transparent/);
  assert.match(css, /\.audio-player-bar \{[^}]*grid-template-rows: var\(--audio-row-height\) var\(--audio-detail-height\);[^}]*gap: var\(--audio-timestamp-gap, 1px\) 0;/);
  assert.match(css, /\.audio-precision-panel \{ --audio-detail-track-height: 32px; --audio-detail-track-width: 48%;/);
  assert.match(css, /\.audio-magnifier-track \{[^}]*width: var\(--audio-detail-track-width\); height: var\(--audio-detail-track-height\);/);
  assert.match(css, /\.audio-precision-panel \{[^}]*grid-row: 2;[^}]*display: flex; flex-direction: column/);
  assert.match(css, /\.audio-precision-panel \{[^}]*gap: var\(--timestamp-magnifier-gap, 1px\)/);
  assert.doesNotMatch(css, /--audio-control-gap/);
  assert.match(css, /\[data-magnifier-position="above"\] \.audio-precision-panel \{ grid-row: 1; justify-content: flex-end/);
  assert.doesNotMatch(css, /\.audio-precision-panel::before/);
  assert.match(css, /\.audio-scrubber-window \{ --audio-detail-brightness: \.8; position: absolute; z-index: 3; top: 17px; bottom: 17px; border-radius: 5px; opacity: 1; \}/);
  assert.match(css, /\.audio-scrubber-window \{ background: var\(--audio-glass-gradient\), var\(--surface\); \}/);
  assert.match(css, /\.audio-magnifier-playhead \{ --audio-detail-brightness: \.8;/);
  assert.match(css, /filter: brightness\(calc\(var\(--control-brightness, \.85\) \* var\(--audio-detail-brightness, 1\)\)\)/);
  assert.match(css, /\.audio-playback-status \{[^}]*clip-path: inset\(50%\)/);
  assert.match(css, /\.audio-loading-indicator \{ animation: none;/);
  assert.match(css, /\.audio-scrubber-row \{[^}]*grid-row: 1; grid-column: 1 \/ -1/);
  assert.match(css, /\.audio-glass-icon \{[^}]*mask-image: var\(--audio-icon-mask\)[^}]*backdrop-filter: blur\(5px\)/);
});

test('the magnifier highlight is compact, and buttons flank a scrubber matching the magnifier width', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  const rule = (selector: string) => css.split(`\n${selector} {`)[1]!.split('}')[0]!;
  const pixels = (body: string, property: string) =>
    Number(body.match(new RegExp(`(?:^|;)\\s*${property}: (-?\\d+)(?:px)?;`))?.[1]);
  const inset = pixels(rule('.audio-scrubber-window'), 'top');
  assert.equal(inset, pixels(rule('.audio-scrubber-window'), 'bottom'));
  const height = 48 - inset * 2;
  assert.equal(height, 14, 'highlight should be larger while remaining compact');
  assert.match(rule('.audio-scrubber'), /flex: 0 0 68%/);
  assert.match(rule('.audio-scrubber'), /width: 68%/);
  assert.equal(pixels(rule('.audio-scrubber'), 'height'), 48);
  assert.equal(pixels(rule('.audio-transport-button'), 'width'), 48);
  assert.equal(pixels(rule('.audio-transport-button'), 'height'), 48);
  assert.match(rule('.audio-scrubber-row'), /display: flex/);
});

test('the compact detail tracks remain fixed and centered', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  assert.match(css, /\.audio-precision-panel \{[^}]*align-items: center;/);
  assert.match(css, /\.audio-precision-panel \{ --audio-detail-track-height: 32px; --audio-detail-track-width: 48%;/);
  assert.match(css, /\.audio-magnifier-track \{[^}]*width: var\(--audio-detail-track-width\); height: var\(--audio-detail-track-height\);/);
  assert.match(css, /\.audio-speed-editor \.audio-speed-track \{[^}]*width: var\(--audio-detail-track-width\);/);
  const scrubber = readFileSync(new URL('../frontend/src/observation/audio/AudioScrubber.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(scrubber, /audio-detail-track-left|detailTrackLeftPct/);
  assert.match(css, /\.audio-speed-editor \{[^}]*flex-direction: column; align-items: center;[^}]*padding: 0;/);
  assert.match(css, /\.audio-speed-editor \.audio-speed-readout \{[^}]*margin-top: var\(--timestamp-magnifier-gap, 1px\);/);
});

test('the timestamp always sits closest to the scrubber, on either side of the magnifier', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  const rule = (selector: string) => css.split(`\n${selector} {`)[1]!.split('}')[0]!;
  const above = '.audio-player-bar[data-magnifier-position="above"]';
  // Below: the panel sits under the scrubber, so the item closest to it (time) is first (order 1).
  assert.match(rule('.audio-magnifier-time'), /order: 1/);
  assert.match(rule('.audio-magnifier-track'), /order: 2/);
  assert.match(rule('.audio-precision-panel'), /align-self: stretch/);
  assert.match(rule('.audio-precision-panel'), /justify-content: flex-start/);
  // Above: the panel sits above the scrubber, so the item closest to it (time) is last (order 2),
  // and content hugs the bottom of the panel.
  assert.match(rule(`${above} .audio-magnifier-time`), /order: 2/);
  assert.match(rule(`${above} .audio-magnifier-track`), /order: 1/);
  assert.match(rule(`${above} .audio-precision-panel`), /justify-content: flex-end/);
});

test('scroll controls enter and exit through directional slits', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  const observation = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  for (const animation of ['audio-enter-right', 'audio-enter-left', 'audio-exit-right', 'audio-exit-left']) {
    assert.match(css, new RegExp(`@keyframes ${animation}`));
  }
  assert.match(css, /audio-enter-right[^}]*translateX\(calc\(-50% - 72px\)\)[\s\S]*audio-exit-right[^}]*translateX\(-50%\)/);
  assert.match(css, /audio-enter-left[^}]*translateX\(calc\(-50% \+ 72px\)\)[\s\S]*audio-exit-left[^}]*translateX\(-50%\)/);
  assert.doesNotMatch(css, /clip-path: inset\(0 50%\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*:is\(\.audio-player-bar, \.question-record-controls\) \{ animation: none; transition: none;/);
  assert.match(observation, /data-audio-motion=\{audioMotion\}/);
  assert.match(observation, /data-swipe-direction=\{audioMotionDirection === 1 \? 'right' : 'left'\}/);
});

test('mobile observation controls are larger and text wraps only between words', () => {
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  assert.match(css, /\.observation-text \{[^}]*overflow-wrap: normal; word-break: normal;/);
  const desktopTouchAction = css.indexOf('.observation-screen[data-scroll-mode="true"] { touch-action: pan-y pinch-zoom; }');
  const mobileTouchAction = css.indexOf('.observation-screen[data-scroll-mode="true"] { touch-action: pan-x pinch-zoom; }');
  assert.ok(mobileTouchAction > desktopTouchAction, 'mobile touch action must override the desktop rule');
  assert.match(css, /@media \(max-width: 600px\) and \(hover: none\) and \(pointer: coarse\) \{[\s\S]*\.audio-player-bar \{ grid-template-rows: 56px 112px; width: min\(520px, calc\(100vw - 24px\)\); \}/);
  assert.match(css, /@media \(max-width: 600px\) and \(hover: none\) and \(pointer: coarse\) \{[\s\S]*\.audio-precision-panel \{ --audio-detail-track-height: 44px; --audio-detail-track-width: 64%; \}/);
});

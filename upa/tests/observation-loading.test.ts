import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { DisplayObservation } from '../shared/contracts';
import { observationShowsPhaseIndicator, observationShowsText } from '../frontend/src/observation/observation-content';

function observation(overrides: Partial<DisplayObservation> = {}): DisplayObservation {
  return {
    id: 'observation-1',
    sourceId: 'dummy-source-1',
    sourceKey: 'dummy-1',
    text: 'తెలుగు',
    audio: null,
    kind: 'normal',
    question: null,
    diagnostic: {} as DisplayObservation['diagnostic'],
    ...overrides,
  };
}

test('audio questions without prompt audio reveal their text instead of an icon-only screen', () => {
  const item = observation({
    kind: 'question',
    question: { mode: 'audio-given', requestedPool: null, keyboard: 'windows-inscript', phase: 'question', responseText: '', responseAudio: null },
  });
  assert.equal(observationShowsText(item), true);
  assert.equal(observationShowsPhaseIndicator(item, null), true);
});

test('audio questions hide text only when prompt audio exists', () => {
  const audio = { url: '/audio', mimeType: 'audio/mpeg', durationSeconds: 1 };
  const item = observation({
    audio,
    kind: 'question',
    question: { mode: 'audio-given', requestedPool: null, keyboard: 'windows-inscript', phase: 'question', responseText: '', responseAudio: null },
  });
  assert.equal(observationShowsText(item), false);
  assert.equal(observationShowsPhaseIndicator(item, audio), true);
});

test('contentless question payloads show neither stray phase icon', () => {
  const item = observation({
    text: '   ',
    kind: 'question',
    question: { mode: 'text-given', requestedPool: null, keyboard: null, phase: 'observation', responseText: '', responseAudio: null },
  });
  assert.equal(observationShowsText(item), false);
  assert.equal(observationShowsPhaseIndicator(item, null), false);
});

test('question-set phases use question, comparison, and observation icons', () => {
  const view = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  assert.match(view, /phase === 'comparison'[\s\S]*<Check aria-hidden="true" \/>/);
  assert.match(view, /phase === 'observation'[\s\S]*<AlignJustify aria-hidden="true" \/>/);
  assert.match(view, /<CircleHelp aria-hidden="true" \/>/);
});

test('comparison double-clicks navigate back on the left and forward on the right', () => {
  const comparison = readFileSync(new URL('../frontend/src/observation/ComparisonPage.tsx', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  assert.match(comparison, /const horizontal = \(event\.clientX - bounds\.left\) \/ bounds\.width/);
  assert.match(comparison, /horizontal < 1 \/ 3\) onBack\(\)/);
  assert.match(comparison, /horizontal >= 2 \/ 3\) onAdvance\(\)/);
  assert.match(view, /!audioGivenQuestionPhase && !comparisonQuestionPhase/);
  assert.match(view, /setAudioMotion\('idle'\)/);
});

test('comparison centers both answers without a divider', () => {
  const comparison = readFileSync(new URL('../frontend/src/observation/ComparisonPage.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  assert.doesNotMatch(readFileSync(new URL('../frontend/src/styles/entry-and-evaluation.css', import.meta.url),'utf8')+css,/\.question-comparison::after/);
  assert.match(comparison, /appearanceAudioGlass\(appearance, 0\.45\)/);
  assert.match(comparison, /'--audio-glass-gradient': glass\.gradient, '--audio-glass-edge': glass\.edge/);
  assert.match(comparison, /className="question-comparison-empty" role="img" aria-label="No response recorded">—<\/span>/);
  assert.doesNotMatch(comparison, />No response recorded<\/span>/);
  assert.match(comparison, /if \(!correctPlayer\.current\?\.isPlaying\(\)\) userPlayer\.current\?\.pause\(\);\s*correctPlayer\.current\?\.togglePlay\(\)/);
  assert.match(comparison, /if \(!userPlayer\.current\?\.isPlaying\(\)\) correctPlayer\.current\?\.pause\(\);\s*userPlayer\.current\?\.togglePlay\(\)/);
  assert.doesNotMatch(css, /\.question-comparison-(?:user|correct) > \* \{ transform:/);
  assert.match(css, /\.question-comparison \.audio-player-bar \{[^}]*justify-self: center; align-self: center; width: min\(416px, 100%\)/);
  assert.match(css, /\.question-comparison \.audio-player-bar:not\(:has\(\.audio-precision-panel\[data-visible='true'\]\)\) \{ grid-template-rows: 48px 0; \}/);
  assert.doesNotMatch(css, /controls-visible \.audio-player-bar \{ animation: audio-enter/);
  assert.match(css, /controls-visible \.observation-center > \.audio-player-bar \{ animation: audio-enter/);
});

test('mobile long press owns empty reader space without intercepting controls', () => {
  const view = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../frontend/src/styles/observation-layout.css', import.meta.url), 'utf8');
  assert.match(view, /onPointerDown=\{\(event\) => \{[\s\S]*event\.pointerType !== 'touch'[\s\S]*\.reading-context-menu, \.word-profile'[\s\S]*wordAtPoint\(\{ clientX, clientY, target \}\)/);
  assert.doesNotMatch(view, /className="observation-text"[\s\S]{0,200}onPointerDown/);
  assert.match(css, /\.observation-center \{ -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; \}/);
});

test('reader batches modifier textures and uses the moving slit while waiting', () => {
  const view = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  const gradient = readFileSync(new URL('../frontend/src/observation/TeluguGradientText.tsx', import.meta.url), 'utf8');
  const loader = readFileSync(new URL('../frontend/src/components/LoadingSlit.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../frontend/src/styles/base.css', import.meta.url), 'utf8');
  assert.match(view, /for \(const highlightRun of highlightRuns\)/);
  assert.match(view, /await nextFrame\(\)/);
  assert.match(view, /opacity: entryReady \? 1 : 0/);
  assert.doesNotMatch(gradient, /useEffect|useState|renderTeluguGradientTexture/);
  assert.match(loader, /loading-slit-window[\s\S]*<i \/><i \/><i \/><i \/>/);
  assert.match(css, /@keyframes loading-slit-dot/);
  assert.doesNotMatch(view, /setTimeout\(\(\) => \{[\s\S]{0,200}setInitialGateResolved\(true\)/);
  assert.match(view, /requestAnimationFrame\(\(\) => \{[\s\S]{0,200}requestAnimationFrame\(\(\) => setPaintedPresentationKey/);
  assert.match(view, /const entryReady = entryPrepared && paintedPresentationKey === presentationKey/);
});

test('transition loading dots wait 500ms while the blank overlay remains immediate', () => {
  const view = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  assert.match(view, /if \(!navigationEvent \|\| entryReady\) \{\s*setTransitionLoaderVisible\(false\)/);
  assert.match(view, /setTimeout\(\(\) => setTransitionLoaderVisible\(true\), 500\)/);
  assert.match(view, /const showEntryLoadingIndicator = !navigationEvent \|\| transitionLoaderVisible/);
  assert.match(view, /observation && !entryReady[\s\S]*className="observation-entry-loading"[\s\S]*showEntryLoadingIndicator \? <LoadingSlit/);
});

test('loading dots leave a blank interval between trains', () => {
  const css = readFileSync(new URL('../frontend/src/styles/base.css', import.meta.url), 'utf8');
  assert.match(css, /loading-slit-dot 2\.7s linear infinite/);
  assert.match(css, /i:nth-child\(1\) \{ animation-delay: -720ms; \}/);
  assert.match(css, /i:nth-child\(4\) \{ animation-delay: -180ms; \}/);
  assert.match(css, /58% \{ opacity: 0; transform: translateX\(76px\)[^}]*\} 100% \{ opacity: 0/);
});

test('hidden question answers prewarm gradients and cached textures render without frame delays', () => {
  const view = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  assert.match(view, /const presentationHighlightRuns = appearance\.highlightMods && observation/);
  assert.match(view, /if \(showsObservationText \|\| !observation\) return;/);
  assert.match(view, /document\.fonts\.load\([^;]+hiddenObservation\.text\.slice\(0, 64\)\)/);
  assert.match(view, /requestIdleCallback\(\(\) => resolve\(\), \{ timeout: 250 \}\)/);
  assert.match(view, /if \(!hasTeluguGradientTexture\([\s\S]{0,180}\)\) await nextFrame\(\)/);
  assert.match(view, /const textReady = typography\.ready && gradientsReady;/);
  assert.match(view, /gradientProgress\.completed \/ gradientProgress\.total/);
});

test('stalled observation readiness reports each gate and gradient cache state', () => {
  const view = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  assert.match(view, /setTimeout\(\(\) => \{\s*console\.warn\('\[telugu-now\] observation readiness stalled'/);
  assert.match(view, /observationId: observation\.id/);
  assert.match(view, /typographyFont: typography\.fontFamily/);
  assert.match(view, /fontSetStatus: document\.fonts\.status/);
  assert.match(view, /fontAvailable: fontAvailability\(typography\.fontFamily, observation\.text\)/);
  for (const gate of ['initialPrewarm', 'typography', 'gradients', 'gradientProgress', 'audio', 'audioProgress']) {
    assert.match(view, new RegExp(`${gate}:`));
  }
  assert.match(view, /gradientCache: getTeluguGradientCacheSnapshot\(\)/);
  assert.match(view, /\}, 5000\)/);
});

test('typography cannot stall forever on an unsettled font promise', () => {
  const typography = readFileSync(new URL('../frontend/src/observation/useObservationTypography.ts', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  assert.match(typography, /const FONT_LOAD_TIMEOUT_MS = 3000/);
  assert.match(typography, /Promise\.race\(\[[\s\S]*document\.fonts\.load\(font, text\)[\s\S]*setTimeout\(\(\) => resolve\(false\), FONT_LOAD_TIMEOUT_MS\)/);
  assert.match(typography, /if \(fontReady\) rememberTypography\(cacheKey, result\)/);
  assert.match(typography, /document\.fonts\.addEventListener\('loadingdone', refitLoadedFont\)/);
  assert.match(typography, /typography fit failed; using fallback metrics/);
  assert.match(typography, /if \(fitting\) \{\s*refitRequested = true;\s*forceRefitRequested \|\|= force;\s*return;/);
  assert.match(typography, /setReady\(true\);[\s\S]*while \(refitRequested && !cancelled\)/);
  assert.doesNotMatch(typography, /generation !== fitGeneration/);
  assert.match(typography, /const TYPOGRAPHY_READY_DEADLINE_MS = 4000/);
  assert.match(typography, /diagnosticsRef\.current\.stage = 'deadline-fallback';[\s\S]*setReady\(true\)/);
  assert.match(typography, /fitsCommitted \+= 1;[\s\S]*stage = 'committed';[\s\S]*setReady\(true\)/);
  assert.match(typography, /assignedFontFamily: ObservationFontFamily,\s*textVisible: boolean/);
  assert.match(typography, /observation\?\.text,\s*textVisible,\s*presentation\.fontFamily/);
  assert.match(view, /const showsObservationText = observationShowsText\(observation\);[\s\S]*useObservationTypography\(\s*observation,\s*assignedFont,\s*showsObservationText/);
});

test('profile digits match loader numerals without darkening filled or focused slots', () => {
  const baseCss = readFileSync(new URL('../frontend/src/styles/base.css', import.meta.url), 'utf8');
  const profileCss = readFileSync(new URL('../frontend/src/styles/profile.css', import.meta.url), 'utf8');
  assert.match(baseCss, /\.loading-slit output \{[^}]*font: 500 \.68rem\/18px ui-monospace, monospace/);
  assert.match(profileCss, /\.entry-digit \{[^}]*font-family: ui-monospace, monospace/);
  assert.doesNotMatch(profileCss, /\.entry-digit\[data-filled='true'\][^{]*\{[^}]*border-color/);
  assert.doesNotMatch(profileCss, /\.entry-digit\[data-active='true'\][^{]*\{[^}]*border-color/);
});

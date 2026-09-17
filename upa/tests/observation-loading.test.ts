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
    question: { mode: 'audio-given', keyboard: 'windows-inscript', phase: 'question', responseText: '', responseAudio: null },
  });
  assert.equal(observationShowsText(item), true);
  assert.equal(observationShowsPhaseIndicator(item, null), true);
});

test('audio questions hide text only when prompt audio exists', () => {
  const audio = { url: '/audio', mimeType: 'audio/mpeg', durationSeconds: 1 };
  const item = observation({
    audio,
    kind: 'question',
    question: { mode: 'audio-given', keyboard: 'windows-inscript', phase: 'question', responseText: '', responseAudio: null },
  });
  assert.equal(observationShowsText(item), false);
  assert.equal(observationShowsPhaseIndicator(item, audio), true);
});

test('contentless question payloads show neither stray phase icon', () => {
  const item = observation({
    text: '   ',
    kind: 'question',
    question: { mode: 'text-given', keyboard: null, phase: 'answer', responseText: '', responseAudio: null },
  });
  assert.equal(observationShowsText(item), false);
  assert.equal(observationShowsPhaseIndicator(item, null), false);
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
});

test('loading dots leave a blank interval between trains', () => {
  const css = readFileSync(new URL('../frontend/src/styles/base.css', import.meta.url), 'utf8');
  assert.match(css, /loading-slit-dot 2\.7s linear infinite/);
  assert.match(css, /58% \{ opacity: 0; transform: translateX\(76px\)[^}]*\} 100% \{ opacity: 0/);
});

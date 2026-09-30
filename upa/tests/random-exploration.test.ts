import assert from 'node:assert/strict';
import test from 'node:test';
import { RandomExploration, explorationChoices } from '../frontend/src/observation/random-exploration';
import { DEFAULT_EXPLORATION, explorationWordProbability, parseExploration } from '../shared/exploration';
import { parseAppearance } from '../shared/appearance';
import { parentSettingsPage, visibleSettingsEntries } from '../frontend/src/settings/navigation';

test('every transition has the same draw length, including reverse and constant probabilities', () => {
  for (const [start, end] of [[0,100], [80,20], [30,40], [60,60]]) {
    const settings = { explorationStartWordPercent: start!, explorationEndWordPercent: end!, explorationTransitionDraws: 11 };
    assert.equal(explorationWordProbability(settings, 0), start! / 100);
    assert.equal(explorationWordProbability(settings, 5), (start! + end!) / 200);
    assert.equal(explorationWordProbability(settings, 10), end! / 100);
    assert.equal(explorationWordProbability(settings, 500), end! / 100);
  }
});

test('choose type first, then uniformly choose an occurrence; duplicate words retain offsets', () => {
  const text = 'నేను నేను ఇక్కడ';
  const pool = explorationChoices(text);
  for (const [kind, choices, percent] of [['word', pool.words, 100], ['letter', pool.letters, 0]] as const) {
    for (let index = 0; index < choices.length; index++) {
      const randoms = [0.5, (index + 0.5) / choices.length];
      const session = new RandomExploration(text, { ...DEFAULT_EXPLORATION,
        explorationStartWordPercent: percent, explorationEndWordPercent: percent }, () => randoms.shift()!);
      const choice = session.move('up')!;
      assert.equal(choice.kind, kind);
      assert.deepEqual(choice, choices[index]);
      assert.equal(text.slice(choice.start, choice.end), choice.text);
      if (kind === 'letter') assert.equal(choice.word.slice(choice.graphemeStart, choice.graphemeEnd), choice.text);
      assert.equal(randoms.length, 0);
    }
  }
  assert.notEqual(pool.words[0]!.start, pool.words[1]!.start);
  assert.equal(pool.words[0]!.text, pool.words[1]!.text);
});

test('actual draws reach end probabilities; reverse and forward replay never consume random draws', () => {
  let calls = 0;
  const settings = { explorationStartWordPercent: 0, explorationEndWordPercent: 100, explorationTransitionDraws: 3 };
  const session = new RandomExploration('నేను ఇక్కడ', settings, () => { calls++; return 0.6; });
  const first = session.move('up');
  const second = session.move('up');
  const third = session.move('up');
  assert.equal(first?.kind, 'letter'); assert.equal(second?.kind, 'letter'); assert.equal(third?.kind, 'word');
  assert.equal(session.move('down'), second);
  assert.equal(session.move('up'), third);
  assert.equal(calls, 6); assert.equal(session.drawCount, 3);
  assert.equal(session.move('up')?.kind, 'word');
  session.move('down'); session.move('down'); session.move('down');
  assert.equal(session.move('down'), null);
  assert.equal(session.move('up'), null, 'exited sessions cannot leak their history');
  const nextVisit = new RandomExploration('నేను ఇక్కడ', settings, () => 0.6);
  assert.equal(nextVisit.drawCount, 0);
  assert.equal(nextVisit.move('up')?.kind, 'letter');
});

test('one-word observations include whole-word draws; empty inputs exit safely; repeats are permitted', () => {
  const settings = { ...DEFAULT_EXPLORATION, explorationStartWordPercent: 100, explorationEndWordPercent: 100 };
  const session = new RandomExploration('నేను', settings, () => 0);
  assert.equal(session.move('up')?.text, 'నేను');
  assert.equal(session.move('up')?.text, 'నేను');
  assert.equal(session.drawCount, 2);
  assert.equal(new RandomExploration('… !', settings).move('up'), null);
});

test('saved settings survive profile normalization; legacy profiles get defaults and malformed values are bounded', () => {
  const settings = { explorationStartWordPercent: 32, explorationEndWordPercent: 97, explorationTransitionDraws: 42 };
  const saved = parseAppearance(JSON.parse(JSON.stringify(parseAppearance(settings))));
  assert.deepEqual(parseExploration(saved), settings);
  assert.deepEqual(parseExploration(parseAppearance(null)), DEFAULT_EXPLORATION);
  assert.deepEqual(parseExploration({ explorationStartWordPercent: -30, explorationEndWordPercent: 140, explorationTransitionDraws: 1 }),
    { explorationStartWordPercent: 0, explorationEndWordPercent: 100, explorationTransitionDraws: 2 });
  assert.deepEqual(parseExploration({ explorationStartWordPercent: NaN, explorationEndWordPercent: Infinity }), DEFAULT_EXPLORATION);
});

test('exploration settings have dedicated pages within observations', () => {
  assert.ok(visibleSettingsEntries('observations', false).includes('exploration'));
  assert.equal(parentSettingsPage('exploration'), 'observations');
  for (const page of ['explorationStart', 'explorationEnd', 'explorationDraws'] as const) {
    assert.equal(parentSettingsPage(page), 'exploration');
  }
});

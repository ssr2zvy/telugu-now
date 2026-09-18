import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readingContextMenuState } from '../frontend/src/observation/ReadingContextMenu';
import { settingsGroups, settingsPageLabel } from '../frontend/src/settings/navigation';

test('right-click menu targets either one word or reader settings', () => {
  assert.deepEqual(readingContextMenuState(120, 80, 'తెలుగు'), {
    kind: 'word',
    text: 'తెలుగు',
    x: 120,
    y: 80,
  });
  assert.deepEqual(readingContextMenuState(40, 30, null), {
    kind: 'settings',
    x: 40,
    y: 30,
  });
});

test('word and settings context menus expose disjoint actions', () => {
  const source = readFileSync(new URL('../frontend/src/observation/ReadingContextMenu.tsx', import.meta.url), 'utf8');
  assert.match(source, /menu\.kind === 'word'/);
  assert.match(source, /onCopy\(menu\.text\)[\s\S]*onBlacklistTranscript\(\)[\s\S]*:\s*<button/);
  assert.match(source, /ట్రాన్స్‌క్రిప్ట్‌ను బ్లాక్‌లిస్ట్‌కు జోడించు/);
});

test('diagnostics report the active font without obsolete keyboard weights', () => {
  const app = readFileSync(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../frontend/src/settings/SettingsView.tsx', import.meta.url), 'utf8');
  const diagnostic = readFileSync(new URL('../frontend/src/settings/diagnostic.ts', import.meta.url), 'utf8');
  assert.match(app, /<SettingsView[\s\S]*fontFamily=\{diagnosticFont\}/);
  assert.match(app, /onOpenSettings=\{\(fontFamily\) => \{[\s\S]*setDiagnosticFont\(fontFamily\)/);
  assert.match(settings, /<DiagnosticPage[\s\S]*fontFamily=\{fontFamily\}/);
  assert.match(diagnostic, /fontFamily: \{[\s\S]*en: 'Font'/);
  assert.match(diagnostic, /key: 'fontFamily',[\s\S]*value: fontFamily \?\? t\(language, 'unavailable'\)/);
  assert.doesNotMatch(diagnostic, /keyboardWeights|Keyboard selection weights|33\.3333%/);
});

test('word profiles fill the viewport with word and image columns', () => {
  const source = readFileSync(new URL('../frontend/src/observation/word/WordProfile.tsx', import.meta.url), 'utf8');
  const observation = readFileSync(new URL('../frontend/src/observation/ObservationView.tsx', import.meta.url), 'utf8');
  const letter = readFileSync(new URL('../frontend/src/observation/word/LetterProfile.tsx', import.meta.url), 'utf8');
  const hitTesting = readFileSync(new URL('../frontend/src/observation/visible-glyph-hit-testing.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../frontend/src/styles/word-profile.css', import.meta.url), 'utf8');
  assert.match(source, /<CustomCursor \/>[\s\S]*<header className="word-profile-header" onClick=/);
  assert.match(source, /className="gradient-field word-profile-gradient"[^>]*><div \/><div \/><div \/>/);
  assert.match(source, /appearance\.highlightMods \? teluguHighlightRuns\(analysis\.word\)/);
  assert.match(source, /renderTeluguGradientTexture\(run\.text, fontFamily, appearance\.foreground, gradientEndColor\)/);
  assert.match(source, /<TeluguGradientText key=\{index\} text=\{run\.text\} texture=/);
  assert.match(source, /pane === 'action'[\s\S]*<Sparkles aria-hidden="true" \/>[\s\S]*<Search aria-hidden="true" \/>/);
  assert.doesNotMatch(source, /busy \? <LoaderCircle/);
  assert.doesNotMatch(source, /title=\{analysis\.root\}/);
  assert.match(source, /className="word-profile-back" aria-label="Back to reading"/);
  assert.match(source, /<ReadingContextMenu[\s\S]*onCopy=[\s\S]*onClose=/);
  assert.match(source, /<LetterProfile[\s\S]*onBlacklistTranscript=\{onBlacklistTranscript\}/);
  assert.match(source, /visibleGraphemeAtPoint\(event\.currentTarget, analysis\.word, event\.clientX, event\.clientY\)/);
  assert.match(source, /letterTaps\.tap\(`grapheme:\$\{hit\.start\}`/);
  assert.match(source, /<LetterProfile letter=\{selectedGrapheme\}/);
  assert.doesNotMatch(source, /initiatingWord|excludedWords|letterWordHistory/);
  assert.match(source, /onBlacklistTranscript=\{onBlacklistTranscript\}/);
  assert.match(observation, /addBlacklistEntry\(state\.profileCode, observation\.text\.normalize\('NFC'\)\.trim\(\)\)/);
  assert.match(observation, /contextMenu \? 8 : 2,[\s\S]*contextMenu \? 4 : 2/);
  assert.match(observation, /wordAtPoint\(event, true\)/);
  assert.doesNotMatch(observation, /caretPositionFromPoint|caretRangeFromPoint/);
  assert.match(hitTesting, /context\.getImageData/);
  assert.match(hitTesting, /pixels\[pixel \* 4 \+ 3\]! < alphaThreshold/);
  assert.match(hitTesting, /granularity: 'word', hitSlopPx, verticalHitSlopPx/);
  assert.match(hitTesting, /localX - horizontalRadius[\s\S]*localY - verticalRadius/);
  assert.match(letter, /getGraphemeWord\(profileCode, letter, controller\.signal\)/);
  assert.match(letter, /teluguHighlightRuns\(grapheme\.segment\)/);
  assert.match(letter, /appearanceFocusedLetterColor\(appearance\)/);
  assert.match(letter, /run\.focused \? focusColor : appearance\.foreground/);
  assert.match(letter, /<AudioPlayerBar audio=\{selection\.audio\} sourceId=\{selection\.sourceId\} sourceKey=\{selection\.sourceKey\}/);
  assert.match(letter, /readingContextMenuState\(event\.clientX, event\.clientY, selection\.word\)/);
  assert.match(letter, /onCopy=\{onCopy\} onBlacklistTranscript=\{onBlacklistTranscript\}/);
  assert.doesNotMatch(letter, /silentLeadInUrl|dummyAudio/);
  assert.match(css, /\.word-profile \{[^}]*position: fixed; inset: 0;[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /width: 100vw; max-width: none; height: 100dvh; max-height: none/);
  assert.match(source, /new Intl\.Segmenter\('te', \{ granularity: 'grapheme' \}\)/);
  assert.match(source, /'--word-graphemes': Math\.max\(1, graphemeCount\)/);
  assert.match(css, /\.word-profile-header \{[^}]*container-type: inline-size;[^}]*place-items: center;[^}]*user-select: none/);
  assert.match(css, /\.word-profile-gradient \{ position: fixed; z-index: 0; clip-path: inset\(0 50% 0 0\); \}/);
  assert.match(css, /\.word-profile-header h2 \{[^}]*font-size: clamp\(\.75rem, calc\(80cqi \/ var\(--word-graphemes\)\), 9rem\)[^}]*white-space: nowrap; text-align: center/);
  assert.match(css, /\.word-profile-header h2 \{[^}]*line-height: 1\.2; font-weight: 400/);
  assert.match(css, /\.letter-profile-center h2 \{[^}]*font-size: clamp\(2\.5rem, calc\(82vw \/ var\(--word-graphemes\)\), 10rem\)[^}]*font-weight: 400; line-height: 1\.2/);
  assert.match(css, /\.letter-profile-focus \{ color: var\(--letter-focus-color\); \}/);
  assert.match(css, /\.word-image-preview \{[^}]*width: 100%; height: 100%/);
  assert.match(css, /\.word-image-preview img \{[^}]*object-fit: cover/);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*grid-template-columns: minmax\(0, 1fr\); grid-template-rows: minmax\(180px, 40dvh\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*\.word-profile-gradient \{ clip-path: inset\(0 0 60% 0\); \}/);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*\.word-profile-header h2 \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*\.word-image-gallery \{ display: flex; flex-direction: column; align-items: center;/);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*\.word-image-gallery button \{[^}]*width: min\(44vw, 180px\);/);
});

test('errors enter over the bottom-right corner and fade within fifteen seconds', () => {
  const css = readFileSync(new URL('../frontend/src/styles/base.css', import.meta.url), 'utf8');
  assert.match(css, /\.appearance-root :is\(\[role='alert'\], \.settings-error\) \{[^}]*position: fixed;[^}]*right: max\(20px, env\(safe-area-inset-right\)\);[^}]*bottom: max\(16px, env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /background: rgb\(70 70 70 \/ \.96\);[^}]*box-shadow: 0 10px 30px rgb\(0 0 0 \/ \.28\);[^}]*color: #fff/);
  assert.match(css, /animation: app-error-notice 15s ease forwards/);
  assert.match(css, /0% \{ opacity: 0; transform: translate\(24px, 24px\); \}[\s\S]*100% \{ opacity: 0; transform: translate\(0\); visibility: hidden; \}/);

  for (const relativePath of [
    '../frontend/src/appearance.tsx',
    '../frontend/src/observation/audio/AudioPlayerBar.tsx',
    '../frontend/src/observation/word/WordProfile.tsx',
    '../frontend/src/settings/pages/EonsPage.tsx',
    '../frontend/src/settings/pages/BlacklistPage.tsx',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /role="alert"[\s\S]{0,300}<button/, relativePath);
  }
});

test('modification lightness has visible searchable settings text', () => {
  const source = readFileSync(new URL('../frontend/src/settings/pages/OrganizedAppearancePage.tsx', import.meta.url), 'utf8');
  assert.match(source, /<label htmlFor="appearance-modification-lightness">\{text\('Modification Lightness'/);
  assert.match(source, /text\('Automatic End Color'/);
  assert.match(source, /text\('Gradient End Color'/);
  assert.match(source, /type="color"[\s\S]*modificationColor/);
});

test('queue diagnostics are available under the Diagnostic settings group', () => {
  assert.ok(settingsGroups.diagnostic?.includes('queue'));
  assert.equal(settingsPageLabel('queue', 'en'), 'View the Queue');
  const view = readFileSync(new URL('../frontend/src/settings/pages/QueueViewPage.tsx', import.meta.url), 'utf8');
  assert.match(view, /data\.slots\.map/);
  assert.match(view, /getTeluguGradientCacheSnapshot/);
  assert.match(view, /Font render/);
});

import './style.css';
import { installLiveObservationFontFaces } from '../../upa/frontend/src/font-assets';
import { OBSERVATION_FONTS, type ObservationFontFamily } from '../../upa/shared/appearance';
import { teluguHighlightRuns, type HighlightRun } from '../../upa/frontend/src/observation/telugu-highlighting';
import {
  renderTeluguGradientTexture,
  type TeluguGradientTexture,
} from '../../upa/frontend/src/observation/telugu-gradient-renderer';

const WORD = 'సభ్యులుగా';
const FOREGROUND = '#172026';
const MODIFICATION = '#5475b7';
const legacySafariMode = new URLSearchParams(location.search).get('mode') !== 'modern';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header>
    <p class="eyebrow">Safari grapheme segmentation reproduction</p>
    <h1 lang="te">${WORD}</h1>
    <p class="lede">Older Safari Unicode data splits the conjunct as <code>భ్ | యు</code>. Modern browsers keep <code>భ్యు</code> together. Both modes use loaded Google Fonts and Telugu Now's production renderer.</p>
    <nav aria-label="Reproduction mode">
      <a href="/?mode=legacy" aria-current="${legacySafariMode ? 'page' : 'false'}">Legacy Safari segmentation</a>
      <a href="/?mode=modern" aria-current="${legacySafariMode ? 'false' : 'page'}">Modern segmentation</a>
    </nav>
    <p class="mode-status"><strong>${legacySafariMode ? 'Legacy Safari' : 'Modern'}</strong> · ${legacySafariMode ? 'భ్ and యు are shaped independently' : 'భ్యు is shaped as one conjunct'}</p>
    <div class="legend"><span><i class="base-dot"></i>base</span><span><i class="mod-dot"></i>modifier</span></div>
  </header>
  <main aria-label="Font comparison">
    <div class="comparison-head"><span>Font</span><span>Normal browser text</span><span>Telugu Now rendering</span></div>
    <div id="font-rows" class="font-rows" aria-live="polite"></div>
  </main>
`;

function gradientSpan(text: string, texture: TeluguGradientTexture): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'telugu-gradient-text is-ready';
  span.textContent = text;
  span.style.setProperty('--telugu-gradient-image', `url(${texture.url})`);
  span.style.setProperty('--telugu-gradient-width', `${texture.widthEm}em`);
  span.style.setProperty('--telugu-gradient-height', `${texture.heightEm}em`);
  span.style.setProperty('--telugu-gradient-left', `${texture.leftEm}em`);
  span.style.setProperty('--telugu-gradient-top', `${texture.topEm}em`);
  return span;
}

function highlightRuns(): HighlightRun[] {
  if (!legacySafariMode) return teluguHighlightRuns(WORD);
  return [
    { text: 'స', highlighted: false },
    { text: 'భ్', highlighted: true },
    { text: 'యు', highlighted: true },
    { text: 'లు', highlighted: true },
    { text: 'గా', highlighted: true },
  ];
}

async function renderedWord(fontFamily: ObservationFontFamily): Promise<HTMLDivElement> {
  const output = document.createElement('div');
  output.className = 'sample app-rendered';
  output.lang = 'te';
  output.style.fontFamily = `"${fontFamily}", sans-serif`;
  const runs = highlightRuns();
  const textures = await Promise.all(runs.map(run => run.highlighted
    ? renderTeluguGradientTexture(run.text, fontFamily, FOREGROUND, MODIFICATION)
    : null));
  runs.forEach((run, index) => {
    const texture = textures[index];
    output.append(texture ? gradientSpan(run.text, texture) : document.createTextNode(run.text));
  });
  return output;
}

async function render(): Promise<void> {
  const rows = document.querySelector<HTMLDivElement>('#font-rows')!;
  installLiveObservationFontFaces();
  await Promise.all(OBSERVATION_FONTS.map(fontFamily =>
    document.fonts.load(`400 220px "${fontFamily}"`, WORD)));
  for (const fontFamily of OBSERVATION_FONTS) {
    const row = document.createElement('section');
    row.className = 'font-row';
    const label = document.createElement('h2');
    label.textContent = fontFamily;
    const normal = document.createElement('div');
    normal.className = 'sample';
    normal.lang = 'te';
    normal.style.fontFamily = `"${fontFamily}", sans-serif`;
    normal.textContent = WORD;
    row.append(label, normal, await renderedWord(fontFamily));
    rows.append(row);
  }
}

void render();
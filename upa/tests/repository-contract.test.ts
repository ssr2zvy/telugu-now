import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  spawnSync,
} from 'node:child_process';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';
const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );
test('runtime user and global storage paths remain under root data from any working directory', async () => {
  const { resolveDataPath } = await import('../server/src/config/config');
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(resolveDataPath(undefined, 'users.sqlite'), path.resolve(root, '../data/users.sqlite'));
    assert.throws(() => resolveDataPath(path.resolve(root, 'data/app.sqlite'), 'users.sqlite'), /must stay under/);
    assert.throws(() => resolveDataPath('/tmp/outside.sqlite', 'users.sqlite'), /must stay under/);
    assert.equal(resolveDataPath(path.resolve(root, '../data/corpus/corpus.sqlite'), ''), path.resolve(root, '../data/corpus/corpus.sqlite'));
    const controller = fs.readFileSync(path.resolve(root, '../local-machine/control_local.sh'), 'utf8');
    assert.ok(controller.includes('RAW_DATA_DIR="$DATA_TRANSFORM_DIR/raw"'));
    assert.ok(controller.includes('SAMPLE_DATA_DIR="$DATA_TRANSFORM_DIR/sample"'));
    assert.ok(controller.includes('PREPARED_CORPUS_DIR="$REPO_DIR/data/corpus"'));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
function read(
  relativePath: string,
): string {
  return fs.readFileSync(
    path.join(
      root,
      relativePath,
    ),
    'utf8',
  );
}
test('controls restrict hover feedback to mouse pointers and retain keyboard and selected states', () => {
  for (const file of fs.readdirSync(path.join(root, 'frontend/src/styles')).filter(file => file.endsWith('.css'))) {
    const css = read(`frontend/src/styles/${file}`);
    if (file !== 'base.css') assert.doesNotMatch(css, /:active\b/, file);
    if (css.includes(':hover')) assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/, file);
  }
  const base = read('frontend/src/styles/base.css');
  assert.match(base, /:focus-visible\s*\{\s*outline: 2px solid var\(--foreground\);\s*outline-offset: -3px/);
  assert.match(base, /button, \[role="button"\] \{\s*-webkit-user-select: none;\s*user-select: none;\s*-webkit-touch-callout: none;/);
  const settings = read('frontend/src/styles/settings-layout.css');
  assert.match(settings, /input:checked \+ span \{ background:/);
  assert.match(settings, /input:checked::after/);
  assert.match(settings, /\[aria-current='page'\] \{ background:/);
});
test('Settings fields use a single rounded focus surface and compact accessible percent units', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ComplexityPage } = await import('../frontend/src/settings/pages/ComplexityPage');
  const { SourceWeightsPage } = await import('../frontend/src/settings/pages/SourceWeightsPage');
  const { PlaybackSpeedPage } = await import('../frontend/src/settings/pages/PlaybackSpeedPage');
  const props = {
    language: 'en' as const, draft: { targetPercent: '50', spreadPercent: '25', sourceWeights: { 'fleurs-te': '1' } },
    saving: false, error: false, onDraftChange: () => {}, onClearError: () => {}, onSave: () => {},
  };
  const complexity = renderToStaticMarkup(createElement(ComplexityPage, props));
  assert.equal((complexity.match(/class="field-value"/g) ?? []).length, 2);
  assert.equal((complexity.match(/inputMode="decimal"/g) ?? []).length, 2);
  assert.equal((complexity.match(/aria-description="Percent"/g) ?? []).length, 2);
  assert.equal((complexity.match(/class="field-unit" aria-hidden="true">%/g) ?? []).length, 2);
  assert.match(complexity, /aria-label="Target"/);
  assert.match(complexity, /aria-label="Spread"/);
  assert.match(renderToStaticMarkup(createElement(SourceWeightsPage, props)), /inputMode="decimal"/);
  assert.match(renderToStaticMarkup(createElement(PlaybackSpeedPage, {
    language: 'en', rate: '1', saving: false, error: false, onRateChange: () => {}, onClearError: () => {}, onSave: () => {},
  })), /inputMode="decimal"/);
  const css = read('frontend/src/styles/settings-layout.css');
  assert.match(css, /\.settings-form \.field-value \{[^}]*height: 44px;[^}]*gap: 3px;[^}]*border-radius: 6px/);
  assert.match(css, /\.field-value \.field-unit \{[^}]*font-size: 11px/);
  assert.match(css, /\.settings-form \.field-value:focus-within,[^{]+\{[^}]*box-shadow: 0 0 0 2px/);
  assert.match(css, /\.settings-form \.field-value input \{[^}]*background: transparent; box-shadow: none/);
  assert.doesNotMatch(css, /border-bottom-color/);
});
test('Settings editable controls retain a real 16px font floor without disabling zoom or keyboard access', () => {
  const css = read('frontend/src/styles/settings-layout.css');
  assert.match(css, /\.settings-screen input, \.settings-screen textarea, \.settings-screen select \{ font-size: max\(16px, 1rem\); scroll-margin-block: 24px/);
  assert.match(css, /\.settings-screen \.image-generation-settings textarea \{[^}]*font-size: max\(16px, 1rem\)/);
  assert.match(css, /\.settings-page-content \{[^}]*min-width: 0;[^}]*overflow-x: hidden; overflow-y: auto/);
  assert.match(css, /scrollbar-gutter: stable; scroll-padding-block: 24px/);
  const shell = read('frontend/src/settings/SettingsShell.tsx');
  assert.match(shell, /window\.visualViewport/);
  assert.match(shell, /container\.contains\(element\)/);
  assert.match(shell, /Math\.abs\(viewport\.scale - 1\) > 0\.01/);
  assert.match(shell, /style\.setProperty\('--settings-viewport-height', `\$\{viewport\.height\}px`\)/);
  assert.match(shell, /style\.setProperty\('--settings-viewport-top', `\$\{viewport\.offsetTop\}px`\)/);
  assert.match(shell, /container\.scrollBy\(\{ top:/);
  for (const event of ['resize', 'scroll']) {
    assert.ok(shell.includes(`viewport.removeEventListener('${event}', updateViewport)`));
  }
  for (const event of ['focusin', 'focusout']) {
    assert.ok(shell.includes(`document.removeEventListener('${event}', updateViewport)`));
  }
  assert.doesNotMatch(shell, /preventDefault|\.blur\(|scrollIntoView|scrollTo\([^0]/);
  assert.doesNotMatch(read('frontend/index.html'), /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
});
test('Settings secondary labels and inset dividers preserve localized hierarchy', () => {
  const css = read('frontend/src/styles/settings-layout.css');
  assert.match(css, /--muted: color-mix\(in srgb, var\(--foreground\) 74%, var\(--surface\)\)/);
  assert.match(css, /--line: color-mix\(in srgb, var\(--foreground\) 7%, transparent\)/);
  assert.match(css, /\.settings-context \{[^}]*font-weight: 600/);
  assert.match(css, /\.settings-screen\[lang='en'\] \.settings-context \{ letter-spacing: \.035em/);
  assert.match(css, /\.settings-entry-meta \{[^}]*font-weight: 500/);
  assert.match(css, /\.settings-rail-child \{[^}]*font-weight: 500/);
  assert.match(css, /\.settings-index button:not\(:last-child\)::after \{[^}]*inset-inline: 54px 12px;[^}]*height: 1px/);
});
test(
  'local controller lives under local-machine with no obsolete controller names',
  () => {
    const control =
      path.resolve(
        root,
        '..',
        'local-machine',
        'control_local.sh',
      );
    assert.equal(
      fs.existsSync(
        control,
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.resolve(
          root,
          '..',
          'control-project.sh',
        ),
      ),
      false,
    );
    assert.equal(fs.existsSync(path.resolve(root, '..', 'control.sh')), false);
    assert.equal(fs.existsSync(path.resolve(root, '..', 'current.md')), false);
    assert.ok(
      (
        fs.statSync(
          control,
        ).mode &
        0o111
      ) !== 0,
    );
    const syntax =
      spawnSync(
        'bash',
        [
          '-n',
          control,
        ],
        {
          encoding:
            'utf8',
        },
      );
    assert.equal(
      syntax.status,
      0,
      syntax.stderr,
    );
    const readme =
      read(
        'README.md',
      );
    assert.equal(
      readme.includes(
        'control-project.sh',
      ),
      false,
    );
    assert.ok(readme.includes('./local-machine/control_local.sh'));
    assert.ok(fs.readFileSync(control, 'utf8').includes('run_data_domain'));
    assert.ok(fs.readFileSync(control, 'utf8').includes('CORPUS_NOT_PREPARED'));
    assert.equal(fs.existsSync(path.resolve(root, '..', 'local-machine', 'data-transform', 'scripts', 'create-tigris-schema', 'prepare.py')), true);
    assert.equal(fs.existsSync(path.resolve(root, '..', 'local-machine', 'data-transform', 'requirements.txt')), true);
    const registry = read('server/src/services/source-registry.ts');
    assert.ok(registry.includes("'fleurs-te'"));
    assert.ok(registry.includes("'shrutilipi-te'"));
    assert.ok(registry.includes("'indicvoices-te'"));

    assert.equal(
      fs.existsSync(
        path.join(
          root,
          'VALIDATION.md',
        ),
      ),
      false,
    );
    assert.equal(
      readme.includes(
        'VALIDATION.md',
      ),
      false,
    );
  },
);
test(
  'Iteration 2 frontend remains modular across profile, observation, settings, and export packaging',
  () => {
    const requiredFiles = [
      'frontend/src/components/icons.tsx',
      'frontend/src/profile/ProfileEntry.tsx',
      'frontend/src/profile/useProfileSession.ts',
      'frontend/src/observation/ObservationView.tsx',
      'frontend/src/observation/useObservationTypography.ts',
      'frontend/src/settings/types.ts',
      'frontend/src/settings/language.ts',
      'frontend/src/settings/settings-utils.ts',
      'frontend/src/settings/diagnostic.ts',
      'frontend/src/settings/SettingsShell.tsx',
      'frontend/src/settings/SettingsView.tsx',
      'frontend/src/settings/useSettingsController.ts',
      'frontend/src/settings/pages/SettingsIndex.tsx',
      'frontend/src/settings/pages/ComplexityPage.tsx',
      'frontend/src/settings/pages/SourceWeightsPage.tsx',
      'frontend/src/settings/pages/DiagnosticPage.tsx',
      'frontend/src/settings/pages/ExportPage.tsx',
      'frontend/src/settings/pages/DataSourcesPage.tsx',
      'server/src/sources/prepared-corpus/prepared-corpus-store.ts',
      'server/src/sources/prepared-corpus/prepared-corpus-data-source.ts',
      'frontend/src/export-artifact.ts',
      'frontend/src/export-viewer.ts',
      'frontend/src/export-html.ts',
      'frontend/src/export-epub.ts',
      'frontend/src/zip.ts',
      'frontend/src/font-assets.ts',
      'frontend/font-assets.json',
      'scripts/sync-fonts.mjs',
      'frontend/src/styles/base.css',
      'frontend/src/styles/profile.css',
      'frontend/src/styles/observation-layout.css',
      'frontend/src/styles/settings-layout.css',
    ];
    for (
      const relativePath
      of requiredFiles
    ) {
      assert.equal(
        fs.existsSync(
          path.join(
            root,
            relativePath,
          ),
        ),
        true,
        `${relativePath} should exist`,
      );
    }
    const app =
      read(
        'frontend/src/App.tsx',
      );
    assert.ok(
      app.includes(
        "from './profile/ProfileEntry'",
      ),
    );
    assert.ok(
      app.includes(
        "from './profile/useProfileSession'",
      ),
    );
    assert.ok(
      app.includes(
        "from './observation/ObservationView'",
      ),
    );
    assert.ok(
      app.includes(
        "from './settings/SettingsView'",
      ),
    );
    assert.ok(
      app.includes(
        "from './settings/useSettingsController'",
      ),
    );
    assert.equal(
      app.includes(
        'settings-modal',
      ),
      false,
    );
    assert.equal(
      app.includes(
        'chooseRandomObservationFont',
      ),
      false,
    );
    assert.ok(
      app.split(
        '\n',
      ).length <
        100,
    );
  },
);
test(
  'Settings export uses a transient format chooser and keeps format out of selection',
  () => {
    const settingsView =
      read(
        'frontend/src/settings/SettingsView.tsx',
      );
    const exportPage =
      read(
        'frontend/src/settings/pages/ExportPage.tsx',
      );
    const controller =
      read(
        'frontend/src/settings/useSettingsController.ts',
      );
    const language =
      read(
        'frontend/src/settings/language.ts',
      );
    const styles =
      read(
        'frontend/src/styles/settings-layout.css',
      );
    assert.ok(
      settingsView.includes(
        'formatChooserOpen={formatChooserOpen}',
      ),
    );
    assert.ok(
      settingsView.includes(
        'onRequestExport={controller.requestExport}',
      ),
    );
    assert.ok(
      settingsView.includes(
        'controller.chooseExportFormat(format)',
      ),
    );
    assert.ok(
      exportPage.includes(
        'className="export-format-modal"',
      ),
    );
    assert.ok(
      exportPage.includes(
        "onChooseFormat('epub')",
      ),
    );
    assert.ok(
      exportPage.includes(
        "onChooseFormat('html')",
      ),
    );
    assert.ok(
      exportPage.includes(
        'downloadPreparedExportArtifact(preparedArtifact)',
      ),
    );
    assert.ok(
      controller.includes(
        'const [generatedExport, setGeneratedExport]',
      ),
    );
    assert.ok(
      controller.includes(
        'const [preparedArtifact, setPreparedArtifact]',
      ),
    );
    assert.ok(
      controller.includes(
        'setFormatChooserOpen(true)',
      ),
    );
    assert.ok(
      controller.includes(
        'result = await generateExport(profileCode, { count })',
      ),
    );
    assert.ok(
      controller.includes(
        "format === 'epub'",
      ),
    );
    assert.ok(
      controller.includes(
        'await prepareEpubExport(result)',
      ),
    );
    assert.ok(
      controller.includes(
        'await prepareHtmlExport(result)',
      ),
    );
    assert.equal(
      controller.includes(
        'generateExport(profileCode, { count, format',
      ),
      false,
    );
    assert.ok(
      language.includes(
        "chooseExportFormat: 'Choose export format'",
      ),
    );
    assert.ok(
      language.includes(
        "epubDescription: 'iPhone / iPad · Apple Books · Interactive · Offline'",
      ),
    );
    assert.ok(
      language.includes(
        "htmlDescription: 'Browser / Desktop · Interactive · Offline'",
      ),
    );
    assert.ok(
      styles.includes(
        '.export-format-modal::backdrop',
      ),
    );
    assert.ok(exportPage.includes('dialog.showModal()'));
    assert.ok(exportPage.includes('role="progressbar"'));
    assert.equal(controller.includes('let result = generatedExport'), false);
    assert.ok(
      styles.includes(
        '.export-format-modal',
      ),
    );
  },
);
test(
  'export packaging has one shared viewer runtime and separate HTML/EPUB wrappers',
  () => {
    const viewer =
      read(
        'frontend/src/export-viewer.ts',
      );
    const html =
      read(
        'frontend/src/export-html.ts',
      );
    const epub =
      read(
        'frontend/src/export-epub.ts',
      );
    const artifact =
      read(
        'frontend/src/export-artifact.ts',
      );
    for (
      const functionName
      of [
        'buildStandaloneViewerCss',
        'buildStandaloneViewerMarkup',
        'buildStandaloneViewerScript',
      ]
    ) {
      assert.ok(
        viewer.includes(
          `export function ${functionName}`,
        ),
      );
      assert.ok(
        html.includes(
          `${functionName}(`,
        ),
      );
      assert.ok(
        epub.includes(
          `${functionName}(`,
        ),
      );
    }
    assert.ok(
      viewer.includes(
        'const PRESENTATION=',
      ),
    );
    assert.ok(
      viewer.includes(
        'function chooseFont()',
      ),
    );
    assert.ok(
      viewer.includes(
        'function preferredSize(',
      ),
    );
    assert.ok(
      viewer.includes(
        'function fitActive()',
      ),
    );
    assert.ok(
      viewer.includes(
        'document.fonts.load',
      ),
    );
    assert.ok(
      viewer.includes(
        "window.addEventListener('resize'",
      ),
    );
    assert.ok(
      artifact.includes(
        "export type ExportFormat = 'html' | 'epub'",
      ),
    );
    assert.ok(
      artifact.includes(
        'downloadPreparedExportArtifact',
      ),
    );
  },
);
test(
  'EPUB wrapper declares a scripted EPUB 3 package with all local fonts and no ZIP dependency',
  () => {
    const epub =
      read(
        'frontend/src/export-epub.ts',
      );
    const zip =
      read(
        'frontend/src/zip.ts',
      );
    const packageJson =
      JSON.parse(
        read(
          'package.json',
        ),
      ) as {
        dependencies?:
          Record<
            string,
            string
          >;
      };
    assert.ok(
      epub.includes(
        "data: 'application/epub+zip'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'META-INF/container.xml'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/package.opf'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/nav.xhtml'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/viewer.xhtml'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/viewer.css'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/viewer.js'",
      ),
    );
    assert.ok(
      epub.includes(
        "name: 'EPUB/data.json'",
      ),
    );
    assert.ok(
      epub.includes(
        'properties="scripted"',
      ),
    );
    assert.ok(
      epub.includes(
        'properties="nav"',
      ),
    );
    assert.ok(
      epub.includes(
        'prefix="ibooks: http://vocabulary.itunes.apple.com/rdf/ibooks/vocabulary-extensions-1.0/"',
      ),
    );
    assert.ok(
      epub.includes(
        '<meta property="ibooks:specified-fonts">true</meta>',
      ),
    );
    assert.ok(
      epub.includes(
        'font/woff2',
      ),
    );
    assert.ok(
      epub.includes(
        'loadObservationFontBundle()',
      ),
    );
    assert.ok(
      epub.includes(
        'createStoredZip(entries)',
      ),
    );
    assert.ok(
      zip.includes(
        'const STORE_METHOD = 0',
      ),
    );
    assert.ok(
      zip.includes(
        '0x04034b50',
      ),
    );
    assert.ok(
      zip.includes(
        '0x02014b50',
      ),
    );
    assert.ok(
      zip.includes(
        '0x06054b50',
      ),
    );
    assert.equal(
      packageJson
        .dependencies
        ?.jszip,
      undefined,
    );
    assert.equal(
      packageJson
        .dependencies
        ?.fflate,
      undefined,
    );
  },
);
test(
  'live presentation remains local-font, monochrome, keyboard-stable, and activation-randomized',
  () => {
    const icons =
      read(
        'frontend/src/components/icons.tsx',
      );
    const profileEntry =
      read(
        'frontend/src/profile/ProfileEntry.tsx',
      );
    const observationView =
      read(
        'frontend/src/observation/ObservationView.tsx',
      );
    const typography =
      read(
        'frontend/src/observation/useObservationTypography.ts',
      );
    const presentation =
      read(
        'frontend/src/presentation.ts',
      );
    const appearance = read('shared/appearance.ts');
    assert.ok(presentation.includes("from '../../shared/appearance'"));
    const fontAssets =
      read(
        'frontend/src/font-assets.ts',
      );
    const main =
      read(
        'frontend/src/main.tsx',
      );
    const baseStyles =
      read(
        'frontend/src/styles/base.css',
      );
    const profileStyles =
      read(
        'frontend/src/styles/profile.css',
      );
    const observationStyles =
      read(
        'frontend/src/styles/observation-layout.css',
      );
    const indexHtml =
      read(
        'frontend/index.html',
      );
    assert.ok(
      icons.includes(
        'export function SettingsIcon',
      ),
    );
    assert.ok(
      icons.includes(
        'export function LanguageIcon',
      ),
    );
    assert.equal(
      icons.includes(
        '⚙',
      ),
      false,
    );
    assert.equal(
      icons.includes(
        '🌐',
      ),
      false,
    );
    assert.ok(
      baseStyles.includes(
        'stroke: currentColor',
      ),
    );
    assert.ok(
      profileEntry.includes(
        "'--entry-layout-height'",
      ),
    );
    assert.ok(
      /height:\s*var\(\s*--entry-layout-height/
        .test(
          profileStyles,
        ),
    );
    assert.equal(
      observationView.includes(
        'className="settings-trigger"',
      ),
      false,
    );
    assert.ok(
      observationView.includes(
        'useObservationTypography(',
      ),
    );
    assert.ok(
      typography.includes(
        'chooseRandomObservationFont(Math.random, appearance.fonts)',
      ),
    );
    assert.ok(
      typography.includes(
        'OBSERVATION_PRESENTATION.fitIterations',
      ),
    );
    assert.ok(
      typography.includes(
        'document.fonts.load(',
      ),
    );
    assert.ok(
      observationStyles.includes(
        '.nav-zone:disabled',
      ),
    );
    assert.equal(
      observationStyles.includes(
        '.settings-trigger',
      ),
      false,
    );
    assert.ok(
      observationStyles.includes(
        'bottom:',
      ),
    );
    assert.ok(
      main.includes(
        'installLiveObservationFontFaces()',
      ),
    );
    assert.ok(
      fontAssets.includes(
        'loadObservationFontBundle',
      ),
    );
    assert.doesNotMatch(
      indexHtml,
      /https?:\/\/fonts\.googleapis\.com/,
    );
    for (
      const family
      of [
        'Noto Sans Telugu',
        'Noto Serif Telugu',
        'Mandali',
        'Ramabhadra',
        'NTR',
        'Peddana',
        'Ramaraja',
        'Sree Krushnadevaraya',
        'Suranna',
        'Tenali Ramakrishna',
      ]
    ) {
      assert.ok(
        appearance.includes(
          `'${family}'`,
        ),
      );
    }
  },
);

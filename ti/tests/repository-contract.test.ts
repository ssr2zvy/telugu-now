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
test(
  'Iteration 2 controller is control.sh with no stale control-project.sh surface',
  () => {
    const control =
      path.resolve(
        root,
        '..',
        'control.sh',
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
    assert.ok(readme.includes('./control.sh'));
    assert.ok(fs.readFileSync(control, 'utf8').includes('run_data_domain'));
    assert.ok(fs.readFileSync(control, 'utf8').includes('CORPUS_NOT_PREPARED'));
    assert.equal(fs.existsSync(path.resolve(root, '..', 'data-transform', 'scripts', 'create-tigris-schema', 'prepare.py')), true);
    assert.equal(fs.existsSync(path.resolve(root, '..', 'data-transform', 'requirements.txt')), true);
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
      'frontend/src/styles/observation.css',
      'frontend/src/styles/settings.css',
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
        'frontend/src/styles/settings.css',
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
        '.export-format-backdrop',
      ),
    );
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
        'frontend/src/styles/observation.css',
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
    assert.ok(
      observationView.includes(
        '<SettingsIcon />',
      ),
    );
    assert.ok(
      observationView.includes(
        'useObservationTypography(',
      ),
    );
    assert.ok(
      typography.includes(
        'chooseRandomObservationFont()',
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
    assert.ok(
      observationStyles.includes(
        '.settings-trigger',
      ),
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
        presentation.includes(
          `'${family}'`,
        ),
      );
    }
  },
);

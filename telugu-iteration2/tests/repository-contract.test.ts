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
const root = path.resolve(
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
      path.join(
        root,
        'control.sh',
      );
    assert.equal(
      fs.existsSync(control),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          root,
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
      'control.sh should remain executable',
    );
    const syntax =
      spawnSync(
        'bash',
        [
          '-n',
          control,
        ],
        {
          encoding: 'utf8',
        },
      );
    assert.equal(
      syntax.status,
      0,
      syntax.stderr,
    );
    const readme =
      read('README.md');
    assert.equal(
      readme.includes(
        'control-project.sh',
      ),
      false,
    );
    assert.ok(
      readme.includes(
        './control.sh',
      ),
    );
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
  'Iteration 2 frontend is split by profile, observation, settings, and shared UI ownership',
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
        'section-toggle',
      ),
      false,
    );
    assert.equal(
      app.includes(
        'className="diagnostic-table"',
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
      app.split('\n').length <
        100,
      'App.tsx should remain composition-focused',
    );
  },
);
test(
  'Iteration 2 Settings contract remains page-based with table diagnostics and two-stage export',
  () => {
    const settingsTypes =
      read(
        'frontend/src/settings/types.ts',
      );
    const settingsView =
      read(
        'frontend/src/settings/SettingsView.tsx',
      );
    const shell =
      read(
        'frontend/src/settings/SettingsShell.tsx',
      );
    const diagnosticPage =
      read(
        'frontend/src/settings/pages/DiagnosticPage.tsx',
      );
    const exportPage =
      read(
        'frontend/src/settings/pages/ExportPage.tsx',
      );
    const settingsController =
      read(
        'frontend/src/settings/useSettingsController.ts',
      );
    const styles =
      read(
        'frontend/src/styles/settings.css',
      );
    const readme =
      read('README.md');
    assert.ok(
      settingsTypes.includes(
        "| 'complexity'",
      ),
    );
    assert.ok(
      settingsTypes.includes(
        "| 'sources'",
      ),
    );
    assert.ok(
      settingsTypes.includes(
        "| 'diagnostic'",
      ),
    );
    assert.ok(
      settingsTypes.includes(
        "| 'export'",
      ),
    );
    assert.ok(
      settingsView.includes(
        '<SettingsIndex',
      ),
    );
    assert.ok(
      settingsView.includes(
        '<ComplexityPage',
      ),
    );
    assert.ok(
      settingsView.includes(
        '<SourceWeightsPage',
      ),
    );
    assert.ok(
      settingsView.includes(
        '<DiagnosticPage',
      ),
    );
    assert.ok(
      settingsView.includes(
        '<ExportPage',
      ),
    );
    assert.ok(
      shell.includes(
        'className="language-toggle"',
      ),
    );
    assert.ok(
      diagnosticPage.includes(
        'className="diagnostic-table"',
      ),
    );
    assert.ok(
      exportPage.includes(
        'downloadExportHtml(preparedExport)',
      ),
    );
    assert.ok(
      settingsController.includes(
        'preparedExport',
      ),
    );
    assert.ok(
      settingsController.includes(
        'setPreparedExport(null)',
      ),
    );
    assert.ok(
      styles.includes(
        '.settings-screen',
      ),
    );
    assert.ok(
      styles.includes(
        '.diagnostic-table',
      ),
    );
    assert.equal(
      readme.includes(
        'collapsed settings modal',
      ),
      false,
    );
    assert.equal(
      readme.includes(
        'collapsed sections',
      ),
      false,
    );
    assert.ok(
      readme.includes(
        'full-page Settings',
      ),
    );
    assert.ok(
      readme.includes(
        'Export first generates the batch',
      ),
    );
  },
);
test(
  'Iteration 2 presentation alterations remain monochrome, keyboard-stable, and activation-randomized after modularization',
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
    const html =
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
      icons.includes('⚙'),
      false,
    );
    assert.equal(
      icons.includes('🌐'),
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
      profileStyles.includes(
        'height: var(--entry-layout-height)',
      ),
    );
    assert.ok(
      observationView.includes(
        '<SettingsIcon />',
      ),
    );
    assert.ok(
      observationView.includes(
        'className="observation-placeholder"',
      ),
    );
    assert.ok(
      observationView.includes(
        'useObservationTypography(observation)',
      ),
    );
    assert.ok(
      typography.includes(
        'chooseRandomObservationFont()',
      ),
    );
    assert.ok(
      typography.includes(
        'presentation.observationId',
      ),
    );
    assert.ok(
      typography.includes(
        'preferredObservationFontSizePx(',
      ),
    );
    assert.ok(
      typography.includes(
        'document.fonts.load(',
      ),
    );
    assert.ok(
      observationStyles.includes(
        '.controls-visible .nav-zone',
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
    for (
      const family of [
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
    assert.ok(
      html.includes(
        'fonts.googleapis.com/css2?',
      ),
    );
    assert.ok(
      html.includes(
        'Tenali+Ramakrishna',
      ),
    );
  },
);
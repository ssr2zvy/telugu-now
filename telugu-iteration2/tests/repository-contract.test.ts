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
    fileURLToPath(import.meta.url),
  ),
  '..',
);
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
        fs.statSync(control).mode &
        0o111
      ) !== 0,
      'control.sh should remain executable',
    );
    const syntax =
      spawnSync(
        'bash',
        ['-n', control],
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
      fs.readFileSync(
        path.join(
          root,
          'README.md',
        ),
        'utf8',
      );
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
  'Iteration 2 frontend contract uses Settings pages, table diagnostics, and two-stage export',
  () => {
    const app =
      fs.readFileSync(
        path.join(
          root,
          'frontend/src/App.tsx',
        ),
        'utf8',
      );
    const styles =
      fs.readFileSync(
        path.join(
          root,
          'frontend/src/styles.css',
        ),
        'utf8',
      );
    const readme =
      fs.readFileSync(
        path.join(
          root,
          'README.md',
        ),
        'utf8',
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
    assert.ok(
      app.includes(
        "type SettingsPage = 'index' | 'complexity' | 'sources' | 'diagnostic' | 'export'",
      ),
    );
    assert.ok(
      app.includes(
        'className="diagnostic-table"',
      ),
    );
    assert.ok(
      app.includes(
        'className="language-toggle"',
      ),
    );
    assert.ok(
      app.includes(
        'className="observation-placeholder"',
      ),
    );
    assert.ok(
      app.includes(
        'preparedExport',
      ),
    );
    assert.ok(
      app.includes(
        'downloadExportHtml(',
      ),
    );
    assert.ok(
      styles.includes(
        '.controls-visible',
      ),
    );
    assert.ok(
      styles.includes(
        '.nav-zone:disabled',
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
  'Iteration 2 presentation alterations keep controls monochrome, entry position stable, and typography activation-based',
  () => {
    const app =
      fs.readFileSync(
        path.join(
          root,
          'frontend/src/App.tsx',
        ),
        'utf8',
      );
    const styles =
      fs.readFileSync(
        path.join(
          root,
          'frontend/src/styles.css',
        ),
        'utf8',
      );
    const html =
      fs.readFileSync(
        path.join(
          root,
          'frontend/index.html',
        ),
        'utf8',
      );
    const presentation =
      fs.readFileSync(
        path.join(
          root,
          'frontend/src/presentation.ts',
        ),
        'utf8',
      );
    assert.ok(
      app.includes(
        '<SettingsIcon />',
      ),
    );
    assert.ok(
      app.includes(
        '<LanguageIcon />',
      ),
    );
    assert.equal(
      app.includes('⚙'),
      false,
    );
    assert.equal(
      app.includes('🌐'),
      false,
    );
    assert.equal(
      (
        app.match(
          /chooseRandomObservationFont\(\)/g,
        ) ?? []
      ).length,
      3,
    );
    assert.ok(
      app.includes(
        'observationPresentation.observationId',
      ),
    );
    assert.ok(
      app.includes(
        'preferredObservationFontSizePx(',
      ),
    );
    assert.ok(
      app.includes(
        'document.fonts.load(',
      ),
    );
    assert.ok(
      app.includes(
        "'--entry-layout-height'",
      ),
    );
    assert.ok(
      styles.includes(
        '.settings-trigger',
      ),
    );
    assert.ok(
      styles.includes(
        'bottom:',
      ),
    );
    assert.ok(
      styles.includes(
        '.control-icon',
      ),
    );
    assert.ok(
      styles.includes(
        'stroke: currentColor',
      ),
    );
    assert.ok(
      styles.includes(
        'height: var(--entry-layout-height)',
      ),
    );
    assert.ok(
      styles.includes(
        '.observation-text',
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

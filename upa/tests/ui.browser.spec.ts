import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import type { ProfileStateResponse, SelectionSnapshot } from '../shared/contracts';
import { DEFAULT_IMAGE_PROMPT, IMAGE_MODEL } from '../shared/image-settings';
import { parseAppearance, type ProfilePreferences, type UpdateProfilePreferences } from '../shared/appearance';

const baseUrl = process.env.UI_TEST_URL ?? 'http://127.0.0.1:5173';
const darkAppearance = { gradient: ['#344a44', '#56515e', '#354452'], foreground: '#f3f5ee', fontScale: 50, fonts: ['Noto Sans Telugu'] };
const sampleText = '\u0c26\u0c40\u0c28\u0c3f\u0c32\u0c4b \u0c2c\u0c1f\u0c4d\u0c1f\u0c32\u0c41 \u0c15\u0c4a\u0c28\u0c21\u0c02 \u0c35\u0c32\u0c28 \u0c28\u0c3e\u0c15\u0c41 \u0c38\u0c2e\u0c2f\u0c02 \u0c35\u0c43\u0c25\u0c3e \u0c15\u0c3e\u0c32\u0c47\u0c26\u0c41';

function audioFixture(): Buffer {
  const sampleRate = 8000;
  const sampleCount = sampleRate * 20;
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 220 / sampleRate) * 300), 44 + index * 2);
  }
  return buffer;
}

async function loadFixture(page: Page, realAudioUrl?: string, enterProfile = true, observationText = sampleText, preferences = new Map<string, ProfilePreferences>()) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const selection: SelectionSnapshot = {
    sourceWeights: { fixture: 1 }, sourceId: 'fixture', sourceRowCount: 12,
    sourceWeight: 1, sourceMass: 12, totalSourceMass: 12, sourceProbability: 1,
    sourceKey: 'row-1', complexityMetric: 'grapheme-count', intrinsicComplexityValue: 30,
    complexityReferenceVersion: 2, complexityPercentileTarget: 0.5,
    complexityPercentileSpread: 0.25, derivedStandardDeviation: 0.2,
    globalPercentileStart: 0, globalPercentileEnd: 1, globalIntervalMass: 1,
    globalRowsAtComplexityValue: 12, globalPerRowComplexityMass: 1 / 12,
    selectedSourceRowsAtComplexityValue: 12, selectedSourceNormalizationDenominator: 1,
    rowProbabilityWithinSource: 1 / 12, overallProbability: 1 / 12,
  };
  const state: ProfileStateResponse = {
    profileCode: '001', currentPosition: 1, historyLength: 2, canBack: true, canNext: true,
    nextStatus: 'ready', queue: { unseenCount: 10, readyCount: 10, preparingCount: 0, pendingCount: 0 },
    timing: null,
    selectionSettings: { sourceWeights: { fixture: 1 }, complexityPercentileTarget: 0.5, complexityPercentileSpread: 0.25, complexityReferenceVersion: 2 },
    audioSettings: { playbackRate: 1 },
    currentObservation: {
      id: 'observation-1', sourceId: 'fixture', sourceKey: 'row-1', text: observationText,
      audio: { url: realAudioUrl ?? '/api/test-audio.wav', mimeType: realAudioUrl && new URL(realAudioUrl, baseUrl).pathname.endsWith('.flac') ? 'audio/flac' : 'audio/wav', durationSeconds: 20 },
      diagnostic: {
        acquisitionNumber: 1, triggerKind: 'initial-fill', triggeredByObservationId: null,
        triggeredByAcquisitionNumber: null, triggeredByHistoryPosition: null,
        triggeredAt: 0, waitingAheadAtTrigger: 0, preparationInFlightAtTrigger: false,
        requestStartedAt: 0, requestCompletedAt: 1, requestDurationMs: 1, cacheHit: false, selection,
      },
    },
  };
  let navigationCount = 0;
  let failPreferences = false;
  const bookmarkMigrations = new Set<string>();
  const bookmarks = new Map<string, number[]>();
  let resetCount = 0;
  let exportCount = 0;
  let releaseExport = () => {};
  const exportGate = new Promise<void>((resolve) => { releaseExport = resolve; });
  const audio = audioFixture();
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (realAudioUrl && pathname === new URL(realAudioUrl, baseUrl).pathname) {
      await route.continue();
      return;
    }
    if (pathname === '/api/test-audio.wav') {
      const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
      await route.fulfill({
        status: range ? 206 : 200,
        contentType: 'audio/wav',
        headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${audio.length}` } : {}) },
        body: audio.subarray(start, end + 1),
      });
    } else if (pathname === '/api/data-sources') {
      await route.fulfill({ json: { sources: [{ sourceId: 'fixture', displayName: 'Fixture', provider: 'Test', license: 'Test fixture', upstreamUrl: null, catalogVersion: 2, acceptedRows: 12, rejectedRows: 0, complexityMetric: 'grapheme-count', status: 'fixture' }] } });
    } else if (pathname.endsWith('/visibility')) {
      await route.fulfill({ status: 204 });
    } else if (pathname.endsWith('/browser-data')) {
      if (failPreferences) { await route.fulfill({ status: 503 }); return; }
      const code = pathname.split('/')[3]!;
      const current = preferences.get(code) ?? { appearance: null, language: null, imagePrompt: DEFAULT_IMAGE_PROMPT, allowImageRegeneration: false };
      for (const entry of route.request().postDataJSON().entries) {
        if (entry.key === 'telugu-now-appearance-v1' && current.appearance === null) current.appearance = parseAppearance(JSON.parse(entry.value));
        if (entry.key === 'telugu-now-settings-language' && current.language === null) current.language = entry.value;
        if (entry.key.startsWith('telugu-now-audio-bookmarks:')) {
          const [sourceId, sourceKey] = entry.key.slice('telugu-now-audio-bookmarks:'.length).split('\u0000');
          const key = JSON.stringify([code, sourceId, sourceKey]);
          if (!bookmarks.has(key)) bookmarks.set(key, JSON.parse(entry.value));
        }
      }
      preferences.set(code, current);
      await route.fulfill({ json: { saved: true } });
    } else if (pathname.endsWith('/migrations')) {
      const code = pathname.split('/')[3]!;
      const current = preferences.get(code);
      await route.fulfill({ json: { settings: Boolean(current?.appearance && current.language), bookmarks: bookmarkMigrations.has(code) } });
    } else if (pathname.endsWith('/bookmarks/import')) {
      const code = pathname.split('/')[3]!;
      const imported = !bookmarkMigrations.has(code);
      if (imported) {
        for (const record of route.request().postDataJSON().records) {
          const key = JSON.stringify([code, record.sourceId, record.sourceKey]);
          if (!bookmarks.has(key)) bookmarks.set(key, record.bookmarks);
        }
        bookmarkMigrations.add(code);
      }
      await route.fulfill({ json: { imported } });
    } else if (pathname.endsWith('/bookmarks')) {
      const code = pathname.split('/')[3]!;
      const query = new URL(route.request().url()).searchParams;
      const record = route.request().method() === 'PUT' ? route.request().postDataJSON() : { sourceId: query.get('sourceId'), sourceKey: query.get('sourceKey') };
      const key = JSON.stringify([code, record.sourceId, record.sourceKey]);
      if (record.bookmarks) bookmarks.set(key, record.bookmarks);
      await route.fulfill({ json: { bookmarks: bookmarks.get(key) ?? [] } });
    } else if (pathname.endsWith('/preferences')) {
      if (failPreferences) { await route.fulfill({ status: 503 }); return; }
      const code = pathname.split('/')[3]!;
      const current = preferences.get(code) ?? { appearance: null, language: null, imagePrompt: DEFAULT_IMAGE_PROMPT, allowImageRegeneration: false };
      const patch = (route.request().postDataJSON() ?? {}) as UpdateProfilePreferences;
      const initialize = route.request().method() === 'POST';
      const saved = {
        appearance: patch.appearance && (!initialize || current.appearance === null) ? parseAppearance({ ...current.appearance, ...patch.appearance }) : current.appearance,
        language: patch.language && (!initialize || current.language === null) ? patch.language : current.language,
        imagePrompt: current.imagePrompt,
        allowImageRegeneration: current.allowImageRegeneration,
      };
      preferences.set(code, saved);
      await route.fulfill({ json: saved });
    } else if (pathname.endsWith('/audio-settings')) {
      state.audioSettings = route.request().postDataJSON();
      await route.fulfill({ json: state.audioSettings });
    } else if (pathname.endsWith('/settings')) {
      state.selectionSettings = { ...state.selectionSettings, ...route.request().postDataJSON() };
      await route.fulfill({ json: state.selectionSettings });
    } else if (pathname.endsWith('/queue/reset')) {
      resetCount += 1;
      await route.fulfill({ json: state });
    } else if (pathname.endsWith('/export')) {
      exportCount += 1;
      await exportGate;
      await route.fulfill({ json: { settings: state.selectionSettings, entries: [{ position: 0, sourceId: 'fixture', sourceKey: 'row-1', text: sampleText, audio: state.currentObservation?.audio, diagnostic: { selection, cacheHit: false, requestStartedAt: 0, requestCompletedAt: 1, requestDurationMs: 1 } }] } });
    } else if (/\/(next|back)$/.test(pathname)) {
      navigationCount += 1;
      state.currentObservation = { ...state.currentObservation!, id: `observation-${navigationCount + 1}` };
      await route.fulfill({ json: state });
    } else if (pathname.endsWith('/load') || pathname.endsWith('/state')) {
      if (pathname.endsWith('/load')) state.profileCode = route.request().postDataJSON().code;
      await route.fulfill({ json: state });
    } else {
      throw new Error(`Unmocked API request: ${pathname}`);
    }
  });
  await page.goto(baseUrl);
  if (enterProfile) {
    await page.locator('.profile-input').fill('001');
    await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
    await expect(page.locator('audio')).toHaveJSProperty('readyState', 4);
  }
  return { errors, state, preferences, failPreferences: (fail: boolean) => { failPreferences = fail; }, releaseExport, navigationCount: () => navigationCount, resetCount: () => resetCount, exportCount: () => exportCount };
}

async function doubleClickWord(page: Page, word: string, delay = 0) {
  const bounds = await page.locator('.observation-text').evaluate((element, selected) => {
    const start = element.textContent!.indexOf(selected);
    const range = document.createRange();
    range.setStart(element.firstChild!, start);
    range.setEnd(element.firstChild!, start + selected.length);
    const rect = range.getClientRects()[0]!;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, word);
  await page.mouse.dblclick(bounds.x, bounds.y, { delay });
}

async function wordImageFixture(page: Page) {
  const images = new Map<string, Buffer>();
  const generations: string[] = [];
  let failure = '';
  let prompt = DEFAULT_IMAGE_PROMPT;
  let allowRegeneration = false;
  let release = () => {};
  let gate: Promise<void> | null = null;
  const imageBytes = await page.evaluate(() => ['#73916d', '#c47b65'].map(color => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color;
    context.fillRect(0, 0, 256, 256);
    context.fillStyle = '#d4dfd7';
    context.fillRect(64, 64, 128, 128);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }));
  const png = Buffer.from(imageBytes[0]!, 'base64');
  const replacement = Buffer.from(imageBytes[1]!, 'base64');
  await page.route('**/api/word-images/settings?*', async route => {
    if (route.request().method() === 'PUT') {
      prompt = route.request().postDataJSON().prompt;
      allowRegeneration = route.request().postDataJSON().allowRegeneration ?? allowRegeneration;
    }
    await route.fulfill({ json: { prompt, model: IMAGE_MODEL, keyConfigured: true, allowRegeneration } });
  });
  await page.route('**/api/word-images?*', async route => {
    const root = new URL(route.request().url()).searchParams.get('root')!;
    const regenerate = new URL(route.request().url()).searchParams.get('regenerate') === '1';
    if (route.request().method() === 'POST') {
      if (regenerate && !allowRegeneration) { await route.fulfill({ status: 403, json: { error: 'Regeneration disabled' } }); return; }
      generations.push(root);
      if (gate) await gate;
      if (failure) { await route.fulfill({ status: 502, json: { error: failure } }); return; }
      if (!images.has(root) || regenerate) images.set(root, regenerate ? replacement : png);
    }
    const image = images.get(root);
    await route.fulfill(image ? { contentType: 'image/png', body: image } : { status: 404, json: { error: 'image-not-found' } });
  });
  return { images, generations, prompt: () => prompt, allowRegeneration: () => allowRegeneration,
    fail: (message: string) => { failure = message; },
    hold: () => { gate = new Promise(resolve => { release = resolve; }); },
    release: () => release(),
  };
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`word profile generates once and reuses the root image at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const fixture = await loadFixture(page, undefined, true, 'అవును చెట్లలో చెట్టు.');
    const images = await wordImageFixture(page);
    const text = page.locator('.observation-text');
    const original = await text.getAttribute('style');
    await text.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const external: string[] = [];
    await page.route('https://**', route => { external.push(route.request().url()); return route.abort(); });
    await doubleClickWord(page, 'చెట్లలో');
    const dialog = page.getByRole('dialog', { name: 'చెట్లలో' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toHaveText('చెట్లలో');
    await expect(dialog.locator('.word-profile-ending')).toHaveText('ట్లలో');
    expect(await dialog.locator('.word-profile-ending').evaluate(element => getComputedStyle(element).color)).not.toBe(await dialog.locator('h2').evaluate(element => getComputedStyle(element).color));
    await expect(dialog.locator('input, dl, h3')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
    expect(images.generations).toEqual([]);
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
    const image = dialog.getByRole('img', { name: 'Drawing of the concept of చెట్టు' });
    await expect(image).toBeVisible();
    await expect(image).toHaveJSProperty('naturalWidth', 256);
    expect(images.generations).toEqual(['చెట్టు']);
    await expect(dialog.getByRole('button', { name: 'Generate', exact: true })).toHaveCount(0);
    expect(images.images.has('చెట్టు')).toBe(true);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('word-profile.png') });
    await dialog.getByRole('button', { name: 'Close word profile' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await text.getAttribute('style')).toBe(original);
    expect(fixture.navigationCount()).toBe(0);
    await doubleClickWord(page, 'చెట్టు.');
    await expect(page.getByRole('img', { name: 'Drawing of the concept of చెట్టు' })).toBeVisible();
    expect(images.generations).toHaveLength(1);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.locator('.profile-input').fill('001');
    await expect(text).toHaveCSS('opacity', '1');
    await doubleClickWord(page, 'చెట్టు.');
    await expect(page.getByRole('img', { name: 'Drawing of the concept of చెట్టు' })).toBeVisible();
    expect(images.generations).toHaveLength(1);
    expect(external).toEqual([]);
    await page.keyboard.press('Escape');
    await revealControls(page);
    await page.locator('.nav-zone-right').dblclick();
    await expect.poll(fixture.navigationCount).toBe(1);
    expect(fixture.errors).toEqual([]);
  });
}

test('word double-click never reveals audio controls or selects text, while single clicks and drag selection still work', async ({ page }) => {
  const fixture = await loadFixture(page, undefined, true, 'అవును చెట్టు');
  await wordImageFixture(page);
  const screen = page.locator('.observation-screen');
  const text = page.locator('.observation-text');
  await screen.evaluate(element => {
    element.setAttribute('data-controls-revealed', 'false');
    new MutationObserver(records => {
      if (element.classList.contains('controls-visible') || records.some(record => record.oldValue?.includes('controls-visible'))) {
        element.setAttribute('data-controls-revealed', 'true');
      }
    }).observe(element, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  });
  for (const delay of [0, 100]) {
    await doubleClickWord(page, 'అవును', delay);
    await expect(page.getByRole('dialog', { name: 'అవును' })).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await expect(screen).not.toHaveClass(/controls-visible/);
    await expect(screen).toHaveAttribute('data-controls-revealed', 'false');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  }
  await text.click();
  await expect(screen).toHaveClass(/controls-visible/);
  await expect(page.locator('.audio-player-bar')).toHaveCSS('opacity', '1');
  await text.click();
  await expect(screen).not.toHaveClass(/controls-visible/);
  const bounds = await text.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    return { left: rect.left + 1, right: rect.right - 1, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(bounds.left, bounds.y);
  await page.mouse.down();
  await page.mouse.move(bounds.right, bounds.y, { steps: 16 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('అవును చెట్టు');
  await page.waitForTimeout(600);
  await expect(screen).not.toHaveClass(/controls-visible/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

test('word profile survives closing during generation without duplicate requests', async ({ page }) => {
  const fixture = await loadFixture(page, undefined, true, 'అవును చెట్లలో');
  const images = await wordImageFixture(page);
  images.hold();
  await doubleClickWord(page, 'అవును');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generating', exact: true })).toBeDisabled();
  await expect.poll(() => images.generations.length).toBe(1);
  await page.keyboard.press('Escape');
  await doubleClickWord(page, 'అవును');
  await expect(page.getByRole('button', { name: 'Loading', exact: true })).toBeDisabled();
  images.release();
  await expect(page.getByRole('img', { name: 'Drawing of the concept of అవును' })).toBeVisible();
  expect(images.generations).toHaveLength(1);
  expect(images.images.has('అవును')).toBe(true);
  expect(fixture.errors).toEqual([]);
});

test('word profile displays provider errors and permits an explicit retry', async ({ page }) => {
  const fixture = await loadFixture(page, undefined, true, 'అవును చెట్లలో');
  const images = await wordImageFixture(page);
  images.fail('Pollinations account credits are insufficient.');
  await doubleClickWord(page, 'అవును');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Pollinations account credits are insufficient.');
  expect(images.generations).toHaveLength(1);
  images.fail('');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Drawing of the concept of అవును' })).toBeVisible();
  expect(images.generations).toHaveLength(2);
  expect(fixture.errors).toEqual([]);
});

test('image generation settings require the core word placeholder and persist the prompt', async ({ page }, testInfo) => {
  const fixture = await loadFixture(page, undefined, true, 'అవును చెట్లలో');
  const images = await wordImageFixture(page);
  await openSettings(page);
  await page.getByRole('button', { name: 'Display: Image generation', exact: true }).click();
  const input = page.getByLabel('Image prompt', { exact: true });
  await expect(input).toHaveValue(DEFAULT_IMAGE_PROMPT);
  await input.fill('Draw something');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill('Watercolor of <core word>. No written words.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(images.prompt()).toBe('Watercolor of <core word>. No written words.');
  await page.screenshot({ path: testInfo.outputPath('image-settings.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await openSettings(page);
  await page.getByRole('button', { name: 'Display: Image generation', exact: true }).click();
  await expect(input).toHaveValue(images.prompt());
  expect(fixture.errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`regeneration toggle gates shared image replacement at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const fixture = await loadFixture(page, undefined, true, 'అవును చెట్లలో చెట్టు.');
    const images = await wordImageFixture(page);
    const openImageSettings = async () => {
      await openSettings(page);
      await page.getByRole('button', { name: 'Display', exact: true }).click();
      await page.getByRole('button', { name: 'Image generation', exact: true }).click();
    };
    await doubleClickWord(page, 'చెట్లలో');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const image = page.getByRole('img', { name: 'Drawing of the concept of చెట్టు' });
    await expect(image).toBeVisible();
    await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close word profile' }).click();

    await openImageSettings();
    const toggle = page.getByRole('switch', { name: 'Enable regeneration', exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved');
    expect(images.allowRegeneration()).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('regeneration-setting.png') });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await openImageSettings();
    await expect(toggle).toBeChecked();
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await doubleClickWord(page, 'చెట్టు');
    await expect(image).toBeVisible();
    const original = await image.getAttribute('src');
    const regenerate = page.getByRole('button', { name: 'Regenerate', exact: true });
    await expect(regenerate).toBeVisible();
    await regenerate.scrollIntoViewIfNeeded();
    await withinViewport(regenerate, page);
    expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('regenerate-button.png') });
    page.once('dialog', dialog => dialog.dismiss());
    await regenerate.click();
    expect(images.generations).toHaveLength(1);
    images.hold();
    page.once('dialog', dialog => {
      expect(dialog.message()).toContain('all profiles');
      return dialog.accept();
    });
    await regenerate.click();
    await expect(page.getByRole('button', { name: 'Regenerating...', exact: true })).toBeDisabled();
    await expect(image).toHaveAttribute('src', original!);
    images.release();
    await expect(regenerate).toBeEnabled();
    await expect(image).not.toHaveAttribute('src', original!);
    await expect(image).toHaveJSProperty('naturalWidth', 256);
    const pixels = await image.evaluate(element => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.drawImage(element as HTMLImageElement, 0, 0);
      return [...context.getImageData(0, 0, 1, 1).data];
    });
    expect(pixels).toEqual([196, 123, 101, 255]);

    const savedSource = await image.getAttribute('src');
    images.fail('Temporary provider failure');
    page.once('dialog', dialog => dialog.accept());
    await regenerate.click();
    await expect(page.getByRole('alert')).toContainText('Temporary provider failure');
    await expect(image).toHaveAttribute('src', savedSource!);
    images.fail('');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Retry regeneration', exact: true }).click();
    await expect(regenerate).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close word profile' }).click();
    await openImageSettings();
    await toggle.uncheck();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await doubleClickWord(page, 'చెట్లలో');
    await expect(image).toBeVisible();
    await expect(regenerate).toHaveCount(0);
    expect(images.generations).toHaveLength(4);
    expect(fixture.errors).toEqual([]);
  });
}

test('profile preferences migrate once, restore in a fresh browser and isolate another profile', async ({ page, browser }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('telugu-now-appearance-v1', JSON.stringify({ fontScale: 73, foreground: '#123456', fonts: ['Mandali'] }));
    localStorage.setItem('telugu-now-settings-language', 'en');
  });
  const fixture = await loadFixture(page);
  await expect.poll(() => fixture.preferences.get('001')?.appearance?.fontScale).toBe(73);
  expect(fixture.preferences.get('001')?.language).toBe('en');
  await openSettings(page);
  await page.getByRole('button', { name: 'Display', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('slider', { name: 'Auto-fade delay', exact: true }).press('End');
  await expect.poll(() => fixture.preferences.get('001')?.appearance?.autoFadeSeconds).toBe(60);
  await page.screenshot({ path: testInfo.outputPath('profile-preferences-desktop.png') });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const fresh = await context.newPage();
    const freshFixture = await loadFixture(fresh, undefined, true, sampleText, fixture.preferences);
    await openSettings(fresh);
    await fresh.getByRole('button', { name: 'Display', exact: true }).click();
    await fresh.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(fresh.getByRole('slider', { name: 'Auto-fade delay', exact: true })).toHaveValue('60');
    await expect(fresh.getByLabel('Text & icons color', { exact: true })).toHaveValue('#123456');
    await fresh.screenshot({ path: testInfo.outputPath('profile-preferences-mobile.png') });
    await fresh.reload();
    await fresh.locator('.profile-input').fill('002');
    await expect(fresh.locator('.observation-text')).toHaveCSS('opacity', '1');
    await expect.poll(() => fixture.preferences.get('002')?.appearance?.fontScale).toBe(50);
    expect(fixture.preferences.get('002')?.appearance?.foreground).toBe('#171717');
    expect(fixture.preferences.get('001')?.appearance?.fontScale).toBe(73);
    expect(freshFixture.errors).toEqual([]);
  } finally { await context.close(); }
  expect(fixture.errors).toEqual([]);
});

test('profile preferences show load and save failures and retry without losing edits', async ({ page }) => {
  const fixture = await loadFixture(page, undefined, false);
  fixture.failPreferences(true);
  await page.locator('.profile-input').fill('001');
  await expect(page.getByRole('alert')).toContainText('Could not load profile settings.');
  fixture.failPreferences(false);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
  await openSettings(page);
  await page.getByRole('button', { name: 'Display', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await expect.poll(() => fixture.preferences.get('001')?.language).toBe('en');
  fixture.failPreferences(true);
  const delay = page.getByRole('slider', { name: 'Auto-fade delay', exact: true });
  await delay.press('End');
  await expect(page.getByRole('alert')).toContainText('Settings not saved.');
  await delay.press('ArrowLeft');
  await expect(delay).toHaveValue('59');
  await expect(page.getByRole('alert')).toContainText('Settings not saved.');
  fixture.failPreferences(false);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => fixture.preferences.get('001')?.appearance?.autoFadeSeconds).toBe(59);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

async function revealControls(page: Page, clockPaused = false) {
  if (!await page.locator('.observation-screen').evaluate(element => element.classList.contains('controls-visible'))) {
    await page.locator('.observation-text').click();
    if (clockPaused) await page.clock.fastForward(500);
  }

  await expect(page.locator('.audio-player-bar')).toHaveCSS('opacity', '1');
}

async function revealSettings(page: Page) {
  const center = (await page.locator('.observation-center').boundingBox())!;
  await page.mouse.dblclick(center.x + center.width / 2, center.y + 12);
  await expect(page.locator('.settings-trigger')).toHaveCSS('opacity', '1');
}

test('downloaded HTML plays its embedded audio offline', async ({ page }) => {
  const fixture = await loadFixture(page);
  fixture.releaseExport();
  await openSettings(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('spinbutton').fill('1');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /^HTML/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  const html = await readFile((await download.path())!, 'utf8');
  expect(html).toContain('data:audio/wav;base64,');
  expect(html).not.toContain('/api/test-audio.wav');
  const viewer = await page.context().newPage();
  const requests: string[] = [];
  viewer.on('request', request => { if (request.url().startsWith('http')) requests.push(request.url()); });
  await page.context().setOffline(true);
  await viewer.setContent(html);
  await expect(viewer.locator('#text')).toHaveCSS('opacity', '1');
  await expect(viewer.locator('#text')).toHaveCSS('user-select', 'text');
  const audio = viewer.locator('audio');
  await expect(audio).toBeVisible();
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.1);
  expect(requests).toEqual([]);
  await viewer.close();
  expect(fixture.errors).toEqual([]);
});

test('sidebar groups collapse independently without changing the active page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await loadFixture(page);
  await openSettings(page);
  const rail = page.locator('.settings-rail');
  for (const group of ['Sampling', 'Diagnostic', 'Display']) {
    await rail.getByRole('button', { name: `Collapse ${group}`, exact: true }).click();
    await expect(rail.getByRole('button', { name: `Expand ${group}`, exact: true })).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(rail.getByRole('button', { name: 'Sampling: Complexity', exact: true })).toBeHidden();
  await expect(page.locator('.settings-header h1')).toHaveText('Settings');
  await rail.getByRole('button', { name: 'Expand Sampling', exact: true }).press('Enter');
  await rail.getByRole('button', { name: 'Sampling: Complexity', exact: true }).click();
  await expect(page.locator('.settings-header h1')).toHaveText('Complexity');
  await expect(rail.getByRole('button', { name: 'Expand Display', exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect(fixture.errors).toEqual([]);
});

test('each export requests a fresh batch even when the count stays the same', async ({ page }) => {
  const fixture = await loadFixture(page);
  fixture.releaseExport();
  await openSettings(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('spinbutton').fill('10');
  for (const expected of [1, 2]) {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('button', { name: /^HTML/ }).click();
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
    expect(fixture.exportCount()).toBe(expected);
  }
  expect(fixture.errors).toEqual([]);
});

test('fixed precision seeking pauses playback and speed stays inside the viewport', async ({ page }) => {
  const fixture = await loadFixture(page);
  await revealControls(page);
  const audio = page.locator('audio');
  const precise = page.getByRole('slider', { name: 'Precise audio position' });
  for (const activation of ['keyboard', 'pointer']) {
    await page.getByTitle('Play', { exact: true }).click();
    await expect(audio).toHaveAttribute('src', /^blob:/);
    await expect(audio).toHaveJSProperty('paused', false);
    const startedAt = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(startedAt);
    await page.getByRole('slider', { name: 'Audio position', exact: true }).press('Enter');
    if (activation === 'keyboard') await precise.press('ArrowRight');
    else {
      const bounds = (await precise.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
    }
    await expect(precise).toBeVisible();
    await expect(audio).toHaveJSProperty('paused', true);
    if (activation === 'pointer') await page.mouse.up();
    const panel = (await page.locator('.audio-magnifier').boundingBox())!;
    const bar = (await page.locator('.audio-scrubber').boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    await precise.focus();
    await expect(precise).toHaveCSS('box-shadow', 'none');
    await precise.press('Escape');
    await expect(precise).toBeHidden();
  }
  await page.getByRole('slider', { name: 'Audio position', exact: true }).press('Enter');
  await page.getByTitle('Playback speed', { exact: true }).click();
  const speed = page.locator('.audio-speed-popover');
  await withinViewport(speed, page);
  expect(fixture.errors).toEqual([]);
});

async function openSettings(page: Page) {
  await revealSettings(page);
  await page.locator('.settings-trigger').click();
  if (await page.locator('.settings-header h1').textContent() !== 'Settings') {
    await page.locator('.language-toggle').click();
  }
}

async function withinViewport(locator: Locator, page: Page) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('prepared audio decodes real FLAC bytes into the same padded native timeline', async ({ page }) => {
  const converted = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'flac', 'pipe:1'], { input: audioFixture() });
  test.skip(converted.error?.message.includes('ENOENT') ?? false, 'ffmpeg is required for the FLAC fixture');
  expect(converted.status, converted.stderr?.toString()).toBe(0);
  const fixture = await loadFixture(page, undefined, false);
  fixture.state.currentObservation!.audio = { url: '/api/test-audio.flac', mimeType: 'audio/flac', durationSeconds: 20 };
  let requests = 0;
  await page.route('**/api/test-audio.flac', async route => {
    requests++;
    await route.fulfill({ contentType: 'audio/flac', body: converted.stdout });
  });
  await page.locator('.profile-input').fill('001');
  const audio = page.locator('audio');
  await expect(audio).toHaveJSProperty('duration', 20.5);
  await expect(audio).toHaveAttribute('src', /^blob:/);
  await revealControls(page);
  await page.getByTitle('Play', { exact: true }).click();
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.6);
  expect(requests).toBe(1);
  expect(fixture.errors).toEqual([]);
});

test('prepared audio emits exact silence then speech with a native frame-synced timeline', async ({ page }) => {
  const fixture = await loadFixture(page);
  await revealControls(page);
  const audio = page.locator('audio');
  const source = await audio.getAttribute('src');
  expect(source).toMatch(/^blob:/);
  const pcm = await audio.evaluate(async (element: HTMLAudioElement) => {
    const data = await (await fetch(element.src)).arrayBuffer();
    const header = new DataView(data);
    const rate = header.getUint32(24, true);
    const samples = new Int16Array(data, 44);
    return { rate, silent: samples.slice(0, rate / 2).every(value => value === 0),
      speech: samples.slice(rate / 2, rate).some(value => value !== 0),
      duration: element.duration, firstNonzero: samples.findIndex(value => value !== 0) / rate };
  });
  expect(pcm.silent).toBe(true);
  expect(pcm.speech).toBe(true);
  expect(pcm.duration).toBe(20.5);
  expect(pcm.firstNonzero).toBeGreaterThanOrEqual(0.5);
  expect(pcm.firstNonzero).toBeLessThan(0.51);
  await audio.evaluate((element: HTMLAudioElement) => {
    const frames: Array<{ time: number; bar: number; rms: number }> = [];
    (window as any).audioFrames = frames;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    const samples = new Float32Array(analyser.fftSize);
    element.addEventListener('playing', () => {
      const stream = (element as HTMLAudioElement & { captureStream(): MediaStream }).captureStream();
      context.createMediaStreamSource(stream).connect(analyser);
      void context.resume();
    }, { once: true });
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      if (!element.paused) frames.push({ time: element.currentTime,
        bar: Number(document.querySelector('.audio-scrubber')?.getAttribute('aria-valuenow')),
        rms: Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length) });
      if (element.currentTime < 1.2 && (!element.paused || frames.length === 0)) requestAnimationFrame(tick);
      else void context.close();
    };
    requestAnimationFrame(tick);
  });
  await page.getByTitle('Play', { exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(1);
  await page.getByTitle('Pause', { exact: true }).click();
  const frames = await page.evaluate(() => (window as any).audioFrames as Array<{ time: number; bar: number; rms: number }>);
  const silenceFrames = frames.filter(frame => frame.time > 0.1 && frame.time < 0.45);
  expect(silenceFrames.length).toBeGreaterThan(5);
  expect(silenceFrames.filter(frame => Math.abs(frame.time - frame.bar) >= 0.08)).toEqual([]);
  // captureStream has its own render-ahead buffer; the WAV assertion above
  // verifies the exact boundary. Sample output away from that buffer boundary.
  expect(silenceFrames.filter(frame => frame.time < 0.3 && frame.rms !== 0)).toEqual([]);
  expect(frames.some(frame => frame.time > 0.6 && frame.rms > 0.005)).toBe(true);
  expect(frames.filter(frame => frame.time > 0.5).every(frame => Math.abs(frame.time - frame.bar) < 0.08)).toBe(true);
  await expect(audio).toHaveAttribute('src', source!);
  expect(fixture.errors).toEqual([]);
});

test('prepared audio touch play and resume retain gesture authorization without source swaps', async ({ playwright }) => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const fixture = await loadFixture(page);
    await revealControls(page);
    const audio = page.locator('audio');
    const originalAudio = await audio.elementHandle();
    const source = await audio.getAttribute('src');
    for (const time of [0, 7]) {
      await audio.evaluate((element: HTMLAudioElement, time) => { element.currentTime = time; }, time);
      await page.getByTitle('Play', { exact: true }).tap();
      await expect(audio).toHaveAttribute('src', source!);
      await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(time + 0.1);
      expect(await originalAudio!.evaluate(element => element === document.querySelector('audio'))).toBe(true);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await page.getByTitle('Pause', { exact: true }).tap();
    }
    expect(fixture.errors).toEqual([]);
  } finally {
    await browser.close();
  }
});

for (const action of ['pause', 'seek', 'magnifier', 'navigate']) {
  test(`prepared audio ${action} interrupts playback without a delayed restart`, async ({ page }) => {
    const fixture = await loadFixture(page);
    await revealControls(page);
    const originalAudio = await page.locator('audio').elementHandle();
    await page.getByTitle('Play', { exact: true }).click();
    if (action === 'pause') await page.getByTitle('Pause', { exact: true }).click();
    if (action === 'seek') {
      await page.getByRole('slider', { name: 'Audio position', exact: true }).press('ArrowRight');
      await expect(page.locator('audio')).toHaveJSProperty('paused', false);
      await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(1);
      await page.getByTitle('Pause', { exact: true }).click();
    }
    if (action === 'magnifier') {
      await page.getByRole('slider', { name: 'Audio position', exact: true }).press('Enter');
      await page.getByRole('slider', { name: 'Precise audio position', exact: true }).press('ArrowRight');
      await expect(page.getByRole('slider', { name: 'Precise audio position' })).toBeVisible();
    }
    if (action === 'navigate') {
      await page.locator('.nav-zone-right').dblclick();
      await expect.poll(fixture.navigationCount).toBe(1);
      await expect.poll(() => originalAudio!.evaluate(element => element.isConnected)).toBe(false);
    }
    await page.waitForTimeout(700);
    expect(await originalAudio!.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await expect(page.locator('audio')).toHaveJSProperty('paused', true);
    await expect(page.getByTitle('Pause', { exact: true })).toHaveCount(0);
    if (action === 'navigate') await revealControls(page);
    const resumeAt = await page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime);
    await page.getByTitle('Play', { exact: true }).click();
    await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('audio')).toHaveJSProperty('paused', false);
    await expect.poll(() => page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(resumeAt + 0.1);
    expect(fixture.errors).toEqual([]);
  });
}

for (const failure of ['pending', 'rejected']) {
  test(`prepared audio plays directly when Web Audio resume is ${failure}`, async ({ page }) => {
    await page.addInitScript((failure) => {
      Object.defineProperty(AudioContext.prototype, 'state', { get: () => 'suspended' });
      const connect = AudioContext.prototype.createMediaElementSource;
      AudioContext.prototype.createMediaElementSource = function (element) {
        document.documentElement.dataset.audioGraphConnected = 'true';
        return connect.call(this, element);
      };
      AudioContext.prototype.resume = () => failure === 'pending'
        ? new Promise<void>(() => {})
        : Promise.reject(new DOMException('Audio processing blocked', 'NotAllowedError'));
    }, failure);
    const fixture = await loadFixture(page);
    await revealControls(page);
    await page.getByTitle('Play', { exact: true }).click();
    await expect(page.locator('audio')).toHaveJSProperty('paused', false);
    await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.1);
    await expect(page.locator('html')).not.toHaveAttribute('data-audio-graph-connected', 'true');
    await page.getByTitle('Pause', { exact: true }).click();
    await expect(page.locator('audio')).toHaveJSProperty('paused', true);
    expect(fixture.errors).toEqual([]);
  });
}

test('prepared audio cold click waits visibly and requires a fresh gesture instead of delayed autoplay', async ({ page }) => {
  const fixture = await loadFixture(page, undefined, false);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/test-audio.wav', async route => { await gate; await route.fallback(); });
  await page.locator('.profile-input').fill('001');
  await revealControls(page);
  await page.getByTitle('Play', { exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Preparing audio');
  await expect(page.getByTitle('Pause', { exact: true })).toHaveCount(0);
  await expect(page.locator('audio')).toHaveJSProperty('paused', true);
  release();
  await expect(page.getByRole('status')).toHaveText('Audio ready. Tap Play.');
  await expect(page.locator('audio')).toHaveJSProperty('paused', true);
  await page.getByTitle('Play', { exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.6);
  expect(fixture.errors).toEqual([]);
});

for (const failure of ['http', 'decode', 'unavailable']) {
  test(`prepared audio ${failure} failure is explicit and preparation retries`, async ({ page }) => {
    if (failure === 'unavailable') await page.addInitScript(() => {
      const Context = window.AudioContext;
      let first = true;
      window.AudioContext = class extends Context {
        constructor(options?: AudioContextOptions) {
          if (first) { first = false; throw new Error('Decoder unavailable'); }
          super(options);
        }
      };
    });
    const fixture = await loadFixture(page, undefined, false);
    let requests = 0;
    await page.route('**/api/test-audio.wav', async route => {
      requests++;
      if (requests === 1 && failure !== 'unavailable') {
        await route.fulfill({ status: failure === 'http' ? 503 : 200, contentType: 'audio/wav', body: 'broken' });
      } else await route.fallback();
    });
    await page.locator('.profile-input').fill('001');
    await revealControls(page);
    await expect(page.getByRole('alert')).toContainText('Tap Play to retry');
    await expect(page.locator('audio')).not.toHaveAttribute('src', /./);
    await expect(page.getByTitle('Pause', { exact: true })).toHaveCount(0);
    await page.getByTitle('Play', { exact: true }).click();
    await expect(page.locator('audio')).toHaveJSProperty('readyState', 4);
    await expect(page.locator('audio')).toHaveJSProperty('paused', true);
    await page.getByTitle('Play', { exact: true }).click();
    await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.6);
    expect(requests).toBe(2);
    expect(fixture.errors).toEqual([]);
  });
}

test('prepared audio queue prewarming deduplicates upcoming playback and ignores an abandoned cold source', async ({ page }) => {
  const fixture = await loadFixture(page, undefined, false);
  fixture.state.upcomingAudio = [1, 2, 3].map(index => ({
    url: `/api/queued-${index}.wav`, mimeType: 'audio/wav', durationSeconds: 20,
  }));
  const requests: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/test-audio.wav', async route => {
    await gate;
    await route.fulfill({ contentType: 'audio/wav', body: audioFixture() }).catch(() => {});
  });
  await page.route('**/api/queued-*.wav', async route => {
    requests.push(new URL(route.request().url()).pathname);
    await route.fulfill({ contentType: 'audio/wav', body: audioFixture() });
  });
  await page.locator('.profile-input').fill('001');
  await expect.poll(() => requests.length).toBe(3);
  const oldElement = await page.locator('audio').elementHandle();
  fixture.state.currentObservation!.audio = fixture.state.upcomingAudio[0]!;
  await page.locator('.nav-zone-right').dblclick();
  await expect.poll(fixture.navigationCount).toBe(1);
  await expect(page.locator('audio')).toHaveJSProperty('readyState', 4);
  await revealControls(page);
  const source = await page.locator('audio').getAttribute('src');
  release();
  await page.getByTitle('Play', { exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.6);
  await expect(page.locator('audio')).toHaveAttribute('src', source!);
  expect(await oldElement!.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  expect(requests.filter(url => url === '/api/queued-1.wav')).toHaveLength(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

test('prepared audio stale play rejection after rapid navigation cannot stop the current clip', async ({ page }) => {
  const fixture = await loadFixture(page);
  await revealControls(page);
  await page.evaluate(() => {
    const play = HTMLMediaElement.prototype.play;
    let first = true;
    HTMLMediaElement.prototype.play = function () {
      if (!first) return play.call(this);
      first = false;
      return new Promise<void>((_resolve, reject) => { (window as any).rejectOldPlay = reject; });
    };
  });
  const previous = await page.locator('audio').elementHandle();
  await page.getByTitle('Play', { exact: true }).click();
  await expect(page.getByTitle('Pause', { exact: true })).toHaveCount(0);
  for (const count of [1, 2]) {
    await page.locator('.nav-zone-right').dblclick();
    await expect.poll(fixture.navigationCount).toBe(count);
  }
  await revealControls(page);
  await page.getByTitle('Play', { exact: true }).click();
  await page.evaluate(() => (window as any).rejectOldPlay(new DOMException('Old play aborted', 'AbortError')));
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.6);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await previous!.evaluate((a: HTMLAudioElement) => a.paused && !a.hasAttribute('src'))).toBe(true);
  expect(fixture.errors).toEqual([]);
});

test('prepared audio resume, seeks, slow pitch-preserving rates and replay all keep one source', async ({ page }) => {
  const fixture = await loadFixture(page);
  await revealControls(page);
  const audio = page.locator('audio');
  const source = await audio.getAttribute('src');
  const scrubber = page.getByRole('slider', { name: 'Audio position', exact: true });
  await scrubber.press('Enter');
  await page.getByTitle('Playback speed', { exact: true }).click();
  const rate = page.getByRole('slider', { name: 'Playback speed', exact: true });
  for (let step = 0; step < 10; step++) await rate.press('ArrowDown');
  await expect(audio).toHaveJSProperty('playbackRate', 0.5);
  await expect(audio).toHaveJSProperty('preservesPitch', true);
  await rate.press('Escape');
  await page.getByTitle('Play', { exact: true }).click();
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.6);
  await page.getByTitle('Pause', { exact: true }).click();
  const paused = await audio.evaluate((a: HTMLAudioElement) => a.currentTime);
  await page.waitForTimeout(200);
  expect(await audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBe(paused);
  await page.getByTitle('Play', { exact: true }).click();
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(paused + 0.15);
  await page.getByTitle('Pause', { exact: true }).click();
  await audio.evaluate((a: HTMLAudioElement) => { a.currentTime = 7; });
  await expect(scrubber).toHaveAttribute('aria-valuenow', '7');
  await page.getByTitle('Play', { exact: true }).click();
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(7.1);
  await audio.evaluate((a: HTMLAudioElement) => { a.currentTime = a.duration - 0.05; });
  await expect(audio).toHaveJSProperty('ended', true);
  await page.getByTitle('Play', { exact: true }).click();
  expect(await audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeLessThan(0.5);
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.6);
  await expect(audio).toHaveAttribute('src', source!);
  expect(fixture.errors).toEqual([]);
});

for (const rate of [0.1, 1.5]) {
  test(`prepared audio preserves saved ${rate}x speed through native metadata loading`, async ({ page }) => {
    const fixture = await loadFixture(page, undefined, false);
    fixture.state.audioSettings.playbackRate = rate;
    await page.locator('.profile-input').fill('001');
    const audio = page.locator('audio');
    await expect(audio).toHaveJSProperty('readyState', 4);
    await expect(audio).toHaveJSProperty('playbackRate', rate);
    await expect(audio).toHaveJSProperty('preservesPitch', true);
    await revealControls(page);
    await page.getByTitle('Play', { exact: true }).click();
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.1);
    await expect(audio).toHaveJSProperty('playbackRate', rate);
    expect(fixture.errors).toEqual([]);
  });
}

test('prepared audio bookmarks display padded time but save and reload original speech time without drift', async ({ page }) => {
  const fixture = await loadFixture(page, undefined, false);
  let saved = [0, 2];
  let writes = 0;
  let fail = true;
  await page.route('**/api/profiles/001/bookmarks?*', async route => {
    if (route.request().method() === 'PUT') {
      writes++;
      if (fail) { await route.fulfill({ status: 503 }); return; }
      saved = route.request().postDataJSON().bookmarks;
    }
    await route.fulfill({ json: { bookmarks: saved } });
  });
  // PUT uses no query string.
  await page.route('**/api/profiles/001/bookmarks', async route => {
    writes++;
    if (fail) { await route.fulfill({ status: 503 }); return; }
    saved = route.request().postDataJSON().bookmarks;
    await route.fulfill({ json: { bookmarks: saved } });
  });
  await page.locator('.profile-input').fill('001');
  await expect(page.locator('audio')).toHaveJSProperty('readyState', 4);
  await revealControls(page);
  const scrubber = page.getByRole('slider', { name: 'Audio position', exact: true });
  await scrubber.press('Enter');
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = 3.5; });
  const bookmark = page.getByTitle('Bookmarks: click to return, double-click to add, triple-click to remove', { exact: true });
  await bookmark.dblclick();
  await expect(page.getByRole('alert')).toContainText('Bookmarks not saved');
  fail = false;
  await page.getByTitle('Retry bookmarks', { exact: true }).click();
  await expect.poll(() => saved).toEqual([0, 2, 3]);
  expect(writes).toBe(2);
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = 4; });
  await bookmark.click();
  await expect(scrubber).toHaveAttribute('aria-valuenow', '3.5');
  await page.getByRole('slider', { name: 'Precise audio position', exact: true }).press('Escape');
  await page.locator('.nav-zone-right').dblclick();
  await expect.poll(fixture.navigationCount).toBe(1);
  await revealControls(page);
  await scrubber.press('Enter');
  await page.locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = 4; });
  await bookmark.click();
  await expect(scrubber).toHaveAttribute('aria-valuenow', '3.5');
  expect(saved).toEqual([0, 2, 3]);
  expect(fixture.errors).toEqual([]);
});

test('prepared audio autoplay failure is visible and retry can start audio', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    let rejected = false;
    HTMLMediaElement.prototype.play = function () {
      if (!rejected) {
        rejected = true;
        return Promise.reject(new DOMException('Playback blocked', 'NotAllowedError'));
      }
      return play.call(this);
    };
  });
  const fixture = await loadFixture(page);
  await revealControls(page);
  await page.getByTitle('Play', { exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Playback was blocked. Tap Play to retry or allow sound for this site.');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.getByTitle('Play', { exact: true }).hover();
    await withinViewport(page.getByRole('alert'), page);
    const messageBounds = (await page.getByRole('alert').boundingBox())!;
    const textBounds = (await page.locator('.observation-text').boundingBox())!;
    expect(textBounds.y + textBounds.height).toBeLessThan(messageBounds.y);
    await page.screenshot({ path: testInfo.outputPath(`playback-error-${viewport.width}.png`) });
  }
  await expect(page.locator('audio')).toHaveJSProperty('paused', true);
  await page.getByTitle('Play', { exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.1);
  expect(fixture.errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`real audio over HTTP ${viewport.width}`, () => {
    test.use({ viewport });
    test('actual audio bytes support coarse and precise seeking and resumed playback', async ({ page }) => {
      const audioUrl = process.env.UI_TEST_AUDIO_URL ?? process.env.UI_TEST_FLAC_URL;
      test.skip(!audioUrl, 'Set UI_TEST_AUDIO_URL to a prepared /api/audio/ URL.');
      let partialResponses = 0;
      page.on('response', (response) => {
        if (new URL(response.url()).pathname === new URL(audioUrl!, baseUrl).pathname && response.status() === 206) partialResponses += 1;
      });
      const fixture = await loadFixture(page, audioUrl!);
      const range = await page.evaluate(async url => {
        const response = await fetch(url, { headers: { Range: 'bytes=0-43' } });
        return { status: response.status, range: response.headers.get('content-range'), length: (await response.arrayBuffer()).byteLength };
      }, audioUrl!);
      expect(range.status).toBe(206);
      expect(range.range).toMatch(/^bytes 0-43\//);
      expect(range.length).toBe(44);
      await revealControls(page);
      const audio = page.locator('audio');
      const duration = await audio.evaluate((element: HTMLAudioElement) => element.duration);
      expect(Number.isFinite(duration)).toBe(true);
      expect(duration).toBeGreaterThan(1);
      await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.seekable.length ? element.seekable.end(element.seekable.length - 1) : 0)).toBeCloseTo(duration, 1);
      const scrubber = page.getByRole('slider', { name: 'Audio position', exact: true });
      const bounds = (await scrubber.boundingBox())!;
      for (const fraction of [0.75, 0.25]) {
        await page.mouse.click(bounds.x + bounds.width * fraction, bounds.y + bounds.height / 2);
        await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(duration * fraction, 1);
        await expect(audio).toHaveJSProperty('seeking', false);
      }
      const precise = page.getByRole('slider', { name: 'Precise audio position' });
      await expect(precise).toBeVisible();
      const track = (await precise.boundingBox())!;
      const before = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
      await page.mouse.move(track.x + 30, track.y + track.height / 2);
      await page.mouse.down();
      await page.mouse.move(track.x + 130, track.y + track.height / 2, { steps: 10 });
      await page.mouse.up();
      await expect(audio).toHaveJSProperty('seeking', false);
      await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(before + 0.1, 2);
      await precise.press('Escape');
      await page.getByTitle('Play', { exact: true }).click();
      await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(before + 0.2);
      await page.getByTitle('Pause', { exact: true }).click();
      expect(partialResponses).toBeGreaterThan(0);
      expect(fixture.errors).toEqual([]);
    });
  });
}

for (const failure of ['proxy-error', 'network-error', 'missing-endpoint']) {
  test(`profile loading distinguishes ${failure} from an invalid code and can retry`, async ({ page }) => {
    const fixture = await loadFixture(page, undefined, false);
    let attempts = 0;
    await page.route('**/api/profiles/load', async route => {
      attempts += 1;
      if (attempts > 1) { await route.fallback(); return; }
      if (failure === 'network-error') { await route.abort('connectionrefused'); return; }
      await route.fulfill({ status: failure === 'proxy-error' ? 500 : 404, contentType: 'text/plain', body: '' });
    });
    const input = page.locator('.profile-input');
    await input.fill('001');
    await expect(page.getByRole('status', { name: 'Profile server unavailable', exact: true })).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('.entry-code')).toHaveAttribute('data-invalid', 'false');
    await expect(page.getByRole('status', { name: 'Invalid profile code', exact: true })).toHaveCount(0);
    await expect(input).toHaveValue('');
    await input.fill('001');
    await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
    expect(attempts).toBe(2);
    expect(fixture.errors).toEqual([]);
  });
}

test('startup keeps loading dots until the first observation is available', async ({ page }, testInfo) => {
  const fixture = await loadFixture(page, undefined, false);
  const firstObservation = fixture.state.currentObservation;
  fixture.state.currentObservation = null;
  fixture.state.canBack = false;
  fixture.state.canNext = false;
  fixture.state.nextStatus = 'preparing';
  fixture.state.currentPosition = null;
  fixture.state.historyLength = 0;
  fixture.state.queue = { unseenCount: 1, readyCount: 0, preparingCount: 1, pendingCount: 0 };
  await page.locator('.profile-input').fill('001');
  const loading = page.getByRole('status', { name: 'Loading observation', exact: true });
  const start = page.getByRole('button', { name: 'Start observations', exact: true });
  await expect(loading).toHaveText('...');
  await expect(start).toHaveCount(0);
  await expect(page.locator('.nav-zone-right')).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('startup-loading.png') });
  fixture.state.canNext = true;
  fixture.state.nextStatus = 'ready';
  fixture.state.queue = { unseenCount: 1, readyCount: 1, preparingCount: 0, pendingCount: 0 };
  await expect(start).toBeVisible();
  await expect(loading).toHaveCount(0);
  await withinViewport(start, page);
  await page.screenshot({ path: testInfo.outputPath('startup-ready.png') });
  let releaseNavigation = () => {};
  const gate = new Promise<void>(resolve => { releaseNavigation = resolve; });
  await page.route('**/api/profiles/001/next', async route => {
    await gate;
    fixture.state.currentObservation = firstObservation;
    await route.fallback();
  });
  await start.press('Enter');
  await expect(loading).toBeVisible();
  await expect(start).toHaveCount(0);
  releaseNavigation();
  await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
  await expect(loading).toHaveCount(0);
  expect(fixture.navigationCount()).toBe(1);
  expect(fixture.errors).toEqual([]);
});

test('navigation hides replacement text immediately until its font is fitted', async ({ page }) => {
  const fixture = await loadFixture(page);
  await page.evaluate(() => {
    document.fonts.check = () => false;
    document.fonts.load = () => new Promise<FontFace[]>(resolve => {
      const text = document.querySelector('.observation-text') as HTMLElement;
      text.dataset.opacityBeforeFont = getComputedStyle(text).opacity;
      window.addEventListener('release-observation-font', () => resolve([]), { once: true });
    });
  });
  fixture.state.currentObservation!.text = `${sampleText} ${sampleText}`;
  await page.locator('.nav-zone-right').dblclick();
  const text = page.locator('.observation-text');
  await expect(text).toHaveText(fixture.state.currentObservation!.text);
  await expect(text).toHaveAttribute('data-opacity-before-font', '0');
  await expect(text).toHaveCSS('opacity', '0');
  await page.evaluate(() => window.dispatchEvent(new Event('release-observation-font')));
  await expect(text).toHaveCSS('opacity', '1');
  expect(fixture.navigationCount()).toBe(1);
  expect(fixture.errors).toEqual([]);
});

test('refitting visible text never hides it or restarts a settled gradient', async ({ page }) => {
  const fixture = await loadFixture(page);
  await page.locator('.gradient-field').evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  const before = await page.locator('html').evaluate(element => ['--gradient-turn-a', '--gradient-turn-b', '--gradient-shift'].map(property => element.style.getPropertyValue(property)));
  const family = await page.locator('.observation-text').evaluate(element => element.style.fontFamily);
  await page.evaluate(() => {
    document.fonts.load = () => new Promise<FontFace[]>(() => {});
    const text = document.querySelector('.observation-text') as HTMLElement;
    const observer = new MutationObserver(() => {
      if (text.style.opacity === '0') text.dataset.hiddenDuringRefit = 'true';
    });
    observer.observe(text, { attributes: true, attributeFilter: ['style'] });
  });
  await page.setViewportSize({ width: 900, height: 720 });
  await page.setViewportSize({ width: 920, height: 740 });
  await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
  await expect(page.locator('.observation-text')).not.toHaveAttribute('data-hidden-during-refit', 'true');
  expect(await page.locator('.observation-text').evaluate(element => element.style.fontFamily)).toBe(family);
  expect(await page.locator('html').evaluate(element => ['--gradient-turn-a', '--gradient-turn-b', '--gradient-shift'].map(property => element.style.getPropertyValue(property)))).toEqual(before);
  expect(await page.locator('.gradient-field').evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  expect(fixture.navigationCount()).toBe(0);
  expect(fixture.errors).toEqual([]);
});

test('a delayed status poll cannot replay the previous observation after navigation', async ({ page }) => {
  const fixture = await loadFixture(page);
  const staleState = structuredClone(fixture.state);
  let releasePoll = () => {};
  let pollRequested = () => {};
  const pollGate = new Promise<void>(resolve => { releasePoll = resolve; });
  const requestGate = new Promise<void>(resolve => { pollRequested = resolve; });
  let held = false;
  await page.route('**/api/profiles/001/state?*', async (route) => {
    if (held) { await route.fallback(); return; }
    held = true;
    pollRequested();
    await pollGate;
    await route.fulfill({ json: staleState });
  });
  await requestGate;
  await page.locator('.nav-zone-right').dblclick();
  await expect.poll(fixture.navigationCount).toBe(1);
  await expect(page.locator('.nav-zone-right')).toBeEnabled();
  const rotation = await page.locator('html').evaluate(element => element.style.getPropertyValue('--gradient-turn-a'));
  const response = page.waitForResponse('**/api/profiles/001/state?*');
  releasePoll();
  await response;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.locator('html').evaluate(element => element.style.getPropertyValue('--gradient-turn-a'))).toBe(rotation);
  expect(fixture.navigationCount()).toBe(1);
  expect(fixture.errors).toEqual([]);
});

test('navigation feedback counts dispatched requests once and rejects overlapping activation', async ({ page }, testInfo) => {
  const fixture = await loadFixture(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await expect(page.locator('.navigation-feedback')).toHaveCount(0);
  await page.locator('.nav-zone-right').click();
  expect(fixture.navigationCount()).toBe(0);
  await expect(page.locator('.navigation-feedback')).toHaveCount(0);
  let releaseNavigation = () => {};
  const gate = new Promise<void>(resolve => { releaseNavigation = resolve; });
  await page.route('**/api/profiles/001/next', async route => { await gate; await route.fallback(); });
  await page.locator('.nav-zone-right').evaluate(element => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  });
  const feedback = page.getByRole('status', { name: 'Next', exact: true });
  await expect(feedback).toHaveText('');
  await expect(feedback).toHaveAttribute('data-sequence', '1');
  await withinViewport(feedback, page);
  const bounds = (await feedback.boundingBox())!;
  expect(bounds.y).toBe(16);
  expect(page.viewportSize()!.width - bounds.x - bounds.width).toBe(20);
  releaseNavigation();
  await expect(page.locator('.nav-zone-right')).toBeEnabled();
  expect(fixture.navigationCount()).toBe(1);
  await page.locator('.nav-zone-left').press('Enter');
  await expect(page.getByRole('status', { name: 'Back', exact: true })).toHaveAttribute('data-sequence', '2');
  await expect(page.locator('.nav-zone-left')).toBeEnabled();
  expect(fixture.navigationCount()).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('navigation-feedback.png') });
  await page.clock.fastForward(1600);
  await expect(page.locator('.navigation-feedback')).toHaveCount(0);
  expect(fixture.navigationCount()).toBe(2);
  expect(fixture.errors).toEqual([]);
});

test.describe('touch navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('delayed profile preferences keep the existing text-free loading spinner', async ({ page }) => {
    const fixture = await loadFixture(page, undefined, false);
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/profiles/001/preferences', async route => {
      await gate;
      await route.fallback();
    });
    await page.locator('.profile-input').fill('001');
    const loading = page.getByRole('status', { name: 'Loading profile settings', exact: true });
    await expect(loading).toBeVisible();
    await expect(loading.locator('svg')).toBeVisible();
    await expect(loading).toHaveText('');
    await expect(page.getByText('Loading profile settings...', { exact: true })).toHaveCount(0);
    await expect(page.locator('.observation-screen')).toHaveCount(0);
    release();
    await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
    await expect(loading).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
  });
  test('only blank center double taps reveal the settings icon without opening settings', async ({ page }) => {
    const fixture = await loadFixture(page, undefined, true, 'అవును చెట్టు');
    await wordImageFixture(page);
    const center = (await page.locator('.observation-center').boundingBox())!;
    const settings = page.locator('.settings-trigger');
    const player = page.locator('.audio-player-bar');
    await page.touchscreen.tap(center.x + center.width / 2, center.y + 12);
    await expect(player).toHaveCSS('opacity', '1');
    await expect(settings).toHaveCSS('opacity', '0');
    await page.touchscreen.tap(center.x + center.width / 2, center.y + 12);
    await expect(player).toHaveCSS('opacity', '0');
    for (const y of [center.y + 12, 820]) {
      await page.touchscreen.tap(center.x + center.width / 2, y);
      await page.touchscreen.tap(center.x + center.width / 2, y);
      await expect(settings).toHaveCSS('opacity', '1');
      await expect(player).toHaveCSS('opacity', '0');
      await expect(page.locator('.settings-screen')).toHaveCount(0);
    }
    await page.locator('.nav-zone-right').tap();
    await page.locator('.nav-zone-right').tap();
    await expect.poll(fixture.navigationCount).toBe(1);
    await expect(settings).toHaveCSS('opacity', '0');
    const word = await page.locator('.observation-text').evaluate(element => {
      const range = document.createRange();
      range.setStart(element.firstChild!, 0);
      range.setEnd(element.firstChild!, 'అవును'.length);
      const bounds = range.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });
    await page.touchscreen.tap(word.x, word.y);
    await page.touchscreen.tap(word.x, word.y);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(settings).toHaveCSS('opacity', '0');
    await page.keyboard.press('Escape');
    await page.locator('.nav-zone-right').focus();
    await page.keyboard.press('Tab');
    await expect(settings).toBeFocused();
    await expect(settings).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await expect(page.locator('.settings-screen')).toBeVisible();
    expect(fixture.errors).toEqual([]);
  });
  test('mobile progress follows the media clock between sparse timeupdate events at every speed', async ({ page }) => {
    const fixture = await loadFixture(page);
    await revealControls(page);
    const audio = page.locator('audio');
    const coarse = page.getByRole('slider', { name: 'Audio position', exact: true });
    const precise = page.getByRole('slider', { name: 'Precise audio position', exact: true });
    await coarse.press('Enter');
    await audio.evaluate(element => {
      element.addEventListener('timeupdate', event => event.stopImmediatePropagation(), true);
    });
    for (const rate of [0.1, 1, 1.5]) {
      await page.getByTitle('Playback speed', { exact: true }).tap();
      const speed = page.getByRole('slider', { name: 'Playback speed', exact: true });
      await speed.press('Home');
      for (let step = 0; step < Math.round((rate - 0.1) / 0.05); step += 1) await speed.press('ArrowUp');
      await page.getByTitle('Playback speed', { exact: true }).tap();
      await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 3; });
      await page.getByTitle('Play', { exact: true }).tap();
      await expect(audio).toHaveAttribute('src', /^blob:/);
      await expect(audio).toHaveJSProperty('playbackRate', rate);
      await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(3.05);
      for (let sample = 0; sample < 4; sample += 1) {
        await page.waitForTimeout(80);
        const timing = await audio.evaluate((element: HTMLAudioElement) => ({
          media: element.currentTime,
          coarse: Number(document.querySelector('.audio-scrubber')?.getAttribute('aria-valuenow')),
          precise: Number(document.querySelector('.audio-magnifier-track')?.getAttribute('aria-valuenow')),
        }));
        expect(Math.abs(timing.coarse - timing.media)).toBeLessThan(0.1);
        expect(timing.precise).toBe(timing.coarse);
      }
      await page.getByTitle('Pause', { exact: true }).tap();
      await expect(precise).toHaveAttribute('aria-valuenow', await coarse.getAttribute('aria-valuenow') ?? '');
    }
    expect(fixture.errors).toEqual([]);
  });
  test('precision touch dragging survives cancellation and capture outside the track', async ({ page }) => {
    const fixture = await loadFixture(page);
    await page.locator('.observation-text').tap();
    await expect(page.locator('.audio-player-bar')).toHaveCSS('opacity', '1');
    const client = await page.context().newCDPSession(page);
    const scrubber = page.getByRole('slider', { name: 'Audio position', exact: true });
    const bar = (await scrubber.boundingBox())!;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 }] });
    const precise = page.getByRole('slider', { name: 'Precise audio position' });
    await expect(precise).toBeVisible();
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => Number(await precise.getAttribute('aria-valuenow'))).toBeGreaterThan(9);
    const bounds = (await precise.boundingBox())!;
    const before = Number(await precise.getAttribute('aria-valuenow'));
    const point = { x: bounds.x + 30, y: bounds.y + bounds.height / 2 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 100, y: point.y - 70 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect.poll(async () => Number(await precise.getAttribute('aria-valuenow'))).toBeCloseTo(before + 0.1, 2);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 50, y: point.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => Number(await precise.getAttribute('aria-valuenow'))).toBeCloseTo(before + 0.15, 2);
    expect(fixture.navigationCount()).toBe(0);
    expect(fixture.errors).toEqual([]);
    await client.detach();
  });
  test('double taps navigate but a popover dismissal does not', async ({ page }) => {
    const fixture = await loadFixture(page);
    const next = page.locator('.nav-zone-right');
    await next.tap();
    expect(fixture.navigationCount()).toBe(0);
    await expect(page.locator('.observation-screen')).toHaveClass(/controls-visible/);
    await next.tap();
    await expect.poll(fixture.navigationCount).toBe(1);
    await expect(next).toBeEnabled();
    await expect(page.locator('.audio-player-bar')).toHaveCSS('opacity', '0');
    await page.locator('.observation-text').tap();
    await page.getByTitle('Playback speed', { exact: true }).tap();
    await next.tap();
    await next.tap();
    await expect(page.getByRole('slider', { name: 'Playback speed', exact: true })).toHaveCount(0);
    expect(fixture.navigationCount()).toBe(1);
    expect(fixture.errors).toEqual([]);
  });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`dark settings ${viewport.width}`, () => {
    test.use({ viewport });
    test('keyboard focus has no outlines and Tab and Space still operate controls', async ({ page }, testInfo) => {
      const fixture = await loadFixture(page, undefined, true, 'అవును చెట్టు');
      await wordImageFixture(page);
      const expectNoOutlines = async () => {
        expect(await page.evaluate(() => [...document.querySelectorAll('*')].filter(element => {
          const style = getComputedStyle(element);
          return element.getClientRects().length > 0 && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        }).map(element => element.className))).toEqual([]);
      };
      const focusVisibleControls = async () => {
        for (const control of await page.locator('button:enabled, input:enabled, textarea:enabled, select:enabled, a[href], [role="slider"]').all()) {
          if (!await control.isVisible()) continue;
          await control.focus();
          await expectNoOutlines();
        }
      };
      await page.locator('.nav-zone-left').focus();
      await page.keyboard.press('Tab');
      await expect(page.getByTitle('Play', { exact: true })).toBeFocused();
      await expectNoOutlines();
      await page.keyboard.press('Space');
      await expect(page.locator('audio')).toHaveJSProperty('paused', false);
      await expectNoOutlines();
      await page.keyboard.press('Space');
      await expect(page.locator('audio')).toHaveJSProperty('paused', true);
      await page.screenshot({ path: testInfo.outputPath('keyboard-player.png') });
      await focusVisibleControls();
      await page.getByTitle('Playback speed', { exact: true }).click();
      await page.getByRole('slider', { name: 'Playback speed', exact: true }).focus();
      await expectNoOutlines();
      await page.mouse.click(10, 10);
      await doubleClickWord(page, 'అవును');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Tab');
      await expectNoOutlines();
      await page.keyboard.press('Escape');
      await openSettings(page);
      await focusVisibleControls();
      await page.getByRole('button', { name: 'Display: Image generation', exact: true }).click();
      await page.getByLabel('Image prompt', { exact: true }).focus();
      await expectNoOutlines();
      await page.screenshot({ path: testInfo.outputPath('keyboard-settings.png') });
      expect(fixture.errors).toEqual([]);
    });
    test('inline fields retain one focus indicator', async ({ page }, testInfo) => {
      await page.addInitScript((appearance) => localStorage.setItem('telugu-now-appearance-v1', JSON.stringify(appearance)), darkAppearance);
      const fixture = await loadFixture(page);
      await page.screenshot({ path: testInfo.outputPath('dark-reader.png') });
      await openSettings(page);
      await page.screenshot({ path: testInfo.outputPath('dark-settings.png') });
      await page.getByRole('button', { name: 'Sampling', exact: true }).click();
      await page.getByRole('button', { name: 'Complexity', exact: true }).click();
      const target = page.getByLabel('Target', { exact: true });
      await target.click();
      await expect(target).toHaveCSS('outline-style', 'none');
      await target.press('Tab');
      const spread = page.getByLabel('Spread', { exact: true });
      await expect(spread).toBeFocused();
      await expect(spread).toHaveCSS('outline-style', 'none');
      await expect(spread).toHaveCSS('border-bottom-style', 'solid');
      await withinViewport(spread, page);
      await page.screenshot({ path: testInfo.outputPath('dark-complexity.png') });
      expect(fixture.errors).toEqual([]);
    });
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('profile entry is text-free with stable digit, loading and error states', async ({ page }, testInfo) => {
      const fixture = await loadFixture(page, undefined, false);
      const input = page.locator('.profile-input');
      const screen = page.locator('.entry-screen');
      const field = page.locator('.entry-code');
      await expect(screen).toHaveText('');
      await expect(input).not.toHaveAttribute('placeholder');
      for (const digit of await page.locator('.entry-digit').all()) {
        await expect(digit).toHaveCSS('border-top-style', 'none');
        await expect(digit).toHaveCSS('border-bottom-style', 'solid');
        await expect(digit).toHaveCSS('border-radius', '0px');
        await expect(digit).toHaveCSS('box-shadow', 'none');
        expect(await digit.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('0');
      }
      await withinViewport(field, page);
      const initialBounds = await field.boundingBox();
      await page.screenshot({ path: testInfo.outputPath('profile-entry.png') });
      await input.fill('0');
      const middleDigit = page.locator('.entry-digit').nth(1);
      await expect(middleDigit).toHaveAttribute('data-active', 'true');
      await expect.poll(() => middleDigit.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('1');
      expect(await middleDigit.evaluate(element => getComputedStyle(element, '::before').backgroundImage)).toContain('linear-gradient');
      await page.screenshot({ path: testInfo.outputPath('profile-entry-highlight.png') });
      await input.evaluate(element => element.blur());
      await expect.poll(() => middleDigit.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('0');
      await input.fill('12');
      await expect(page.locator('.entry-digits')).toHaveText('12');
      expect(await field.boundingBox()).toEqual(initialBounds);
      await input.press('Backspace');
      await expect(input).toHaveValue('1');
      await input.press('ArrowLeft');
      await expect(page.locator('.entry-digit').first()).toHaveAttribute('data-active', 'true');
      await expect.poll(() => page.locator('.entry-digit').first().evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('1');
      await expect.poll(() => middleDigit.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('0');
      await page.screenshot({ path: testInfo.outputPath('profile-entry-focused.png') });
      const submissions: string[] = [];
      let releaseLoad = () => {};
      const gate = new Promise<void>(resolve => { releaseLoad = resolve; });
      await page.route('**/api/profiles/load', async route => {
        const code = route.request().postDataJSON().code as string;
        submissions.push(code);
        if (code === '999') { await route.fulfill({ status: 404, json: { error: 'invalid-profile-code' } }); return; }
        await gate;
        await route.fallback();
      });
      await input.fill('999');
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toHaveValue('');
      await expect(screen).toHaveText('');
      await expect(page.getByRole('status', { name: 'Invalid profile code' })).toBeVisible();
      await expect(page.locator('.entry-digit').first()).toHaveCSS('border-bottom-style', 'dashed');
      expect(await field.boundingBox()).toEqual(initialBounds);
      await page.screenshot({ path: testInfo.outputPath('profile-entry-invalid.png') });
      await input.fill('001');
      await expect(page.getByRole('status', { name: 'Loading profile' })).toBeVisible();
      await expect(input).toHaveJSProperty('readOnly', true);
      await expect(screen).toHaveText('001');
      expect(await field.boundingBox()).toEqual(initialBounds);
      await page.screenshot({ path: testInfo.outputPath('profile-entry-loading.png') });
      releaseLoad();
      await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
      expect(submissions).toEqual(['999', '001']);
      expect(fixture.errors).toEqual([]);
    });

    test('export dialog covers the viewport and progress has its own row', async ({ page }, testInfo) => {
      const fixture = await loadFixture(page);
      await openSettings(page);
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('spinbutton').fill('10');
      const trigger = page.getByRole('button', { name: 'Export', exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true);
      await withinViewport(dialog, page);
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('export-format.png') });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.getByRole('button', { name: /^HTML/ }).click();
      const progress = page.getByRole('progressbar');
      await expect(progress).toBeVisible();
      const actions = (await page.locator('.export-actions').boundingBox())!;
      expect((await progress.boundingBox())!.y).toBeGreaterThan(actions.y + actions.height);
      await expect(page.getByRole('status')).toContainText('Selecting observations');
      await page.screenshot({ path: testInfo.outputPath('export-progress.png') });
      fixture.releaseExport();
      await expect(progress).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
      expect(fixture.errors).toEqual([]);
    });

    test('settings typography and navigation fit Telugu labels', async ({ page }, testInfo) => {
      const fixture = await loadFixture(page);
      await openSettings(page);
      await page.locator('.language-toggle').click();
      await expect(page.locator('.settings-header h1')).toHaveText('అమరికలు');
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.fonts.check('16px "Manrope Variable"', 'Settings'))).toBe(true);
      expect(await page.evaluate(() => document.fonts.check('16px "Noto Sans Telugu"', 'అమరికలు'))).toBe(true);
      const content = page.locator('.settings-page-content');
      expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const button of await page.locator('.settings-index button').all()) {
        await button.scrollIntoViewIfNeeded();
        await withinViewport(button, page);
        const bounds = (await button.boundingBox())!;
        const label = (await button.locator('.settings-entry-text').boundingBox())!;
        expect(label.x).toBeGreaterThan(bounds.x);
        expect(label.x + label.width).toBeLessThan(bounds.x + bounds.width);
      }
      await content.evaluate(element => element.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath('settings-telugu.png') });
      if (viewport.width >= 960) {
        const rail = page.locator('.settings-rail');
        expect(await rail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        const appearance = rail.getByRole('button', { name: 'ప్రదర్శన: రూపం', exact: true });
        await appearance.click();
        await expect(appearance).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('.settings-header h1')).toHaveText('రూపం');
      }
      expect(fixture.errors).toEqual([]);
    });

    test('appearance auto-fade delay persists and controls the idle timer', async ({ page }, testInfo) => {
      const fixture = await loadFixture(page);
      const openAppearance = async () => {
        await openSettings(page);
        await page.getByRole('button', { name: 'Display', exact: true }).click();
        await page.getByRole('button', { name: 'Appearance', exact: true }).click();
      };
      await openAppearance();
      const delay = page.getByRole('slider', { name: 'Auto-fade delay', exact: true });
      await expect(delay).toHaveValue('15');
      await delay.press('Home');
      for (let step = 0; step < 4; step += 1) await delay.press('ArrowRight');
      await expect(delay).toHaveValue('5');
      await expect(delay).toHaveAttribute('aria-valuetext', '5 seconds');
      await withinViewport(delay, page);
      await expect(delay.locator('..').locator('output')).toHaveText('5 s');
      await page.screenshot({ path: testInfo.outputPath('appearance-auto-fade.png') });
      await page.reload();
      await page.locator('.profile-input').fill('001');
      await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
      await openAppearance();
      await expect(delay).toHaveValue('5');
      await page.locator('.settings-close').click();
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      await revealControls(page, true);
      await revealSettings(page);
      const player = page.locator('.audio-player-bar');
      const settings = page.locator('.settings-trigger');
      await page.clock.fastForward(4000);
      await page.mouse.move(120, 120);
      await page.clock.fastForward(4999);
      await expect(player).toHaveCSS('opacity', '1');
      await expect(settings).toHaveCSS('opacity', '1');
      await page.clock.fastForward(501);
      await expect(player).toHaveCSS('opacity', '0');
      await expect(settings).toHaveCSS('opacity', '0');
      await revealControls(page, true);
      const precise = page.getByRole('slider', { name: 'Precise audio position' });
      await expect(precise).toBeVisible();
      await page.mouse.move(120, 120);
      await page.clock.fastForward(20000);
      await expect(player).toHaveCSS('opacity', '0');
      await expect(settings).toHaveCSS('opacity', '0');
      await revealControls(page, true);
      await openAppearance();
      await delay.press('End');
      await expect(delay).toHaveValue('60');
      await page.getByRole('button', { name: 'Reset positions', exact: true }).click();
      await expect(delay).toHaveValue('60');
      await page.getByRole('button', { name: 'Reset auto-fade delay', exact: true }).click();
      await expect(delay).toHaveValue('15');
      await page.locator('.settings-close').click();
      await revealControls(page, true);
      await page.clock.fastForward(14999);
      await expect(player).toHaveCSS('opacity', '1');
      await page.clock.fastForward(501);
      await expect(player).toHaveCSS('opacity', '0');
      await expect(settings).toHaveCSS('opacity', '0');
      expect(fixture.errors).toEqual([]);
    });

    test('appearance positions move independently, persist, and place the magnifier on either side', async ({ page }, testInfo) => {
      await page.addInitScript(appearance => {
        if (!localStorage.getItem('telugu-now-appearance-v1')) localStorage.setItem('telugu-now-appearance-v1', JSON.stringify(appearance));
      }, { ...darkAppearance, fontScale: 0 });
      const fixture = await loadFixture(page, undefined, true, 'అవును');
      const text = page.locator('.observation-text');
      const player = page.locator('.audio-player-bar');
      const initialText = (await text.boundingBox())!;
      const initialBar = (await player.boundingBox())!;
      const initialSettings = (await page.locator('.settings-trigger').boundingBox())!;
      const openAppearance = async () => {
        await openSettings(page);
        await page.getByRole('button', { name: 'Display', exact: true }).click();
        await page.getByRole('button', { name: 'Appearance', exact: true }).click();
      };
      const setOffset = async (name: string, target: number) => {
        const slider = page.getByRole('slider', { name, exact: true });
        const current = Number(await slider.inputValue());
        for (let step = 0; step < Math.abs(target - current); step += 1) {
          await slider.press(target > current ? 'ArrowRight' : 'ArrowLeft');
        }
        await expect(slider).toHaveValue(String(target));
      };
      for (const offset of [20, -20]) {
        await openAppearance();
        await setOffset('Text vertical offset', offset);
        const audioOffset = -Math.sign(offset) * 6;
        await setOffset('Audio bar vertical offset', audioOffset);
        await page.locator('.settings-close').click();
        await expect(text).toHaveCSS('opacity', '1');
        const textBounds = (await text.boundingBox())!;
        const playerBounds = (await player.boundingBox())!;
        const centerBounds = (await page.locator('.observation-center').boundingBox())!;
        // Small viewports clamp requested offsets before text can overlap the player.
        const requestedTop = centerBounds.y + centerBounds.height / 2 + 20 + offset - textBounds.height / 2;
        const expectedTop = Math.max(centerBounds.y + 24, Math.min(requestedTop, playerBounds.y - 24 - textBounds.height));
        expect(textBounds.y).toBeCloseTo(expectedTop, 0);
        expect(playerBounds.y - initialBar.y).toBeCloseTo(audioOffset, 0);
        expect((await page.locator('.settings-trigger').boundingBox())!.y).toBeCloseTo(initialSettings.y, 0);
        await revealControls(page);
        const primary = (await page.locator('.audio-primary-controls').boundingBox())!;
        for (const button of await player.locator('button').all()) {
          const bounds = (await button.boundingBox())!;
          expect(bounds.y + bounds.height / 2).toBeCloseTo(primary.y + primary.height / 2, 0);
        }
        const magnifier = page.locator('.audio-magnifier');
        await withinViewport(magnifier, page);
        const bounds = (await magnifier.boundingBox())!;
        const coarse = (await page.locator('.audio-scrubber').boundingBox())!;
        expect(bounds.y).toBeGreaterThan(coarse.y + coarse.height);
        await page.getByRole('slider', { name: 'Precise audio position' }).press('Escape');
        await expect(magnifier).toBeVisible();
      }
      await openAppearance();
      await page.getByRole('radio', { name: 'Above', exact: true }).check();
      await expect(page.getByRole('radio', { name: 'Above', exact: true })).toBeChecked();
      await page.locator('.appearance-section').filter({ has: page.getByRole('heading', { name: 'Position', exact: true }) }).evaluate(element => element.scrollIntoView({ block: 'start' }));
      expect(await page.locator('.settings-page-content').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('appearance-positions.png') });
      await page.locator('.settings-close').click();
      await revealControls(page);
      const above = page.locator('.audio-magnifier');
      await withinViewport(above, page);
      const coarse = (await page.locator('.audio-scrubber').boundingBox())!;
      const aboveBounds = (await above.boundingBox())!;
      expect(aboveBounds.y + aboveBounds.height).toBeLessThan(coarse.y);
      const primary = (await page.locator('.audio-primary-controls').boundingBox())!;
      expect(primary.y).toBeGreaterThan(coarse.y + coarse.height);
      for (const button of await page.locator('.audio-primary-controls button').all()) {
        const bounds = (await button.boundingBox())!;
        expect(bounds.y + bounds.height <= initialSettings.y
          || bounds.x + bounds.width <= initialSettings.x
          || bounds.x >= initialSettings.x + initialSettings.width).toBe(true);
      }
      await withinViewport(text, page);
      await page.screenshot({ path: testInfo.outputPath('magnifier-above.png') });
      await page.reload();
      await page.locator('.profile-input').fill('001');
      await expect(text).toHaveCSS('opacity', '1');
      await openAppearance();
      await expect(page.getByRole('slider', { name: 'Text vertical offset' })).toHaveValue('-20');
      await expect(page.getByRole('slider', { name: 'Audio bar vertical offset' })).toHaveValue('6');
      await expect(page.getByRole('radio', { name: 'Above', exact: true })).toBeChecked();
      await page.getByRole('button', { name: 'Reset positions', exact: true }).click();
      await expect(page.getByRole('slider', { name: 'Text vertical offset' })).toHaveValue('0');
      await expect(page.getByRole('slider', { name: 'Audio bar vertical offset' })).toHaveValue('0');
      await expect(page.getByRole('radio', { name: 'Below', exact: true })).toBeChecked();
      await expect(page.getByLabel('Text & icons color', { exact: true })).toHaveValue(darkAppearance.foreground);
      await page.locator('.settings-close').click();
      await expect(text).toHaveCSS('opacity', '1');
      expect((await text.boundingBox())!.y).toBeCloseTo(initialText.y, 0);
      expect((await player.boundingBox())!.y).toBeCloseTo(initialBar.y, 0);
      expect(fixture.errors).toEqual([]);
    });

    test('appearance offset limits keep long text and magnifiers inside the viewport', async ({ page }) => {
      const fixture = await loadFixture(page, undefined, false);
      fixture.state.currentObservation!.text = sampleText.repeat(12);
      for (const [offset, magnifierPosition] of [[-200, 'above'], [200, 'above'], [200, 'below']] as const) {
        fixture.preferences.set('001', {
          appearance: parseAppearance({ ...darkAppearance, fontScale: 100, textOffset: offset, audioOffset: offset, magnifierPosition }),
          language: 'en', imagePrompt: DEFAULT_IMAGE_PROMPT, allowImageRegeneration: false,
        });
        await page.reload();
        await page.locator('.profile-input').fill('001');
        const text = page.locator('.observation-text');
        await expect(text).toHaveCSS('opacity', '1');
        await withinViewport(text, page);
        const textBounds = (await text.boundingBox())!;
        const bar = (await page.locator('.audio-player-bar').boundingBox())!;
        const settings = (await page.locator('.settings-trigger').boundingBox())!;
        expect(bar.x + bar.width <= settings.x || bar.y + bar.height <= settings.y).toBe(true);
        expect(textBounds.y + textBounds.height).toBeLessThan(bar.y);
        expect(await text.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await revealControls(page);
        await withinViewport(page.locator('.audio-magnifier'), page);
        const panel = (await page.locator('.audio-magnifier').boundingBox())!;
        const coarse = (await page.locator('.audio-scrubber').boundingBox())!;
        if (magnifierPosition === 'above') expect(panel.y + panel.height).toBeLessThan(coarse.y);
        else expect(panel.y).toBeGreaterThan(coarse.y + coarse.height);
        await page.getByRole('slider', { name: 'Precise audio position' }).press('Escape');
        await page.getByTitle('Playback speed', { exact: true }).click();
        await withinViewport(page.locator('.audio-speed-popover'), page);
      }
      expect(fixture.errors).toEqual([]);
    });

    test('lowered observation text still fits long passages at maximum scale', async ({ page }) => {
      await page.addInitScript(appearance => localStorage.setItem('telugu-now-appearance-v1', JSON.stringify(appearance)), { ...darkAppearance, fontScale: 100 });
      const fixture = await loadFixture(page, undefined, false);
      fixture.state.currentObservation!.text = sampleText.repeat(12);
      await page.locator('.profile-input').fill('001');
      const text = page.locator('.observation-text');
      await expect(text).toHaveCSS('opacity', '1');
      await withinViewport(text, page);
      const textBounds = (await text.boundingBox())!;
      const bar = (await page.locator('.audio-player-bar').boundingBox())!;
      expect(textBounds.y + textBounds.height).toBeLessThan(bar.y);
      expect(await text.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(fixture.errors).toEqual([]);
    });

    test('corner controls use a distinct theme-aware color from audio', async ({ page }, testInfo) => {
      if (viewport.width === 390 || viewport.width === 844) {
        await page.addInitScript(appearance => localStorage.setItem('telugu-now-appearance-v1', JSON.stringify(appearance)), darkAppearance);
      }
      const fixture = await loadFixture(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      await page.locator('.nav-zone-right').press('Enter');
      await expect(page.locator('.nav-zone-right')).toBeEnabled();
      await revealControls(page, true);
      const settings = page.locator('.settings-trigger');
      const feedback = page.getByRole('status', { name: 'Next', exact: true });
      const player = page.locator('.audio-player-bar');
      const audioColor = await player.evaluate(element => getComputedStyle(element).color);
      const cornerColor = await settings.evaluate(element => getComputedStyle(element).color);
      expect(cornerColor).not.toBe(audioColor);
      await expect(feedback).toHaveCSS('color', cornerColor);
      await expect(page.locator('.observation-text')).not.toHaveCSS('color', audioColor);
      await expect(player.locator('button').first()).toHaveCSS('color', audioColor);
      const expectGlassPaint = async () => {
        await page.getByRole('slider', { name: 'Audio position', exact: true }).press('Enter');
        const paint = await player.evaluate(element => {
          const background = (target: Element, pseudo?: string) => {
            const style = getComputedStyle(target, pseudo);
            return { image: style.backgroundImage, color: style.backgroundColor };
          };
          return {
            icon: background(element.querySelector('.audio-play-button .audio-glass-icon')!),
            thumb: background(element.querySelector('.audio-scrubber-thumb')!),
            bars: [...element.querySelectorAll('.audio-magnifier-bar')].map(bar => background(bar)),
            progress: background(element.querySelector('.audio-scrubber-progress')!),
            track: background(element.querySelector('.audio-scrubber')!, '::before'),
          };
        });
        expect(paint.icon.image).toContain('linear-gradient');
        expect(paint.thumb.image).toBe(paint.icon.image);
        expect(paint.bars.length).toBeGreaterThan(0);
        for (const layer of [paint.icon, paint.thumb, ...paint.bars]) {
          expect(layer.image).toBe(paint.icon.image);
          expect(layer.color).toBe('rgba(0, 0, 0, 0)');
        }
        expect(paint.progress.color).toBe('rgba(0, 0, 0, 0)');
        expect(paint.track.color).toBe('rgba(0, 0, 0, 0)');
        expect(paint.progress.image).toContain('linear-gradient');
        expect(paint.track.image).toBe(paint.progress.image);
        const alphas = [...paint.progress.image.matchAll(/\/\s*([\d.]+)\s*\)/g)].map(match => Number(match[1]));
        expect(alphas).toHaveLength(3);
        expect(alphas[0]).toBeCloseTo(0.2);
        expect(alphas[1]).toBeCloseTo(0.85);
        expect(alphas[2]).toBeCloseTo(0.2);
        expect(alphas[0]!).toBeLessThan(alphas[1]!);
        expect(alphas[2]!).toBeLessThan(alphas[1]!);
        await page.getByRole('slider', { name: 'Precise audio position', exact: true }).press('Escape');
      };
      await expectGlassPaint();
      await expect(settings).toHaveCSS('opacity', '0');
      await expect(player).toHaveCSS('opacity', '1');
      await withinViewport(settings, page);
      await withinViewport(feedback, page);
      await page.screenshot({ path: testInfo.outputPath('corner-control-colors.png') });
      await page.clock.resume();
      await openSettings(page);
      await page.getByRole('button', { name: 'Display', exact: true }).click();
      await page.getByRole('button', { name: 'Appearance', exact: true }).click();
      for (const [index, color] of ['#c5decf', '#aacabb', '#90b09f'].entries()) {
        await page.getByLabel(`Gradient color ${index + 1}`, { exact: true }).fill(color);
      }
      await page.locator('.settings-close').click();
      await revealControls(page);
      await expect(settings).not.toHaveCSS('color', cornerColor);
      await expect(player).not.toHaveCSS('color', audioColor);
      await expectGlassPaint();
      await page.screenshot({ path: testInfo.outputPath('corner-control-colors-updated.png') });
      expect(fixture.errors).toEqual([]);
    });

    test('reader and audio controls stay usable and precisely seek', async ({ page }, testInfo) => {
      const fixture = await loadFixture(page);
      await revealControls(page);
      const player = page.locator('.audio-player-bar');
      await expect(player).toHaveCSS('box-shadow', 'none');
      await expect(player).toHaveCSS('background-image', 'none');
      await withinViewport(player, page);
      await withinViewport(page.locator('.observation-text'), page);
      const textBounds = (await page.locator('.observation-text').boundingBox())!;
      const playerBounds = (await player.boundingBox())!;
      expect(textBounds.y + textBounds.height).toBeLessThan(playerBounds.y);
      await page.screenshot({ path: testInfo.outputPath('reader.png') });

      const scrubber = page.getByRole('slider', { name: 'Audio position', exact: true });
      const bar = (await scrubber.boundingBox())!;
      await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
      await page.mouse.down();
      await page.mouse.move(bar.x + bar.width + 1, bar.y + bar.height / 2);
      await page.mouse.up();
      await expect(scrubber).toHaveAttribute('aria-valuenow', '20');
      const speedButton = (await page.getByTitle('Playback speed', { exact: true }).boundingBox())!;
      const bookmarkButton = (await player.locator('.audio-bookmark-button').boundingBox())!;
      const playButton = (await page.getByTitle('Play', { exact: true }).boundingBox())!;
      const endThumb = (await player.locator('.audio-scrubber-thumb').boundingBox())!;
      expect(endThumb.x + endThumb.width / 2).toBeCloseTo(bar.x + bar.width, 0);
      expect(playButton.width).toBe(80);
      expect(playButton.height).toBe(64);
      for (const button of [speedButton, bookmarkButton]) {
        expect(button.width).toBe(48);
        expect(button.height).toBe(48);
        expect(button.y + button.height / 2).toBeCloseTo(playButton.y + playButton.height / 2, 0);
      }
      expect(playButton.x - speedButton.x - speedButton.width).toBe(12);
      expect(bookmarkButton.x - playButton.x - playButton.width).toBe(12);
      expect(playButton.y + playButton.height).toBeLessThan(bar.y);
      await page.screenshot({ path: testInfo.outputPath('audio-end-spacing.png') });
      await page.mouse.click(bar.x, bar.y + bar.height / 2);
      await expect(scrubber).toHaveAttribute('aria-valuenow', '0');
      const startThumb = (await player.locator('.audio-scrubber-thumb').boundingBox())!;
      expect(startThumb.x + startThumb.width / 2).toBeCloseTo(bar.x, 0);

      await page.getByTitle('Playback speed', { exact: true }).click();
      const speed = page.getByRole('slider', { name: 'Playback speed', exact: true });
      await withinViewport(page.locator('.audio-speed-popover'), page);
      await withinViewport(page.locator('.audio-speed-readout'), page);
      const speedBounds = (await speed.boundingBox())!;
      expect(speedBounds.y).toBeGreaterThanOrEqual(playerBounds.y);
      expect(speedBounds.y + speedBounds.height).toBeLessThanOrEqual(playerBounds.y + playerBounds.height);
      await speed.press('Home');
      await expect(page.locator('audio')).toHaveJSProperty('playbackRate', 0.1);
      await speed.press('End');
      await expect(page.locator('audio')).toHaveJSProperty('playbackRate', 1.5);
      await page.screenshot({ path: testInfo.outputPath('speed.png') });
      await page.mouse.click(10, 10);
      await expect(speed).toHaveCount(0);
      await expect(page.locator('.observation-screen')).toHaveClass(/controls-visible/);
      expect(fixture.navigationCount()).toBe(0);
      await page.getByTitle('Play', { exact: true }).click();
      await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.02);
      await page.getByTitle('Pause', { exact: true }).click();

      await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
      await page.mouse.down();
      const precise = page.getByRole('slider', { name: 'Precise audio position' });
      await expect(precise).toBeVisible();
      await page.mouse.up();
      await withinViewport(page.locator('.audio-magnifier'), page);
      await expect(page.locator('.audio-magnifier')).toHaveCSS('user-select', 'none');
      const nativeDragBlocked = await precise.evaluate((element) => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element.closest('.audio-magnifier')!);
        selection?.removeAllRanges();
        selection?.addRange(range);
        return !element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }));
      });
      expect(nativeDragBlocked).toBe(true);
      const fineBounds = (await precise.boundingBox())!;
      const before = Number(await precise.getAttribute('aria-valuenow'));
      await page.mouse.move(fineBounds.x + 30, fineBounds.y + fineBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(fineBounds.x + 130, fineBounds.y + fineBounds.height / 2, { steps: 10 });
      await page.mouse.up();
      await expect.poll(async () => Number(await precise.getAttribute('aria-valuenow'))).toBeCloseTo(before + 0.1, 2);
      await page.screenshot({ path: testInfo.outputPath('precision.png') });
      await page.mouse.click(10, 10);
      await expect(precise).toHaveCount(1);
      await expect(player).toHaveCSS('opacity', '0');

      await revealControls(page);
      await expect(page.locator('.nav-zone svg')).toHaveCount(0);
      const settings = (await page.locator('.settings-trigger').boundingBox())!;
      expect(viewport.width - settings.x - settings.width).toBe(20);
      expect(viewport.height - settings.y - settings.height).toBe(16);
      await page.getByTitle('Playback speed', { exact: true }).click();
      await page.locator('.nav-zone-right').click();
      await expect(speed).toHaveCount(0);
      expect(fixture.navigationCount()).toBe(0);
      const rotation = await page.locator('html').evaluate((element) => element.style.getPropertyValue('--gradient-turn-a'));
      await page.locator('.nav-zone-right').click();
      expect(fixture.navigationCount()).toBe(0);
      await page.locator('.nav-zone-right').dblclick();
      await expect.poll(fixture.navigationCount).toBe(1);
      await expect(player).toHaveCSS('opacity', '0');
      await expect.poll(() => page.locator('html').evaluate((element) => element.style.getPropertyValue('--gradient-turn-a'))).not.toBe(rotation);
      await page.locator('.nav-zone-left').dblclick();
      await expect.poll(fixture.navigationCount).toBe(2);
      await expect(page.locator('.nav-zone-right')).toBeEnabled();
      await page.locator('.nav-zone-right').press('Enter');
      await expect.poll(fixture.navigationCount).toBe(3);
      await expect(page.locator('.nav-zone-right')).toBeEnabled();
      const gradient = page.locator('.gradient-field > div').first();
      await expect(gradient).toHaveCSS('animation-name', 'none');
      await expect.poll(() => gradient.evaluate(element => element.getAnimations().length)).toBe(0);
      const drift = await gradient.evaluate(async (element) => {
        const before = getComputedStyle(element).transform;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return { before, after: getComputedStyle(element).transform };
      });
      expect(drift.after).toBe(drift.before);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(gradient).toHaveCSS('animation-name', 'none');
      await expect(gradient).toHaveCSS('transform', 'none');
      expect(fixture.errors).toEqual([]);
    });

    test('audio controls require a click and remain visible during activity', async ({ page }, testInfo) => {
      const fixture = await loadFixture(page);
      const player = page.locator('.audio-player-bar');
      await expect(player).toHaveCSS('opacity', '0');
      await expect(player).toHaveCSS('pointer-events', 'none');
      await page.mouse.move(100, 100);
      await expect(player).toHaveCSS('opacity', '0');
      const text = page.locator('.observation-text');
      await expect(text).toHaveCSS('user-select', 'text');
      const selectionBounds = await text.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const rects = Array.from(range.getClientRects());
        const first = rects[0]!;
        const last = rects.at(-1)!;
        return { startX: first.left + 1, startY: first.top + first.height / 2, endX: last.right - 1, endY: last.top + last.height / 2 };
      });
      await page.mouse.move(selectionBounds.startX, selectionBounds.startY);
      await page.mouse.down();
      await page.mouse.move(selectionBounds.endX, selectionBounds.endY, { steps: 12 });
      await page.mouse.up();
      const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
      expect(selected.length).toBeGreaterThan(0);
      await expect(page.locator('.observation-screen')).not.toHaveClass(/controls-visible/);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.keyboard.press('Control+c');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      for (const edge of ['.nav-zone-right', '.nav-zone-left']) {
        await page.locator(edge).click();
        await expect(player).toHaveCSS('opacity', '1');
        await expect(page.locator('.settings-trigger')).toHaveCSS('opacity', '0');
        await page.locator(edge).click();
        await expect(player).toHaveCSS('opacity', '0');
        expect(fixture.navigationCount()).toBe(0);
      }
      fixture.state.canBack = false;
      await expect(page.locator('.nav-zone-left')).toBeDisabled();
      const back = (await page.locator('.nav-zone-left').boundingBox())!;
      await page.mouse.click(back.x + back.width / 2, back.y + back.height / 2);
      await expect(player).toHaveCSS('opacity', '1');
      await page.mouse.dblclick(back.x + back.width / 2, back.y + back.height / 2);
      await expect(player).toHaveCSS('opacity', '0');
      expect(fixture.navigationCount()).toBe(0);
      fixture.state.canBack = true;
      await expect(page.locator('.nav-zone-left')).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath('reader-hidden.png') });
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      await revealControls(page, true);
      for (let step = 0; step < 3; step += 1) {
        await page.clock.fastForward(14000);
        await page.mouse.move(120 + step * 10, 120);
        await expect(player).toHaveCSS('opacity', '1');
        await expect(page.locator('.settings-trigger')).toHaveCSS('opacity', '0');
      }
      await page.screenshot({ path: testInfo.outputPath('reader-controls.png') });
      await page.clock.fastForward(14999);
      await expect(player).toHaveCSS('opacity', '1');
      await expect(page.locator('.settings-trigger')).toHaveCSS('opacity', '0');
      await page.clock.fastForward(501);
      await expect(player).toHaveCSS('opacity', '0');
      await expect(page.locator('.settings-trigger')).toHaveCSS('opacity', '0');
      await page.mouse.move(160, 120);
      await expect(player).toHaveCSS('opacity', '0');
      await revealControls(page, true);
      await page.getByTitle('Play', { exact: true }).click();
      await page.clock.fastForward(500);
      await expect(page.locator('audio')).toHaveJSProperty('paused', false);
      await page.clock.fastForward(15500);
      await expect(player).toHaveCSS('opacity', '0');
      await expect(page.locator('.settings-trigger')).toHaveCSS('opacity', '0');
      await expect(page.locator('audio')).toHaveJSProperty('paused', false);
      await revealControls(page, true);
      await page.getByTitle('Pause', { exact: true }).click();
      await page.getByTitle('Playback speed', { exact: true }).click();
      await page.mouse.move(160, 120);
      await page.clock.fastForward(5000);
      await expect(player).toHaveCSS('opacity', '1');
      await page.mouse.click(10, 10);
      await expect(page.locator('.audio-speed-popover')).toHaveCount(0);
      await page.clock.fastForward(15500);
      await expect(player).toHaveCSS('opacity', '0');
      await revealControls(page, true);
      const precise = page.getByRole('slider', { name: 'Precise audio position' });
      await expect(precise).toBeVisible();
      const drag = (await precise.boundingBox())!;
      await page.mouse.move(drag.x + 30, drag.y + drag.height / 2);
      await page.mouse.down();
      await page.clock.fastForward(45000);
      await expect(player).toHaveCSS('opacity', '1');
      await expect(page.locator('.settings-trigger')).toHaveCSS('opacity', '0');
      await expect(precise).toBeVisible();
      await page.mouse.up();
      await precise.press('Escape');
      await expect(precise).toHaveCount(1);
      await page.clock.fastForward(14999);
      await expect(player).toHaveCSS('opacity', '1');
      await page.clock.fastForward(501);
      await expect(player).toHaveCSS('opacity', '0');
      await page.locator('.nav-zone-left').focus();
      await page.keyboard.press('Tab');
      await expect(page.getByTitle('Play', { exact: true })).toBeFocused();
      await expect(player).toHaveCSS('opacity', '1');
      await page.clock.fastForward(15500);
      await expect(player).toHaveCSS('opacity', '0');
      await expect(page.locator('.settings-trigger')).toHaveCSS('opacity', '0');
      await page.keyboard.press('Space');
      await page.clock.fastForward(500);
      await expect(player).toHaveCSS('opacity', '1');
      await expect(page.locator('audio')).toHaveJSProperty('paused', false);
      expect(fixture.errors).toEqual([]);
    });

    test('settings groups, appearance, reset and export work', async ({ page }, testInfo) => {
      const fixture = await loadFixture(page);
      await openSettings(page);
      await expect(page.locator('.settings-header')).toHaveCSS('border-bottom-width', '0px');
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('.settings-screen')).toHaveCSS('font-family', /Manrope Variable/);
      await expect(page.locator('#settings-summary-sampling')).toHaveText('Target 50% · Spread 25%');
      await expect(page.locator('#settings-summary-display')).toContainText('1x');
      const closeBounds = (await page.locator('.settings-close').boundingBox())!;
      expect(viewport.width - closeBounds.x - closeBounds.width).toBe(20);
      expect(closeBounds.y).toBe(16);
      const rail = page.getByRole('navigation', { name: 'Settings navigation' });
      if (viewport.width >= 960) {
        await expect(rail).toBeVisible();
        await rail.getByRole('button', { name: 'Display: Appearance', exact: true }).click();
        await expect(page.locator('.settings-header h1')).toHaveText('Appearance');
        await expect(page.locator('.settings-header h1')).toBeFocused();
        await expect(rail.getByRole('button', { name: 'Display: Appearance', exact: true })).toHaveAttribute('aria-current', 'page');
        await rail.getByRole('button', { name: 'Sampling: Complexity', exact: true }).click();
        await expect(page.getByLabel('Target', { exact: true })).toHaveValue('50');
        await page.getByLabel('Target', { exact: true }).fill('65');
        await page.getByRole('button', { name: 'Hide settings menu', exact: true }).click();
        await expect(rail).toHaveCount(0);
        const railToggle = page.getByRole('button', { name: 'Show settings menu', exact: true });
        await expect(railToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(railToggle).toBeFocused();
        await expect(page.getByLabel('Target', { exact: true })).toHaveValue('65');
        await withinViewport(page.locator('.settings-page-content'), page);
        await page.screenshot({ path: testInfo.outputPath('settings-collapsed.png') });
        await railToggle.press('Enter');
        await expect(rail).toBeVisible();
        await expect(page.getByRole('button', { name: 'Hide settings menu', exact: true })).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByLabel('Target', { exact: true })).toHaveValue('65');
        await rail.getByRole('button', { name: 'Diagnostic: Complexity', exact: true }).click();
        await expect(page.locator('.diagnostic-table')).toBeVisible();
        await rail.getByRole('button', { name: 'Settings: Settings', exact: true }).click();
        await expect(page.locator('.settings-header h1')).toHaveText('Settings');
      } else {
        await expect(rail).toHaveCount(0);
        await expect(page.locator('.settings-rail-toggle')).toBeHidden();
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(page.locator('.settings-page-transition')).toHaveCSS('animation-name', 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const sampling = page.getByRole('button', { name: 'Sampling', exact: true });
      await sampling.hover();
      await expect(sampling).toHaveCSS('padding-left', '12px');
      await expect(sampling).toHaveCSS('padding-right', '12px');
      await withinViewport(sampling, page);
      await page.screenshot({ path: testInfo.outputPath('settings-hover.png') });
      await page.screenshot({ path: testInfo.outputPath('settings.png') });
      await page.getByRole('button', { name: 'Sampling', exact: true }).click();
      for (const name of ['Complexity', 'Source weights', 'Data sources']) {
        await page.getByRole('button', { name, exact: true }).click();
        await expect(page.locator('.settings-header h1')).toHaveText(name);
        await expect(page.locator('input[title]')).toHaveCount(0);
        if (name === 'Complexity' || name === 'Source weights') {
          const value = page.locator('input[type="number"]').first();
          await value.click();
          await expect(value).toHaveCSS('outline-style', 'none');
          await expect(value).toHaveCSS('border-radius', '0px');
          await expect(value).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
          await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
          if (name === 'Complexity') {
            await expect(page.getByLabel('Target', { exact: true })).toBeVisible();
            await expect(page.getByLabel('Spread', { exact: true })).toBeVisible();
          }
          await page.screenshot({ path: testInfo.outputPath(`${name.toLowerCase().replaceAll(' ', '-')}.png`) });
        }
        await page.locator('.settings-back').click();
        await expect(page.locator('.settings-header h1')).toHaveText('Sampling');
      }
      await page.locator('.settings-back').click();
      await page.getByRole('button', { name: 'Diagnostic', exact: true }).click();
      const diagnosticPages = await page.locator('.settings-page-content button').allTextContents();
      expect(diagnosticPages).toHaveLength(4);
      for (const name of diagnosticPages) {
        await page.getByRole('button', { name: name.trim(), exact: true }).click();
        await expect(page.locator('.diagnostic-table')).toBeVisible();
        await page.locator('.settings-back').click();
      }
      await page.locator('.settings-back').click();
      await page.getByRole('button', { name: 'Display', exact: true }).click();
      await page.getByRole('button', { name: 'Appearance', exact: true }).click();
      await page.getByLabel('Text & icons color', { exact: true }).fill('#20332c');
      await page.getByLabel('Settings & popovers color', { exact: true }).fill('#e8eeee');
      await expect(page.getByRole('switch', { name: 'Automatic surface' })).not.toBeChecked();
      await expect(page.locator('.settings-screen')).toHaveCSS('background-color', 'rgb(232, 238, 238)');
      await page.getByLabel('Gradient color 1', { exact: true }).fill('#e4f0eb');
      const appearancePreview = page.getByRole('img', { name: 'Appearance preview' });
      await appearancePreview.scrollIntoViewIfNeeded();
      await withinViewport(appearancePreview, page);
      await expect(appearancePreview).toHaveCSS('background-image', /rgb\(228, 240, 235\)/);
      await expect(appearancePreview).toHaveCSS('color', 'rgb(32, 51, 44)');
      await page.screenshot({ path: testInfo.outputPath('color-roles.png') });
      const scale = page.getByRole('slider', { name: 'Font size scale' });
      await scale.scrollIntoViewIfNeeded();
      await scale.press('End');
      for (let step = 0; step < 20; step += 1) await scale.press('ArrowLeft');
      await expect(scale).toHaveValue('80');
      await expect(appearancePreview.locator('span')).toHaveCSS('font-size', '43.2px');
      const fonts = page.getByRole('checkbox');
      const fontCount = await fonts.count();
      for (let index = 1; index < fontCount; index += 1) await fonts.nth(index).uncheck();
      await expect(fonts.first()).toBeDisabled();
      await scale.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('appearance.png') });
      await expect(page.locator('.appearance-root')).toHaveCSS('color', 'rgb(32, 51, 44)');
      await page.locator('.settings-close').click();
      await expect(page.locator('.observation-text')).toHaveCSS('font-family', /Noto Sans Telugu/);
      await expect(page.locator('.observation-text')).toHaveCSS('color', 'rgb(32, 51, 44)');
      const audioColor = await page.locator('.audio-player-bar').evaluate(element => getComputedStyle(element).color);
      expect(audioColor).not.toBe('rgb(32, 51, 44)');
      await revealControls(page);
      const audioSurface = await page.locator('.audio-play-button').evaluate(element => getComputedStyle(element).backgroundColor);
      expect(audioSurface).not.toBe('rgb(232, 238, 238)');
      await expect(page.locator('.audio-magnifier')).toHaveCSS('background-color', audioSurface);
      await expect(page.locator('.audio-magnifier')).toHaveCSS('color', audioColor);
      await page.screenshot({ path: testInfo.outputPath('custom-magnifier.png') });
      await page.reload();
      await page.locator('.profile-input').fill('001');
      await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
      await openSettings(page);
      await page.getByRole('button', { name: 'Display', exact: true }).click();
      await page.getByRole('button', { name: 'Appearance', exact: true }).click();
      await expect(scale).toHaveValue('80');
      await expect(page.getByLabel('Text & icons color', { exact: true })).toHaveValue('#20332c');
      await expect(page.getByLabel('Settings & popovers color', { exact: true })).toHaveValue('#e8eeee');
      await expect(fonts.first()).toBeDisabled();
      await page.getByRole('switch', { name: 'Automatic surface' }).check();
      await expect(page.getByLabel('Settings & popovers color', { exact: true })).toHaveValue('#f8f9fa');
      await page.getByRole('button', { name: 'Reset colors', exact: true }).click();
      await expect(page.getByLabel('Text & icons color', { exact: true })).toHaveValue('#171717');
      await expect(scale).toHaveValue('80');
      await expect(fonts.first()).toBeDisabled();
      await page.locator('.settings-back').click();
      await page.getByRole('button', { name: 'Playback speed', exact: true }).click();
      await page.locator('input[type="number"]').fill('0.1');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(() => fixture.state.audioSettings.playbackRate).toBe(0.1);
      if (await page.locator('.settings-header h1').textContent() === 'Playback speed') await page.locator('.settings-back').click();
      await page.locator('.settings-back').click();
      await page.getByRole('button', { name: 'Reset queue', exact: true }).click();
      expect(fixture.resetCount()).toBe(0);
      await page.getByRole('button', { name: 'Reset queue', exact: true }).click();
      await expect.poll(fixture.resetCount).toBe(1);
      await page.locator('.settings-back').click();
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.locator('input[type="number"]').fill('1');
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('button', { name: /^HTML/ }).click();
      await expect(page.getByRole('progressbar')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('export.png') });
      fixture.releaseExport();
      await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 30000 });
      await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
      expect(fixture.errors).toEqual([]);
    });
  });
}
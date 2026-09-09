import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ProfileStateResponse, SelectionSnapshot } from '../shared/contracts';

const baseUrl = process.env.UI_TEST_URL ?? 'http://127.0.0.1:5173';
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

async function loadFixture(page: Page) {
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
      id: 'observation-1', sourceId: 'fixture', sourceKey: 'row-1', text: sampleText,
      audio: { url: '/api/test-audio.wav', mimeType: 'audio/wav', durationSeconds: 20 },
      diagnostic: {
        acquisitionNumber: 1, triggerKind: 'initial-fill', triggeredByObservationId: null,
        triggeredByAcquisitionNumber: null, triggeredByHistoryPosition: null,
        triggeredAt: 0, waitingAheadAtTrigger: 0, preparationInFlightAtTrigger: false,
        requestStartedAt: 0, requestCompletedAt: 1, requestDurationMs: 1, cacheHit: false, selection,
      },
    },
  };
  let navigationCount = 0;
  let resetCount = 0;
  let releaseExport = () => {};
  const exportGate = new Promise<void>((resolve) => { releaseExport = resolve; });
  const audio = audioFixture();
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
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
      await exportGate;
      await route.fulfill({ json: { settings: state.selectionSettings, entries: [{ position: 0, sourceId: 'fixture', sourceKey: 'row-1', text: sampleText, diagnostic: { selection, cacheHit: false, requestStartedAt: 0, requestCompletedAt: 1, requestDurationMs: 1 } }] } });
    } else if (/\/(next|back)$/.test(pathname)) {
      navigationCount += 1;
      state.currentObservation = { ...state.currentObservation!, id: `observation-${navigationCount + 1}` };
      await route.fulfill({ json: state });
    } else if (pathname.endsWith('/load') || pathname.endsWith('/state')) {
      await route.fulfill({ json: state });
    } else {
      throw new Error(`Unmocked API request: ${pathname}`);
    }
  });
  await page.goto(baseUrl);
  await page.locator('.profile-input').fill('001');
  await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
  await expect(page.locator('audio')).toHaveJSProperty('readyState', 4);
  return { errors, state, releaseExport, navigationCount: () => navigationCount, resetCount: () => resetCount };
}

async function openSettings(page: Page) {
  await page.locator('.observation-text').click();
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

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('reader and audio controls stay usable and precisely seek', async ({ page }, testInfo) => {
      const fixture = await loadFixture(page);
      const player = page.locator('.audio-player-bar');
      await expect(player).toHaveCSS('box-shadow', 'none');
      await expect(player).toHaveCSS('background-image', 'none');
      await withinViewport(player, page);
      await withinViewport(page.locator('.observation-text'), page);
      const textBounds = (await page.locator('.observation-text').boundingBox())!;
      const playerBounds = (await player.boundingBox())!;
      expect(textBounds.y + textBounds.height).toBeLessThan(playerBounds.y);
      await page.screenshot({ path: testInfo.outputPath('reader.png') });

      await page.getByTitle('Playback speed', { exact: true }).click();
      const speed = page.getByRole('slider', { name: 'Playback speed', exact: true });
      await withinViewport(page.locator('.audio-speed-popover'), page);
      await withinViewport(page.locator('.audio-speed-readout'), page);
      const speedBounds = (await speed.boundingBox())!;
      expect(Math.abs(speedBounds.y + speedBounds.height / 2 - playerBounds.y - playerBounds.height / 2)).toBeLessThan(1);
      await speed.press('Home');
      await expect(page.locator('audio')).toHaveJSProperty('playbackRate', 0.1);
      await speed.press('End');
      await expect(page.locator('audio')).toHaveJSProperty('playbackRate', 1.5);
      await page.screenshot({ path: testInfo.outputPath('speed.png') });
      await page.mouse.click(10, 10);
      await expect(speed).toHaveCount(0);
      await expect(page.locator('.observation-screen')).not.toHaveClass(/controls-visible/);
      expect(fixture.navigationCount()).toBe(0);
      await page.getByTitle('Play', { exact: true }).click();
      await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.02);
      await page.getByTitle('Pause', { exact: true }).click();

      const scrubber = page.getByRole('slider', { name: 'Audio position', exact: true });
      const bar = (await scrubber.boundingBox())!;
      await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
      await page.mouse.down();
      const precise = page.getByRole('slider', { name: 'Precise audio position' });
      await expect(precise).toBeVisible();
      await page.mouse.up();
      await withinViewport(page.locator('.audio-magnifier'), page);
      const fineBounds = (await precise.boundingBox())!;
      const before = Number(await precise.getAttribute('aria-valuenow'));
      await page.mouse.move(fineBounds.x + 30, fineBounds.y + fineBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(fineBounds.x + 130, fineBounds.y + fineBounds.height / 2, { steps: 10 });
      await page.mouse.up();
      await expect.poll(async () => Number(await precise.getAttribute('aria-valuenow'))).toBeCloseTo(before + 0.1, 2);
      await page.screenshot({ path: testInfo.outputPath('precision.png') });
      await page.mouse.click(10, 10);
      await expect(precise).toHaveCount(0);
      await expect(page.locator('.observation-screen')).not.toHaveClass(/controls-visible/);

      await page.locator('.observation-text').click();
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
      await expect.poll(() => page.locator('html').evaluate((element) => element.style.getPropertyValue('--gradient-turn-a'))).not.toBe(rotation);
      await page.locator('.nav-zone-left').dblclick();
      await expect.poll(fixture.navigationCount).toBe(2);
      await expect(page.locator('.nav-zone-right')).toBeEnabled();
      await page.locator('.nav-zone-right').press('Enter');
      await expect.poll(fixture.navigationCount).toBe(3);
      const gradient = page.locator('.gradient-field > div').first();
      await expect(gradient).toHaveCSS('animation-name', 'gradient-drift');
      const drift = await gradient.evaluate(async (element) => {
        const before = getComputedStyle(element).rotate;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return { before, after: getComputedStyle(element).rotate };
      });
      expect(drift.after).not.toBe(drift.before);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(gradient).toHaveCSS('animation-name', 'none');
      await expect(gradient).toHaveCSS('transform', 'none');
      expect(fixture.errors).toEqual([]);
    });

    test('settings groups, appearance, reset and export work', async ({ page }, testInfo) => {
      const fixture = await loadFixture(page);
      await openSettings(page);
      await expect(page.locator('.settings-header')).toHaveCSS('border-bottom-width', '0px');
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
      await page.getByLabel('Text color', { exact: true }).fill('#20332c');
      await page.getByLabel('Gradient color 1', { exact: true }).fill('#e4f0eb');
      const scale = page.getByRole('slider', { name: 'Font size scale' });
      await scale.fill('80');
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
      await expect(page.locator('.audio-player-bar')).not.toHaveCSS('color', 'rgb(23, 23, 23)');
      await page.reload();
      await page.locator('.profile-input').fill('001');
      await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
      await openSettings(page);
      await page.getByRole('button', { name: 'Display', exact: true }).click();
      await page.getByRole('button', { name: 'Appearance', exact: true }).click();
      await expect(scale).toHaveValue('80');
      await expect(page.getByLabel('Text color', { exact: true })).toHaveValue('#20332c');
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
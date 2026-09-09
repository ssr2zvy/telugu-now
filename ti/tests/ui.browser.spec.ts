import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ProfileStateResponse, SelectionSnapshot } from '../shared/contracts';

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

async function loadFixture(page: Page, realAudioUrl?: string, enterProfile = true) {
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
  let resetCount = 0;
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
  if (enterProfile) {
    await page.locator('.profile-input').fill('001');
    await expect(page.locator('.observation-text')).toHaveCSS('opacity', '1');
    await expect(page.locator('audio')).toHaveJSProperty('readyState', 4);
  }
  return { errors, state, releaseExport, navigationCount: () => navigationCount, resetCount: () => resetCount };
}

async function revealControls(page: Page) {
  if (!await page.locator('.observation-screen').evaluate(element => element.classList.contains('controls-visible'))) {
    await page.locator('.observation-text').click();
  }
  await expect(page.locator('.audio-player-bar')).toHaveCSS('opacity', '1');
}

async function openSettings(page: Page) {
  await revealControls(page);
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

for (const failure of ['pending', 'rejected', 'unavailable']) {
  test(`playback starts even when Web Audio is ${failure}`, async ({ page }) => {
    await page.addInitScript((failure) => {
      if (failure === 'unavailable') {
        window.AudioContext = class extends AudioContext {
          constructor() { super(); throw new Error('Audio processing unavailable'); }
        };
        return;
      }
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
    await expect.poll(() => page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.1);
    await expect(page.locator('html')).not.toHaveAttribute('data-audio-graph-connected', 'true');
    await page.getByTitle('Pause', { exact: true }).click();
    await expect(page.locator('audio')).toHaveJSProperty('paused', true);
    expect(fixture.errors).toEqual([]);
  });
}

test('playback failure is visible and retry can start audio', async ({ page }, testInfo) => {
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
  await expect(page.getByRole('alert')).toHaveText('Playback was blocked. Allow sound for this site and retry.');
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
      await scrubber.press('Enter');
      const precise = page.getByRole('slider', { name: 'Precise audio position' });
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
  await page.clock.pauseAt(new Date());
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
  const feedback = page.getByRole('status', { name: 'Next request 1', exact: true });
  await expect(feedback).toHaveAttribute('data-sequence', '1');
  await withinViewport(feedback, page);
  const bounds = (await feedback.boundingBox())!;
  expect(bounds.y).toBe(16);
  expect(page.viewportSize()!.width - bounds.x - bounds.width).toBe(20);
  releaseNavigation();
  await expect(page.locator('.nav-zone-right')).toBeEnabled();
  expect(fixture.navigationCount()).toBe(1);
  await page.locator('.nav-zone-left').press('Enter');
  await expect(page.getByRole('status', { name: 'Back request 2', exact: true })).toHaveAttribute('data-sequence', '2');
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
        await expect(digit).toHaveCSS('border-top-style', 'solid');
        await expect(digit).toHaveCSS('border-radius', '6px');
      }
      await withinViewport(field, page);
      const initialBounds = await field.boundingBox();
      await page.screenshot({ path: testInfo.outputPath('profile-entry.png') });
      await input.fill('12');
      await expect(page.locator('.entry-digits')).toHaveText('12');
      expect(await field.boundingBox()).toEqual(initialBounds);
      await input.press('Backspace');
      await expect(input).toHaveValue('1');
      await input.press('ArrowLeft');
      await expect(page.locator('.entry-digit').first()).toHaveAttribute('data-active', 'true');
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
      const speedIcon = (await page.getByTitle('Playback speed', { exact: true }).locator('svg').boundingBox())!;
      const bookmarkIcon = (await player.locator('button').last().locator('svg').boundingBox())!;
      const endThumb = (await player.locator('.audio-scrubber-thumb').boundingBox())!;
      const iconGap = bookmarkIcon.x - speedIcon.x - speedIcon.width;
      expect(Math.abs(speedIcon.x - endThumb.x - endThumb.width - iconGap)).toBeLessThan(1);
      await page.screenshot({ path: testInfo.outputPath('audio-end-spacing.png') });
      await page.mouse.click(bar.x, bar.y + bar.height / 2);
      await expect(scrubber).toHaveAttribute('aria-valuenow', '0');
      const playIcon = (await page.getByTitle('Play', { exact: true }).locator('svg').boundingBox())!;
      const startThumb = (await player.locator('.audio-scrubber-thumb').boundingBox())!;
      expect(Math.abs(startThumb.x - playIcon.x - playIcon.width - iconGap)).toBeLessThan(1);

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
      await expect(precise).toHaveCount(0);
      await expect(page.locator('.observation-screen')).toHaveClass(/controls-visible/);

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
      await page.screenshot({ path: testInfo.outputPath('reader-hidden.png') });
      await page.clock.install();
      await page.clock.pauseAt(new Date());
      await revealControls(page);
      for (let step = 0; step < 3; step += 1) {
        await page.clock.fastForward(2000);
        await page.mouse.move(120 + step * 10, 120);
        await expect(player).toHaveCSS('opacity', '1');
        await expect(page.locator('.settings-trigger')).toHaveCSS('opacity', '1');
      }
      await page.screenshot({ path: testInfo.outputPath('reader-controls.png') });
      await page.clock.fastForward(3500);
      await expect(player).toHaveCSS('opacity', '0');
      await expect(page.locator('.settings-trigger')).toHaveCSS('opacity', '0');
      await page.mouse.move(160, 120);
      await expect(player).toHaveCSS('opacity', '0');
      await revealControls(page);
      await page.getByTitle('Play', { exact: true }).click();
      await expect(page.locator('audio')).toHaveJSProperty('paused', false);
      await page.mouse.move(160, 120);
      await page.clock.fastForward(3500);
      await expect(player).toHaveCSS('opacity', '0');
      await expect(page.locator('audio')).toHaveJSProperty('paused', false);
      await revealControls(page);
      await page.getByTitle('Pause', { exact: true }).click();
      await page.getByTitle('Playback speed', { exact: true }).click();
      await page.mouse.move(160, 120);
      await page.clock.fastForward(5000);
      await expect(player).toHaveCSS('opacity', '1');
      await page.mouse.click(10, 10);
      await expect(page.locator('.audio-speed-popover')).toHaveCount(0);
      await page.clock.fastForward(3500);
      await expect(player).toHaveCSS('opacity', '0');
      await page.locator('.nav-zone-left').focus();
      await page.keyboard.press('Tab');
      await expect(page.getByTitle('Play', { exact: true })).toBeFocused();
      await expect(player).toHaveCSS('opacity', '1');
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
      await expect(page.locator('.audio-player-bar')).toHaveCSS('color', 'rgb(32, 51, 44)');
      await revealControls(page);
      await page.getByRole('slider', { name: 'Audio position', exact: true }).press('Enter');
      await expect(page.locator('.audio-magnifier')).toHaveCSS('background-color', 'rgb(232, 238, 238)');
      await expect(page.locator('.audio-magnifier')).toHaveCSS('color', 'rgb(32, 51, 44)');
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
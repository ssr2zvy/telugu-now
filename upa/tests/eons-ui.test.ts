import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getProfileEons, startProfileEon, stopProfileEon } from '../frontend/src/api';
import { parentSettingsPage, settingsGroups, settingsPageIcons, settingsPageLabel } from '../frontend/src/settings/navigation';
import { EonsPage } from '../frontend/src/settings/pages/EonsPage';
import type { ProfileEonsResponse } from '../shared/contracts';

test('eons have their own localized settings destination and a clear loading state', () => {
  assert.ok(settingsGroups.index?.includes('eons'));
  assert.equal(parentSettingsPage('eons'), 'index');
  assert.equal(settingsPageLabel('eons', 'en'), 'Eons');
  assert.equal(settingsPageLabel('eons', 'te'), 'యుగాలు');
  assert.ok(settingsPageIcons.eons);
  assert.equal(settingsGroups.observations?.at(-1), 'reset');
  const markup = renderToStaticMarkup(createElement(EonsPage, { profileCode: '001', language: 'en' }));
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /role="status">Loading eons/);
  assert.match(markup, /including queued audio and revisits/);
  assert.doesNotMatch(markup, /No completed eons yet/);
});

test('eon API helpers use profile-scoped endpoints and preserve server results', async t => {
  const result: ProfileEonsResponse = {
    activeEon: { id: 'eon-one', name: 'Practice', startedAt: 1700000000000, stoppedAt: null, observationCount: 1 },
    eons: [],
  };
  const requests: Array<{ url: string; options: RequestInit | undefined }> = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, options?: RequestInit) => {
    requests.push({ url: String(input), options });
    return new Response(JSON.stringify(result), { status: 200 });
  });
  const controller = new AbortController();
  assert.deepEqual(await getProfileEons('001', controller.signal), result);
  assert.equal(requests[0]?.url, '/api/profiles/001/eons');
  assert.equal(requests[0]?.options?.signal, controller.signal);
  assert.deepEqual(await startProfileEon('001', 'Practice'), result);
  assert.equal(requests[1]?.options?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[1]?.options?.body)), { name: 'Practice' });
  assert.deepEqual(await stopProfileEon('001', 'period/one'), result);
  assert.equal(requests[2]?.url, '/api/profiles/001/eons/period%2Fone/stop');
  assert.equal(requests[2]?.options?.method, 'POST');
});

test('eon API failures are propagated rather than replaced by empty history', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  await assert.rejects(getProfileEons('001'), /503/);
  await assert.rejects(startProfileEon('001', 'Practice'), /503/);
  await assert.rejects(stopProfileEon('001', 'eon-one'), /503/);
});

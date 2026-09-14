import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { parseAppearance } from '../shared/appearance';
import { DEFAULT_IMAGE_PROMPT } from '../shared/image-settings';
import { profilePreferencesRoutes, profilePreferencesStore } from '../server/src/services/profile-preferences-service';

function fixture() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(`CREATE TABLE profiles (code TEXT PRIMARY KEY); INSERT INTO profiles VALUES ('001'), ('002');
    CREATE TABLE image_settings (id INTEGER PRIMARY KEY, prompt TEXT NOT NULL);`);
  database.prepare('INSERT INTO image_settings VALUES (1, ?)').run('Existing <core word> prompt');
  return database;
}

test('browser data transfers into user storage without losing conflicts, malformed values or saved bookmarks', async () => {
  const database = fixture();
  try {
    const app = profilePreferencesRoutes(database, code => code === '001');
    const store = profilePreferencesStore(database);
    store.saveBookmarks('001', { sourceId: 'source', sourceKey: 'row', bookmarks: [] });
    const entries = [
      { key: 'telugu-now-appearance-v1', value: '{"fontScale":73}' },
      { key: 'telugu-now-settings-language', value: 'en' },
      { key: 'telugu-now-audio-bookmarks:source\u0000row', value: '[2,8]' },
      { key: 'telugu-now-audio-bookmarks:source\u0000other', value: '[9,4]' },
      { key: 'telugu-now-audio-bookmarks:malformed', value: 'unreadable' },
    ];
    const request = (code: string, payload = entries) => app.request(`/${code}/browser-data`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: payload }),
    });
    assert.equal((await request('002')).status, 404);
    assert.deepEqual(await (await request('001')).json(), { saved: true });
    assert.equal(store.get('001').appearance?.fontScale, 73);
    assert.equal(store.get('001').language, 'en');
    assert.deepEqual(store.getBookmarks('001', 'source', 'row'), []);
    assert.deepEqual(store.getBookmarks('001', 'source', 'other'), [4, 9]);
    await request('001');
    const count = () => (database.prepare('SELECT COUNT(*) AS count FROM profile_browser_data').get() as { count: number }).count;
    assert.equal(count(), entries.length);
    await request('001', [{ key: 'telugu-now-appearance-v1', value: '{"fontScale":20}' }]);
    assert.equal(store.get('001').appearance?.fontScale, 73);
    assert.equal(count(), entries.length + 1);
    assert.equal((await request('001', [{ key: 'unrelated', value: 'keep' }])).status, 400);
    database.prepare("DELETE FROM profiles WHERE code = '001'").run();
    assert.equal(count(), 0);
  } finally { database.close(); }
});

test('profile preferences isolate users, retain legacy prompts and initialize browser settings only once', () => {
  const database = fixture();
  try {
    const store = profilePreferencesStore(database);
    assert.deepEqual(store.get('001'), { appearance: null, language: null, imagePrompt: 'Existing <core word> prompt', allowImageRegeneration: false });
    assert.equal(database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'image_settings'").get(), undefined);
    store.update('001', { appearance: { fontScale: 75, fonts: ['Mandali'] }, language: 'te' }, true);
    store.update('001', { appearance: { fontScale: 5 }, language: 'en', imagePrompt: DEFAULT_IMAGE_PROMPT }, true);
    assert.equal(store.get('001').appearance?.fontScale, 75);
    assert.equal(store.get('001').language, 'te');
    store.update('001', { appearance: { audioOffset: 900 }, imagePrompt: 'Personal <core word> prompt' });
    const reloaded = profilePreferencesStore(database).get('001');
    assert.equal(reloaded.appearance?.audioOffset, 200);
    assert.equal(reloaded.appearance?.fontScale, 75);
    assert.deepEqual(reloaded.appearance?.fonts, ['Mandali']);
    assert.equal(reloaded.imagePrompt, 'Personal <core word> prompt');
    assert.deepEqual(store.get('002'), { appearance: null, language: null, imagePrompt: 'Existing <core word> prompt', allowImageRegeneration: false });
    database.prepare('DELETE FROM profiles WHERE code = ?').run('001');
    assert.equal(database.prepare('SELECT 1 FROM profile_preferences WHERE profile_code = ?').get('001'), undefined);
  } finally { database.close(); }
});

test('profile preference routes validate profiles and payloads and preserve saved settings during migration', async () => {
  const database = fixture();
  try {
    const app = profilePreferencesRoutes(database, code => code === '001');
    const request = (code: string, method = 'GET', body?: unknown) => app.request(`/${code}/preferences`, {
      method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    assert.equal((await request('002')).status, 404);
    assert.equal((await request('999', 'POST', {})).status, 404);
    // Image regeneration was removed, and prompts no longer require a placeholder,
    // so only structurally invalid payloads are rejected.
    for (const body of [null, [], { language: 'xx' }, { appearance: [] }, { imagePrompt: '' }, { imagePrompt: 5 }, { unexpected: true }]) {
      assert.equal((await request('001', 'PATCH', body)).status, 400);
    }
    const imported = await request('001', 'POST', { appearance: { foreground: '#abcdef' }, language: 'en' });
    assert.equal(imported.status, 200);
    assert.equal(imported.headers.get('Cache-Control'), 'no-store');
    await request('001', 'PATCH', { appearance: { fontScale: 80 }, language: 'te' });
    await request('001', 'POST', { appearance: { fontScale: 20 }, language: 'en' });
    const saved = await (await request('001')).json();
    assert.deepEqual(saved.appearance, parseAppearance({ foreground: '#abcdef', fontScale: 80 }));
    assert.equal(saved.language, 'te');
  } finally { database.close(); }
});

test('scroll mode defaults on for old profiles and opt-out survives unrelated preference updates', () => {
  const database = fixture();
  try {
    const store = profilePreferencesStore(database);
    store.update('001', { appearance: { fontScale: 65 } });
    assert.equal(store.get('001').appearance?.scrollMode, true);
    store.update('001', { appearance: { scrollMode: false } });
    store.update('001', { appearance: { audioOffset: -20 } });
    const saved = profilePreferencesStore(database).get('001').appearance;
    assert.equal(saved?.scrollMode, false);
    assert.equal(saved?.fontScale, 65);
    assert.equal(saved?.audioOffset, -20);
  } finally { database.close(); }
});

test('control darkness and timestamp choice persist per profile through unrelated updates', () => {
  const database = fixture();
  try {
    const store = profilePreferencesStore(database);
    store.update('001', { appearance: { fontScale: 65 } });
    assert.equal(store.get('001').appearance?.controlDarkness, 15);
    assert.equal(store.get('001').appearance?.showAudioTimestamp, false);
    store.update('001', { appearance: { controlDarkness: 35, showAudioTimestamp: true } });
    store.update('001', { appearance: { audioTimestampGap: 12, timestampMagnifierGap: 24 } });
    store.update('001', { appearance: { showAudioTimestamp: false } });
    const saved = profilePreferencesStore(database).get('001').appearance;
    assert.equal(saved?.controlDarkness, 35);
    assert.equal(saved?.showAudioTimestamp, false);
    assert.equal(saved?.audioTimestampGap, 12);
    assert.equal(saved?.timestampMagnifierGap, 24);
    assert.equal(saved?.fontScale, 65);
    assert.equal(store.get('002').appearance, null);
  } finally { database.close(); }
});

test('regeneration migration defaults off and preserves existing profile preferences', () => {
  const database = fixture();
  try {
    database.exec(`CREATE TABLE profile_preferences (
      profile_code TEXT PRIMARY KEY, appearance_json TEXT, language TEXT, image_prompt TEXT NOT NULL, updated_at INTEGER NOT NULL
    ); INSERT INTO profile_preferences VALUES ('001', '{"fontScale":73}', 'en', 'Legacy <core word>', 1);`);
    const store = profilePreferencesStore(database);
    assert.equal(store.get('001').allowImageRegeneration, false);
    assert.equal(store.get('001').appearance?.fontScale, 73);
    store.update('001', { allowImageRegeneration: true });
    store.update('001', { allowImageRegeneration: false }, true);
    assert.equal(profilePreferencesStore(database).get('001').allowImageRegeneration, true);
    assert.equal(store.get('002').allowImageRegeneration, false);
    assert.equal(store.get('001').imagePrompt, 'Legacy <core word>');
  } finally { database.close(); }
});

test('bookmarks and migration markers persist per profile without overwriting existing user records', async () => {
  const database = fixture();
  try {
    const app = profilePreferencesRoutes(database, code => ['001', '002'].includes(code));
    const request = (code: string, resource: string, method = 'GET', body?: unknown) => app.request(`/${code}/${resource}`, {
      method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    assert.deepEqual(await (await request('001', 'migrations')).json(), { settings: false, bookmarks: false });
    await request('001', 'preferences', 'POST', { appearance: {}, language: 'en' });
    assert.deepEqual(await (await request('001', 'migrations')).json(), { settings: true, bookmarks: false });
    await request('001', 'bookmarks', 'PUT', { sourceId: 'source', sourceKey: 'row', bookmarks: [8, 2, 2] });
    const read = (code: string) => request(code, 'bookmarks?sourceId=source&sourceKey=row');
    assert.deepEqual(await (await read('001')).json(), { bookmarks: [2, 8] });
    assert.deepEqual(await (await read('002')).json(), { bookmarks: [] });
    const records = [{ sourceId: 'source', sourceKey: 'row', bookmarks: [99] }, { sourceId: 'other', sourceKey: 'row', bookmarks: [4] }];
    assert.deepEqual(await (await request('001', 'bookmarks/import', 'POST', { records })).json(), { imported: true });
    assert.deepEqual(await (await read('001')).json(), { bookmarks: [2, 8] });
    assert.deepEqual(await (await request('001', 'bookmarks/import', 'POST', { records })).json(), { imported: false });
    const reopened = profilePreferencesStore(database);
    assert.deepEqual(reopened.migrations('001'), { settings: true, bookmarks: true });
    assert.deepEqual(reopened.migrations('002'), { settings: false, bookmarks: false });
    assert.deepEqual(reopened.getBookmarks('001', 'other', 'row'), [4]);
    assert.equal((await request('999', 'bookmarks?sourceId=source&sourceKey=row')).status, 404);
    for (const bookmarks of [[-1], [null], ['1'], Array(1001).fill(0)]) {
      assert.equal((await request('001', 'bookmarks', 'PUT', { sourceId: 'source', sourceKey: 'row', bookmarks })).status, 400);
    }
    assert.equal((await request('001', 'bookmarks/import', 'POST', { records: [null] })).status, 400);
    assert.equal((await request('001', 'bookmarks?sourceId=source')).status, 400);
    database.prepare("DELETE FROM profiles WHERE code = '001'").run();
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM profile_audio_bookmarks').get() as { count: number }).count, 0);
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM profile_migrations').get() as { count: number }).count, 0);
  } finally { database.close(); }
});
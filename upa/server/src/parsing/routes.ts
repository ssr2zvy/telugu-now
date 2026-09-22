import { stream } from 'hono/streaming';
import { parsingDiagnostics, diagnosticEvents, diagnosticExport } from './diagnostics';
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config/config';
import { db } from '../db/database';
import { coreProgress, graph, selectionMode, switchMode, type SelectionMode } from './state';
import { getParsingCatalog } from './catalog';
import { job, recoverWorker, startParsing } from './worker';
import { loadProfile } from '../services/profile-service';
import type { ParsingStatus } from '../../../shared/parsing';

export function parsingStatus(profile: string): ParsingStatus {
  const running = recoverWorker();
  let error: string | null = null;
  let stats: ParsingStatus['stats'] = null;
  let progress: ParsingStatus['progress'] = null;
  let ready = false;
  try { const c = getParsingCatalog(); stats = c.meta('stats'); coreProgress(profile, c.identity.inventoryId); ready = true; }
  catch (e) { error = e instanceof Error ? e.message : 'Parsing is unavailable'; }
  try {
    const p = coreProgress(profile);
    progress = { core: p.core, completed: p.core === 4, levels: [1, 2, 3].map(core => {
      const targets = Object.values(graph().nodes).filter(n => n.core === core);
      return { core, targets: targets.length, mastered: targets.filter(t => (p.streaks[t.id] ?? 0) >= 3).length };
    }) };
  } catch (e) { error = e instanceof Error ? e.message : 'Progress is unavailable'; }
  const { file: _file, ...safeJob } = job();
  return { mode: selectionMode(profile), ready, running, error, stats, progress, job: safeJob,
    operatorTokenRequired: true, operatorConfigured: Boolean(process.env.GRAMMAR_MIGRATION_TOKEN) };
}

export function parsingRoutes() {
  const app = new Hono();
  app.use('/:code/parsing/*', async (c, next) => {
    if (!config.profileCodes.has(c.req.param('code') ?? '')) return c.json({ error: 'invalid-profile-code' }, 404);
    if (c.req.method !== 'GET') {
      const origin = c.req.header('origin');
      if (origin) { try { if (new URL(origin).host !== c.req.header('host')) return c.json({ error: 'invalid-origin' }, 403); } catch { return c.json({ error: 'invalid-origin' }, 403); } }
    }
    await next();
  });
  app.get('/:code/parsing/status', c => c.json(parsingStatus(c.req.param('code'))));
  app.get('/:code/parsing/diagnostics', c => {
    c.header('Cache-Control','no-store');
    try { return c.json(parsingDiagnostics(c.req.param('code'))); }
    catch(e) { return c.json({error:e instanceof Error?e.message:'Diagnostics unavailable'},409); }
  });
  app.get('/:code/parsing/diagnostics/events', c => {
    c.header('Cache-Control','no-store');
    const core=Number(c.req.query('core')??1), before=Number(c.req.query('before')??Number.MAX_SAFE_INTEGER);
    if (![1,2,3].includes(core)||!Number.isSafeInteger(before)||before<1) return c.json({error:'Invalid core or cursor'},400);
    const events=diagnosticEvents(c.req.param('code'),core,before);
    return c.json({events,nextBefore:events.length===50?events.at(-1)!.seq:null});
  });
  app.get('/:code/parsing/diagnostics/export', c => {
    let result:ReturnType<typeof diagnosticExport>;
    try {result=diagnosticExport(c.req.param('code'));}
    catch(e) {return c.json({error:e instanceof Error?e.message:'Export unavailable'},409);}
    c.header('Content-Type','application/json; charset=utf-8');
    c.header('Content-Disposition',`attachment; filename="telugu-core-diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}.json"`);
    c.header('Cache-Control','no-store');
    return stream(c,async output=>{
      try {for await(const chunk of result.chunks) {if(output.aborted) break;await output.write(chunk);}}
      finally {result.close();}
    });
  });
  app.post('/:code/parsing/build', c => {
    // Keep the existing global-worker operator gate. Mode choices and reading
    // statistics remain profile operations and need no operator credential.
    const required = process.env.GRAMMAR_MIGRATION_TOKEN;
    if (!required) return c.json({ error: 'Configure the existing grammar operator token before starting a corpus build' }, 503);
    const token = c.req.header('x-grammar-operator-token') ?? '';
    const a = Buffer.from(required), b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: 'Invalid operator token' }, 403);
    try { startParsing(); return c.json(parsingStatus(c.req.param('code')), 202); }
    catch (e) { return c.json({ error: e instanceof Error ? e.message : 'Unable to start parsing' }, 409); }
  });
  app.post('/:code/parsing/mode', async c => {
    const body = await c.req.json<{ mode?: unknown }>().catch(() => null);
    if (!body || !['weighted', 'core', 'random'].includes(String(body.mode))) return c.json({ error: 'Choose weighted, core or random' }, 400);
    const mode = body.mode as SelectionMode, profile = c.req.param('code');
    try {
      if (mode === 'core') { const catalog = getParsingCatalog(); coreProgress(profile, catalog.identity.inventoryId); }
      switchMode(profile, mode);
      return c.json(loadProfile(profile, false));
    } catch (e) { return c.json({ error: e instanceof Error ? e.message : 'Mode change failed' }, 409); }
  });
  app.get('/:code/parsing/observation/:id', c => {
    const row = db.prepare('SELECT o.source_id,o.source_key FROM observations o JOIN observation_acquisitions a ON a.observation_id=o.id WHERE o.id=? AND a.profile_code=?').get(c.req.param('id'), c.req.param('code')) as { source_id: string; source_key: string } | undefined;
    if (!row) return c.json({ error: 'Observation not found' }, 404);
    try {
      const catalog = getParsingCatalog();
      const parsed = catalog.db.prepare('SELECT id FROM rows WHERE source_id=? AND source_key=?').get(row.source_id, row.source_key) as { id: number } | undefined;
      if (!parsed) return c.json({ error: 'Observation is absent from this parsing snapshot' }, 404);
      const words = catalog.db.prepare('SELECT rw.*,w.surface,w.status,w.recognized,w.parseable FROM row_words rw LEFT JOIN words w ON w.id=rw.word_id WHERE rw.row_id=? ORDER BY rw.token_index').all(parsed.id);
      const matches = catalog.db.prepare('SELECT m.*,t.core,t.kind FROM matches m JOIN targets t ON t.id=m.target_id WHERE m.row_id=? ORDER BY m.token_index,t.core').all(parsed.id);
      return c.json({ words, matches });
    } catch (e) { return c.json({ error: e instanceof Error ? e.message : 'Parsing unavailable' }, 409); }
  });
  return app;
}

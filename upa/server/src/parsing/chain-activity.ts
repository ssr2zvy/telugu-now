import type Database from 'better-sqlite3';
import type { ParsingDiagnostics, SearchAttempt, ChainSearch } from '../../../shared/parsing-diagnostics';
export function chainActivity(store:Database.Database,profile:string) {
  const upcoming=store.prepare(`SELECT o.id AS observationId,a.target_id AS targetId,
    json_extract(q.selection_snapshot_json,'$.cycleId') AS cycleId,json_extract(q.selection_snapshot_json,'$.word') AS word,
    o.status,o.preparation_error AS error FROM queue_items qi JOIN observations o ON o.id=qi.observation_id
    JOIN observation_acquisitions q ON q.observation_id=o.id JOIN selection_attempts a ON a.observation_id=o.id
    WHERE qi.profile_code=? ORDER BY qi.queue_position`).all(profile) as NonNullable<ParsingDiagnostics['upcoming']>;
  const activeSearch=store.prepare(`SELECT s.id,s.cycle_id AS cycleId,s.target_id AS targetId,s.started_at AS startedAt,s.checked
    FROM live_searches s JOIN live_cycles c ON c.id=s.cycle_id WHERE c.profile_code=? AND s.ended_at IS NULL
    ORDER BY s.started_at DESC LIMIT 1`).get(profile) as NonNullable<ParsingDiagnostics['activeSearch']>|undefined;
  const searchTotals=store.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(checked),0) AS checked,
    COALESCE(SUM(outcome IN('new-parse','cached-parse')),0) AS matched,
    COALESCE(SUM(outcome='exhausted'),0) AS exhausted,
    COALESCE(SUM(outcome IN('process-restarted','worker-error','manual-retry')),0) AS interrupted
    FROM live_searches s JOIN live_cycles c ON c.id=s.cycle_id WHERE c.profile_code=?`).get(profile) as NonNullable<ParsingDiagnostics['searchTotals']>;
  const recentCycles=(store.prepare(`SELECT id,core,started_at AS startedAt,ended_at AS endedAt,end_reason AS endReason
    FROM live_cycles WHERE profile_code=? ORDER BY started_at DESC,rowid DESC LIMIT 20`).all(profile) as Array<Omit<NonNullable<ParsingDiagnostics['recentCycles']>[number],'words'>>)
    .map(cycle=>({...cycle,words:(store.prepare(`SELECT json_extract(selection_snapshot_json,'$.word') AS word
      FROM observation_acquisitions WHERE profile_code=? AND json_extract(selection_snapshot_json,'$.cycleId')=?
      ORDER BY acquisition_number`).all(profile,cycle.id) as Array<{word:string|null}>).flatMap(row=>row.word?[row.word]:[])}));
  const attemptSql=`SELECT s.id,s.cycle_id AS cycleId,s.target_id AS targetId,c.core,s.started_at AS startedAt,s.ended_at AS endedAt,
    s.checked,s.returned,s.examined,s.parsed,s.matching,s.reused,s.outcome,s.word,s.stage,s.search_succeeded AS searchSucceeded,s.error
    FROM live_searches s JOIN live_cycles c ON c.id=s.cycle_id`;
  const readAttempts=(where:string,...args:unknown[]) => (store.prepare(attemptSql+where).all(...args) as SearchAttempt[])
    .map(attempt=>({...attempt,searchSucceeded:attempt.searchSucceeded===null?null:Boolean(attempt.searchSucceeded)}));
  const lastAttempt=readAttempts(' WHERE c.profile_code=? AND s.ended_at IS NOT NULL ORDER BY s.started_at DESC,s.rowid DESC LIMIT 1',profile)[0]??null;
  const ids=[...new Set([...upcoming.map(row=>row.cycleId),activeSearch?.cycleId].filter((id):id is string=>Boolean(id)))];
  const chainSearches:ChainSearch[]=ids.map(id=>{
    const cycle=store.prepare('SELECT id,core,ended_at AS endedAt,end_reason AS endReason FROM live_cycles WHERE id=? AND profile_code=?').get(id,profile) as Omit<ChainSearch,'searches'>;
    return {...cycle,searches:readAttempts(' WHERE c.profile_code=? AND c.id=? ORDER BY s.started_at,s.rowid',profile,id)};
  });
  const allTime=store.prepare(`SELECT COALESCE(SUM(outcome IN('new-parse','cached-parse')),0) AS successfulSearches,
    COALESCE(SUM(examined),0) AS examined,COALESCE(SUM(CASE WHEN examined IS NULL THEN checked ELSE 0 END),0) AS legacyEvaluated,
    MIN(CASE WHEN examined IS NOT NULL THEN s.started_at END) AS trackedSince
    FROM live_searches s JOIN live_cycles c ON c.id=s.cycle_id WHERE c.profile_code=?`).get(profile) as NonNullable<ParsingDiagnostics['allTime']>;
  return {upcoming,activeSearch:activeSearch??null,searchTotals,recentCycles,lastAttempt,chainSearches,allTime};
}

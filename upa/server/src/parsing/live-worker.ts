import path from 'node:path';
import Database from 'better-sqlite3';
import { db } from '../db/database';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { config } from '../config/config';
import { parsingAssets } from './state';
import { logger } from '../services/logger';

export interface WordStats {
  total:number; checked:number; parsed:number; rejected:number; tokens:number;
  matches:Record<string,number>; parserVersion:string;
  patterns?:Record<string,{needles:string[];maxCodepoints:number;scope:string}>;
}
export interface WordRow {source_id:string;source_key:string;text:string;audio_key:string;word:string;matched_targets:string[];observation_selection:{policy:string;poolSize:number|null;length:number;lengthMetric:string};occurrence:Record<string,unknown>}
export interface SearchProgress {stage:'searching'|'parsing'|'selecting';checked:number;returned:number;examined:number;parsed:number;matching:number;reused:number}
export interface FindResult extends Omit<SearchProgress,'stage'> {row:WordRow|null;pending:boolean;source:string;checked:number;matchedWords:number;
  pattern:{needles:string[];maxCodepoints:number;scope:string};stats:WordStats}
let child:ChildProcessWithoutNullStreams|undefined;
let ready:Promise<void>|undefined;
let cancelWorker:((error:Error)=>void)|undefined;
let seq=0;
const pending=new Map<number,{resolve:(r:FindResult)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;onProgress?:(progress:SearchProgress)=>void}>();
db.exec('CREATE TABLE IF NOT EXISTS live_word_cache(id INTEGER PRIMARY KEY CHECK(id=1),stats_json TEXT NOT NULL)');
export let wordStats:WordStats|null=null;
let cacheReadAttempted=false;
export function savedWordStats():WordStats|null {
  const row=db.prepare('SELECT stats_json FROM live_word_cache WHERE id=1').get() as {stats_json:string}|undefined;
  if(wordStats)return wordStats;
  if(row)return JSON.parse(row.stats_json);
  if(cacheReadAttempted)return null;
  cacheReadAttempted=true;
  let frequency:Database.Database|undefined;
  try {
    // A full ready queue need not start the parser merely to display saved totals.
    frequency=new Database(config.frequencyDatabasePath,{readonly:true,fileMustExist:true});
    const totals=frequency.prepare(`SELECT COUNT(*) AS total,COUNT(parse_result) AS checked,
      COALESCE(SUM(json_extract(parse_result,'$.status')='parsed'),0) AS parsed FROM frequencies`).get() as {total:number;checked:number;parsed:number};
    const matches=Object.fromEntries((frequency.prepare(`SELECT j.value AS target,COUNT(*) AS n FROM frequencies f,json_each(f.parse_result,'$.targets') j GROUP BY j.value`).all() as Array<{target:string;n:number}>).map(row=>[row.target,row.n]));
    const meta=frequency.prepare('SELECT total_occurrences,parse_cache_version FROM metadata').get() as {total_occurrences:number;parse_cache_version:string};
    const stats={...totals,rejected:totals.checked-totals.parsed,tokens:meta.total_occurrences,parserVersion:meta.parse_cache_version,matches};
    saveStats(stats);return stats;
  }catch{return null;}finally{frequency?.close();}
}
function saveStats(stats:WordStats) {
  wordStats={...wordStats,...stats};
  db.prepare('INSERT INTO live_word_cache VALUES(1,?) ON CONFLICT(id) DO UPDATE SET stats_json=excluded.stats_json').run(JSON.stringify({...wordStats,patterns:undefined}));
}
export let workerError:string|null=null;
export let workerPhase='idle';
const timeout = (name:string,fallback:number) => {const value=Number(process.env[name]);return Number.isFinite(value)&&value>0?value:fallback;};
export function ensureWordWorker():Promise<void> {
  if(ready)return ready;
  workerPhase='loading-parser';workerError=null;wordStats=null;
  ready=new Promise<void>((resolve,reject)=>{
    const process=spawn(globalThis.process.env.GRAMMAR_PYTHON??'python3',[path.join(parsingAssets,'live.py'),
      '--frequency',config.frequencyDatabasePath,'--corpus',config.corpusDatabasePath,
      '--availability',config.corpusAvailabilityPath,'--validation',config.audioValidationPath]);
    child=process;
    let stderr='',finished=false;
    const startup=setTimeout(()=>fail(new Error('Parser startup timed out. Selection will retry.')),timeout('GRAMMAR_STARTUP_TIMEOUT_MS',600000));
    startup.unref();
    const fail=(error:Error)=>{
      if(finished)return;finished=true;clearTimeout(startup);
      workerError=error.message;workerPhase='failed';reject(error);
      for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();
      if(child===process){child=undefined;ready=undefined;cancelWorker=undefined;}
      process.kill('SIGKILL');
      logger.error('live_parser_failed',{error:error.message});
    };
    cancelWorker=fail;
    process.stderr.on('data',(buffer:Buffer)=>{stderr=(stderr+buffer.toString()).slice(-4000);});
    process.stdin.on('error',error=>fail(error));
    process.on('error',fail);
    process.on('close',code=>fail(new Error(`Live parser stopped (${code}): ${stderr}`)));
    createInterface({input:process.stdout}).on('line',line=>{
      if(finished)return;
      try {
        const message=JSON.parse(line);
        if(message.ready){clearTimeout(startup);saveStats(message.stats);workerPhase='ready';resolve();return;}
        const request=pending.get(message.id);if(!request)return;
        if(message.progress){request.onProgress?.(message.progress);return;}
        pending.delete(message.id);clearTimeout(request.timer);
        if(message.error)request.reject(new Error(message.error));
        else {if(message.result.stats)saveStats(message.result.stats);request.resolve(message.result);}
      }catch(error){fail(error instanceof Error?error:new Error(String(error)));}
    });
  });
  return ready;
}
export async function findWord(request:Record<string,unknown>,onProgress?:(progress:SearchProgress)=>void):Promise<FindResult>{
  await ensureWordWorker();
  const process=child;
  if(!process)throw new Error('Parser restarted; search will retry.');
  const id=++seq;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>cancelWorker?.(new Error('Parser search timed out. Selection will retry.')),timeout('GRAMMAR_SEARCH_TIMEOUT_MS',120000));
    timer.unref();pending.set(id,{resolve,reject,timer,...(onProgress?{onProgress}:{})});
    process.stdin.write(JSON.stringify({...request,id,action:'find'})+'\n',error=>{
      if(error)cancelWorker?.(error);
    });
  });
}
export function stopWordWorker(){cancelWorker?.(new Error('Parser restarted.'));}

import path from 'node:path';
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
export interface FindResult {row:WordRow|null;pending:boolean;source:string;checked:number;matchedWords:number;
  pattern:{needles:string[];maxCodepoints:number;scope:string};stats:WordStats}
let child:ChildProcessWithoutNullStreams|undefined;
let ready:Promise<void>|undefined;
let seq=0;
let stopping=false;
const pending=new Map<number,{resolve:(r:any)=>void;reject:(e:Error)=>void}>();
export let wordStats:WordStats|null=null;
export let workerError:string|null=null;
export let workerPhase='idle';
export function ensureWordWorker():Promise<void> {
  if(ready)return ready;
  workerPhase='loading-parser';workerError=null;stopping=false;
  ready=new Promise<void>((resolve,reject)=>{
    child=spawn(process.env.GRAMMAR_PYTHON??'python3',[path.join(parsingAssets,'live.py'),
      '--frequency',config.frequencyDatabasePath,'--corpus',config.corpusDatabasePath,
      '--availability',config.corpusAvailabilityPath,'--validation',config.audioValidationPath]);
    let stderr='';
    child.stderr.on('data',(b:Buffer)=>{stderr=(stderr+b.toString()).slice(-4000);});
    const fail=(error:Error)=>{workerError=error.message;workerPhase='failed';reject(error);
      for(const p of pending.values())p.reject(error);pending.clear();};
    child.on('error',fail);
    child.on('close',code=>{if(stopping){child=undefined;ready=undefined;return;}fail(new Error(`Live parser stopped (${code}): ${stderr}`));
      logger.error('live_parser_failed',{error:workerError});child=undefined;ready=undefined;});
    createInterface({input:child.stdout}).on('line',line=>{
      try {const message=JSON.parse(line);
        if(message.ready){wordStats=message.stats;workerPhase='ready';resolve();return;}
        const p=pending.get(message.id);if(!p)return;pending.delete(message.id);
        if(message.error)p.reject(new Error(message.error));else{
          if(message.result.stats)wordStats={...wordStats,...message.result.stats};
          p.resolve(message.result);
        }
      }catch(error){fail(error instanceof Error?error:new Error(String(error)));}
    });
  });
  return ready;
}
export async function findWord(request:Record<string,unknown>):Promise<FindResult>{
  await ensureWordWorker();
  const id=++seq;
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject});
    child!.stdin.write(JSON.stringify({...request,id,action:'find'})+'\n',error=>{
      if(error){pending.delete(id);reject(error);}
    });
  });
}
export function stopWordWorker(){stopping=true;child?.kill();}

// Legacy build entrypoints are disabled: the queue owns the on-demand worker.
import {workerPhase,workerError,wordStats} from './live-worker';
export interface ParseJob {phase?:string;id?:string;file?:string;error?:string;processed?:number;total?:number;tokens?:number;uniqueWords?:number;[key:string]:unknown}
export const job=():ParseJob=>({phase:workerPhase,error:workerError??'',processed:wordStats?.checked??0,total:wordStats?.total??0});
export const recoverWorker=()=>false;
export function startParsing():void{throw new Error('Full-corpus builds are disabled. Live parsing starts automatically.');}

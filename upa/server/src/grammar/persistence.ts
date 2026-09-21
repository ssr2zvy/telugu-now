/** Permanent startup recovery for an already activated grammar catalog. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {GetObjectCommand} from '@aws-sdk/client-s3';
import {config} from '../config/config';
import {db} from '../db/database';
import {getCorpusObjectStore,objectBodyStream} from '../services/corpus-object-store';
import {grammarDirectory,GrammarCatalog} from './store';
import {system} from './service';
export const corpusStamp=()=>{const s=fs.statSync(config.corpusDatabasePath);return JSON.stringify([s.size,s.mtimeMs]);};
export async function hashFile(file:string){const h=createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
export function processIdentity(pid:number){try{return fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1]?.split(' ')[19]??null;}catch{return null;}}
export async function bootstrapGrammar(){
 const s=system();fs.mkdirSync(grammarDirectory,{recursive:true});
 // A completed process cannot retain its lock; an active process must never be stolen from.
 const lock=path.join(grammarDirectory,'worker.lock');if(fs.existsSync(lock)){
  try{const owner=JSON.parse(fs.readFileSync(lock,'utf8')) as {pid:number;started:string};if(!owner.started||processIdentity(owner.pid)!==owner.started)fs.rmSync(lock);}catch{fs.rmSync(lock,{force:true});}
 }
 const state=JSON.parse(s.job_json) as {phase?:string};
 if(!fs.existsSync(lock) && state.phase && !['ready','failed'].includes(state.phase))db.prepare('UPDATE grammar_system SET job_json=? WHERE id=1').run(JSON.stringify({...JSON.parse(s.job_json),phase:'failed',error:'Build interrupted. Resume from the migration page.'}));
 if(!s.active)return;
 if(!s.catalog_path||!s.catalog_sha)throw new Error('Active grammar metadata missing');
 if(!fs.existsSync(s.catalog_path)){
  if(config.corpusBackend!=='tigris')throw new Error('Active grammar database missing');
  const {client,bucket}=getCorpusObjectStore();const staged=s.catalog_path+'.download';
  const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:`corpus/grammar/${s.catalog_sha}.sqlite`}));
  try{await pipeline(objectBodyStream(response.Body),fs.createWriteStream(staged));if(await hashFile(staged)!==s.catalog_sha)throw new Error('Grammar download checksum mismatch');fs.renameSync(staged,s.catalog_path);}finally{fs.rmSync(staged,{force:true});}
 }
 const check=new GrammarCatalog(s.catalog_path);
 try{
  if(await hashFile(s.catalog_path)!==s.catalog_sha)throw new Error('Active grammar checksum mismatch');
  if(corpusStamp()!==s.corpus_stamp){if(await hashFile(config.corpusDatabasePath)!==check.identity.corpus_sha256)throw new Error('Active grammar belongs to another corpus');db.prepare('UPDATE grammar_system SET corpus_stamp=? WHERE id=1').run(corpusStamp());}
 }finally{check.close();}
}

import {corpusStamp,hashFile,processIdentity} from './persistence';
/** Optional one-deployment worker host. Permanent selection code does not depend on launching it. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand,PutObjectCommand,CreateMultipartUploadCommand,UploadPartCommand,CompleteMultipartUploadCommand,AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { config } from '../config/config';
import { db } from '../db/database';
import { getCorpusObjectStore,objectBodyStream } from '../services/corpus-object-store';
import { grammarDirectory,GrammarCatalog } from './store';
import { system } from './service';
export const workerEnabled=()=>process.env.GRAMMAR_MIGRATION_ENABLED==='true';
export type Job={phase?:string;file?:string;id?:string;processed?:number;total?:number;error?:string;sha?:string;inventoryId?:string;[key:string]:unknown};
let running=false;
export function job():Job {return JSON.parse(system().job_json);}
function save(data:Job){db.prepare('UPDATE grammar_system SET job_json=? WHERE id=1').run(JSON.stringify({...job(),...data,updatedAt:Date.now()}));}
async function publish(file:string,key:string){
 const {client,bucket}=getCorpusObjectStore();const total=fs.statSync(file).size;
 const created=await client.send(new CreateMultipartUploadCommand({Bucket:bucket,Key:key,ContentType:'application/vnd.sqlite3'}));const UploadId=created.UploadId;if(!UploadId)throw new Error('Upload ID missing');
 const parts:{ETag:string;PartNumber:number}[]=[];let sent=0;
 const handle=await fs.promises.open(file,'r');
 try{
  for(let number=1;sent<total;number++){
   const bytes=Buffer.alloc(Math.min(16*1024*1024,total-sent));let n=0;
   while(n<bytes.length){const read=await handle.read(bytes,n,bytes.length-n,sent+n);if(!read.bytesRead)throw new Error('Short upload read');n+=read.bytesRead;}
   const r=await client.send(new UploadPartCommand({Bucket:bucket,Key:key,UploadId,PartNumber:number,Body:bytes}));if(!r.ETag)throw new Error('Upload ETag missing');parts.push({ETag:r.ETag,PartNumber:number});sent+=n;save({phase:'uploading',uploadedBytes:sent,totalBytes:total});
  }
  await client.send(new CompleteMultipartUploadCommand({Bucket:bucket,Key:key,UploadId,MultipartUpload:{Parts:parts}}));
 }catch(e){await client.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:key,UploadId})).catch(()=>{});throw e;}finally{await handle.close();}
}
export async function startMigration(){
 if(!workerEnabled())throw new Error('Migration worker is disabled');
 if(running)throw new Error('Grammar build already running');if(system().active)throw new Error('Grammar is already active');
 fs.mkdirSync(grammarDirectory,{recursive:true});
 const lock=path.join(grammarDirectory,'worker.lock');let lockfd:number;
 try{lockfd=fs.openSync(lock,'wx');}catch{throw new Error('A grammar worker owns this volume. Check worker.lock after an interrupted host.');}
 fs.writeFileSync(lockfd,JSON.stringify({pid:process.pid,started:processIdentity(process.pid)}));fs.closeSync(lockfd);running=true;
 const old=job(),incompatible=old.error?.includes('different corpus/parser'),id=(!incompatible&&old.id)||randomUUID(),file=(!incompatible&&old.file)||path.join(grammarDirectory,`${id}.building.sqlite`);
 save({id,file,phase:'starting',error:''});
 void (async()=>{
  try{
   const dev=path.resolve('../data-transform/scripts/build-grammar/build_grammar.py');
   const script=fs.existsSync(dev)?dev:path.resolve('dist/server/grammar-worker/build_grammar.py');
   const child=spawn(process.env.GRAMMAR_PYTHON??'python3',[script,'--corpus',config.corpusDatabasePath,'--output',file,'--availability',config.corpusAvailabilityPath],{stdio:['ignore','pipe','pipe']});
   let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-2000);});
   const lines=createInterface({input:child.stdout});lines.on('line',line=>{try{save(JSON.parse(line));}catch{ /* Non-JSON diagnostics do not change state. */ }});
   await new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`Grammar calculation failed (${code}): ${stderr}`)));});
   const check=new GrammarCatalog(file);const identity=check.identity;check.close();
   const sha=await hashFile(file),key=`corpus/grammar/${sha}.sqlite`;
   if(config.corpusBackend==='tigris'){
    await publish(file,key);
    const {client,bucket}=getCorpusObjectStore();await client.send(new PutObjectCommand({Bucket:bucket,Key:'corpus/grammar/latest.json',ContentType:'application/json',Body:JSON.stringify({key,sha,identity})}));
   }
   const final=path.join(grammarDirectory,`${sha}.sqlite`);await fs.promises.rename(file,final);
   save({phase:'ready',file:final,sha,inventoryId:identity.inventory_id!,corpusSha:identity.corpus_sha256,corpusStamp:corpusStamp(),published:config.corpusBackend==='tigris'});
  }catch(e){save({phase:'failed',error:e instanceof Error?e.message:'Grammar build failed'});}
  finally{running=false;fs.rmSync(lock,{force:true});}
 })();
}
export async function validateActivation(){
 const j=job();if(j.phase!=='ready'||!j.file||!j.sha)throw new Error('Build is not ready');
 if(corpusStamp()!==j.corpusStamp)throw new Error('Corpus changed; rebuild required');
 if(await hashFile(j.file)!==j.sha)throw new Error('Grammar checksum mismatch');
 const catalog=new GrammarCatalog(j.file);catalog.close();return j;
}

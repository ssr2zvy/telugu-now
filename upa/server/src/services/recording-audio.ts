import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const MAX_INPUT = 16 * 1024 * 1024;
const RATE = 24000;
const MAX_PCM = RATE * 2 * 120;
let active = 0;

// Browser recorder containers are not reliably accepted by every Web Audio
// decoder. Store a bounded, mono PCM WAV with exact RIFF sizes instead.
export async function normalizeQuestionRecording(input: Uint8Array, mimeType: string): Promise<Buffer> {
  const mime = mimeType.split(';')[0]!.trim().toLowerCase();
  const format = ({'audio/mp4':'mov','audio/x-m4a':'mov','audio/webm':'matroska','audio/ogg':'ogg',
    'audio/wav':'wav','audio/x-wav':'wav','audio/wave':'wav'} as Record<string,string>)[mime];
  if (!format || !input.byteLength || input.byteLength > MAX_INPUT) throw new Error('Unsupported or empty recording.');
  if (active >= 2) throw new Error('Recording processing is busy. Try saving again.');
  active++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'telugu-recording-'));
    const inputPath = join(directory, 'input.recording');
    await writeFile(inputPath, input, { mode: 0o600 });
    const pcm = await new Promise<Buffer>((resolve,reject)=>{
      const child=spawn('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-xerror',
        '-protocol_whitelist','file,pipe','-threads','1','-f',format,'-i',inputPath,
        '-map','0:a:0','-vn','-sn','-dn','-map_metadata','-1','-filter_threads','1','-threads','1',
        '-ac','1','-ar',String(RATE),'-t','121','-c:a','pcm_s16le','-f','s16le','pipe:1'],{shell:false});
      const chunks:Buffer[]=[];let size=0,settled=false;
      const finish=(error?:Error)=>{
        if(settled)return;settled=true;clearTimeout(timer);
        if(error){child.kill('SIGKILL');reject(error);}else resolve(Buffer.concat(chunks,size));
      };
      const timer=setTimeout(()=>finish(new Error('Recording processing timed out.')),20000);
      child.on('error',()=>finish(new Error('Recording decoder is unavailable.')));
      child.stdout.on('data',(chunk:Buffer)=>{
        if(settled)return;size+=chunk.length;
        if(size>MAX_PCM){finish(new Error('Recordings must be no longer than two minutes.'));return;}
        chunks.push(chunk);
      });
      child.stderr.resume();
      child.stdin.on('error',()=>{/* Decoder exit below reports malformed input. */});
      child.on('close',code=>finish(code!==0||size===0||size%2!==0?new Error('Recording could not be decoded. Please record again.'):undefined));
      child.stdin.end();
    });
    const wav=Buffer.alloc(44+pcm.length);
    wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
    wav.writeUInt32LE(RATE,24);wav.writeUInt32LE(RATE*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
    wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
    return wav;
  } finally {
    active--;
    if (directory) await rm(directory, {recursive:true,force:true});
  }
}

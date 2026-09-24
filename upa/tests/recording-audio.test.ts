import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeQuestionRecording} from '../server/src/services/recording-audio';
import {wavFixture} from './helpers/audio-fixture';

function recorded(format:'mp4'|'webm') {
  const args=format==='mp4'?['-c:a','aac','-movflags','frag_keyframe+empty_moov','-f','mp4']:['-c:a','libopus','-f','webm'];
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','wav','-i','pipe:0',...args,'pipe:1'],{input:wavFixture(.2)});
  assert.equal(result.status,0,result.stderr?.toString());return result.stdout;
}
for(const format of ['mp4','webm'] as const)test(`${format} microphone recording becomes a complete browser-decodable PCM WAV`,async()=>{
  const wav=await normalizeQuestionRecording(recorded(format),format==='mp4'?'audio/mp4;codecs=mp4a.40.2':'audio/webm;codecs=opus');
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(4),wav.length-8);
  assert.equal(wav.toString('ascii',8,12),'WAVE');assert.equal(wav.readUInt16LE(20),1);assert.equal(wav.readUInt16LE(22),1);
  assert.equal(wav.readUInt32LE(24),24000);assert.equal(wav.readUInt32LE(40),wav.length-44);
  const decode=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','wav','-i','pipe:0','-f','null','-'],{input:wav});
  assert.equal(decode.status,0,decode.stderr?.toString());assert.ok(wav.length>9000&&wav.length<18000);
});
test('WAV remains valid and malformed, empty, oversized and overlong recordings are rejected',async()=>{
  const wav=await normalizeQuestionRecording(wavFixture(),'audio/wav');assert.equal(wav.readUInt32LE(24),24000);
  await assert.rejects(normalizeQuestionRecording(new Uint8Array([1,2,3]),'audio/mp4'),/could not be decoded/);
  await assert.rejects(normalizeQuestionRecording(new Uint8Array(),'audio/webm'),/empty/);
  await assert.rejects(normalizeQuestionRecording(wavFixture(),'text/plain'),/Unsupported/);
  await assert.rejects(normalizeQuestionRecording(new Uint8Array(16*1024*1024+1),'audio/wav'),/Unsupported/);
  await assert.rejects(normalizeQuestionRecording(wavFixture(121),'audio/wav'),/two minutes/);
});

test('finalized MP4 with trailing metadata decodes through seekable input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recording-regression-'));
  try {
    const path = join(directory, 'finalized.mp4');
    const encoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'anoisesrc=d=8', '-c:a', 'aac', path]);
    assert.equal(encoded.status, 0, encoded.stderr?.toString());
    const raw = await readFile(path);
    assert.ok(raw.indexOf(Buffer.from('moov')) > raw.indexOf(Buffer.from('mdat')));
    const wav = await normalizeQuestionRecording(raw, 'audio/mp4');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(4), wav.length - 8);
    const seconds = (wav.length - 44) / (24000 * 2);
    assert.ok(seconds >= 8 && seconds < 8.1, `Full recording retained: ${seconds}s`);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

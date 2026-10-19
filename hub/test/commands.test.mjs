import test from 'node:test';
import assert from 'node:assert/strict';
import { match } from '../server/commands.mjs';
import { trackKey } from '../server/carpack.mjs';

test('spoken commands: English and Vietnamese, with minutes', () => {
  assert.deepEqual(match('Next song.'), { act: 'next' });
  assert.deepEqual(match('Bài tiếp theo'), { act: 'next' });
  assert.deepEqual(match('Tạm dừng nhạc'), { act: 'pause' });
  assert.deepEqual(match('Tăng âm lượng'), { act: 'volup' });
  assert.deepEqual(match('Hẹn giờ 10 phút'), { act: 'timer', minutes: 10 });
  assert.deepEqual(match('set a timer for twenty minutes'), { act: 'timer', minutes: 20 });
  assert.deepEqual(match('hẹn giờ hai tiếng'), { act: 'timer', minutes: 120 });
  assert.deepEqual(match('hẹn giờ một tiếng'), { act: 'timer', minutes: 60 });
  assert.deepEqual(match('bắt đầu tập trung 25 phút'), { act: 'focus', minutes: 25 });
});

test('spoken commands: questions and empty clips go on to Mei', () => {
  assert.equal(match('What is the next event on my calendar today?'), null);
  assert.equal(match('Thời tiết hôm nay thế nào'), null);
  assert.equal(match(''), null);
  assert.equal(match('hẹn giờ'), null); // a timer needs a length
});

test('car pack: the same song from any app has one key', () => {
  assert.equal(trackKey('  Shape  of You ', 'Ed Sheeran'), trackKey('shape of you', 'ED SHEERAN'));
  assert.notEqual(trackKey('Song', 'A'), trackKey('Song', 'B'));
});

test('clip preparation: finds the speech and cuts it out for whisper', async () => {
  const { toSpeechWav } = await import('../server/assistant.mjs');
  // 3 s like the Car Thing records (16 kHz, 4 channels, 32-bit): quiet, 1 s of a loud tone, quiet
  const rate = 16000, frames = rate * 3;
  const data = Buffer.alloc(frames * 16);
  for (let i = 0; i < frames; i++) {
    const loud = i >= rate && i < rate * 2;
    const v = (loud ? Math.sin(i / 5) * 2e8 : (Math.random() - 0.5) * 2e5) | 0;
    for (let ch = 0; ch < 4; ch++) data.writeInt32LE(v, i * 16 + ch * 4);
  }
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(4, 22);
  hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 16, 28); hdr.writeUInt16LE(16, 32); hdr.writeUInt16LE(32, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  const clip = toSpeechWav(Buffer.concat([hdr, data]));
  assert.ok(clip.speech);
  assert.ok(clip.span > 0.9 && clip.span < 1.2, `span ${clip.span}`);
  const seconds = (clip.speechWav.length - 44) / 32000;
  assert.ok(seconds > 1.4 && seconds < 1.8, `cut ${seconds}`); // the speech and 0.3 s on either side
});

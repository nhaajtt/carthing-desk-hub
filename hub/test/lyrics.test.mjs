import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc } from '../server/lyrics.mjs';

test('timed lyrics: lines in time order, repeated stamps, no stamp skipped', () => {
  const lines = parseLrc('[ar: someone]\n[00:12.50]second\n[00:03.00]first\nno stamp\n[01:00.00][02:00.00]chorus\n[02:30.10]');
  assert.deepEqual(lines.map((l) => [l.t, l.text]), [[3, 'first'], [12.5, 'second'], [60, 'chorus'], [120, 'chorus'], [150.1, '']]);
});

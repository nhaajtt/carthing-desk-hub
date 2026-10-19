// What the Car Thing takes into the car, where there is no hub and no internet: the covers and lyrics of the
// songs the iPhone played at the desk, the weather for the next days, the calendar and Mei's reminders.
// Written to state/carpack/; tools/sync-carpack.sh copies it to the Car Thing every few minutes, and
// phonelink serves it to the car copy of the page. Nothing here leaves server 2 except over the USB cable.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_TRACKS = 300;
const DAY = 86400000;

// the same song from Spotify, Apple Music or YouTube: compare without case and extra spaces
export const trackKey = (title, artist) => `${String(title || '').trim().toLowerCase().replace(/\s+/g, ' ')}\n${String(artist || '').trim().toLowerCase().replace(/\s+/g, ' ')}`;

export function createCarPack({ state, stateDir }) {
  const dir = path.join(stateDir, 'carpack');
  fs.mkdirSync(path.join(dir, 'c'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'l'), { recursive: true });
  const indexFile = path.join(dir, 'tracks.json');
  // key → { h, cover, lyrics, at }; insertion order is the order they were last played
  const tracks = new Map();
  try { for (const [k, v] of JSON.parse(fs.readFileSync(indexFile, 'utf8'))) tracks.set(k, v); } catch {}
  let weather = null; // the whole forecast, so the car can pick the hour it is in
  let dirty = true, sig = '';

  const hash = (k) => crypto.createHash('sha1').update(k).digest('hex').slice(0, 16);
  const remove = (h) => { for (const f of [`c/${h}.jpg`, `l/${h}.json`]) fs.rm(path.join(dir, f), { force: true }, () => {}); };

  function touch(title, artist) {
    const k = trackKey(title, artist);
    if (!k.trim()) return null;
    const t = tracks.get(k) || { h: hash(k), cover: false, lyrics: false };
    tracks.delete(k);
    t.at = Date.now();
    tracks.set(k, t);
    while (tracks.size > MAX_TRACKS) {
      const [oldK, old] = tracks.entries().next().value;
      tracks.delete(oldK);
      remove(old.h);
    }
    dirty = true;
    return t;
  }

  function write(file, data) {
    const p = path.join(dir, file);
    fs.writeFileSync(p + '.tmp', data);
    fs.renameSync(p + '.tmp', p);
  }

  return {
    // a cover the hub found for the iPhone's song (JPEG only: that is what Apple and YouTube send)
    cover(title, artist, img) {
      if (!/jpeg/.test(img.type || '')) return;
      const t = touch(title, artist);
      if (!t || t.cover) return;
      try { write(`c/${t.h}.jpg`, img.buf); t.cover = true; } catch (e) { console.error('[carpack]', e.message); }
    },
    lyrics(title, artist, l) {
      const t = touch(title, artist);
      if (!t || !l || !l.lines || !l.lines.length) return;
      let old = {};
      try { old = JSON.parse(fs.readFileSync(path.join(dir, `l/${t.h}.json`), 'utf8')); } catch {}
      try { write(`l/${t.h}.json`, JSON.stringify({ ...old, synced: l.synced, lines: l.lines })); t.lyrics = true; } catch (e) { console.error('[carpack]', e.message); }
    },
    // the Vietnamese lines go into the same file, next to the lyrics
    vi(title, artist, vi) {
      const t = tracks.get(trackKey(title, artist));
      if (!t || !t.lyrics || !Array.isArray(vi)) return;
      try {
        const l = JSON.parse(fs.readFileSync(path.join(dir, `l/${t.h}.json`), 'utf8'));
        write(`l/${t.h}.json`, JSON.stringify({ ...l, vi }));
        dirty = true;
      } catch {}
    },
    forecast(w) { weather = w; dirty = true; },

    // pack.json: everything small, in one file. Written at most once a minute, and only when something in it changed.
    save() {
      const now = Date.now();
      const s = `${state.calendar && state.calendar.at}|${JSON.stringify(state.reminders || [])}|${state.display.lang}`;
      if (!dirty && s === sig) return;
      dirty = false;
      sig = s;
      const cal = state.calendar && state.calendar.configured
        ? { configured: true, at: state.calendar.at, events: (state.calendar.events || []).filter((e) => e.end > now - DAY && e.start < now + 8 * DAY) }
        : { configured: false, events: [] };
      const pack = {
        at: now,
        city: state.city, units: state.units, tz: state.tz, lang: state.display.lang,
        weather,
        calendar: cal,
        reminders: state.reminders || [],
        tracks: Object.fromEntries([...tracks].filter(([, t]) => t.cover || t.lyrics).map(([k, t]) => [k, [t.h, t.cover ? 1 : 0, t.lyrics ? 1 : 0]])),
      };
      try {
        write('pack.json', JSON.stringify(pack));
        write('tracks.json', JSON.stringify([...tracks]));
      } catch (e) { console.error('[carpack]', e.message); }
    },
  };
}

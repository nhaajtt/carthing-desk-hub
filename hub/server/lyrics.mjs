// Song lyrics from LRCLIB (lrclib.net: free, open, no key), timed line by line when it has them.
// Only the title, artist, album and length of what is playing are sent.

const UA = 'carthing-desk-hub (https://github.com/nhaajtt/carthing-desk-hub)';
const cache = new Map(); // "title\nartist\nduration" → { synced, lines } or null
const keep = (k, v) => { cache.set(k, v); if (cache.size > 200) cache.delete(cache.keys().next().value); return v; };

// "[01:02.35] words" → { t: 62.35, text: 'words' }; lines without a time stamp are skipped
export function parseLrc(lrc) {
  const out = [];
  for (const raw of String(lrc).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

function pick(hit) {
  if (!hit || hit.instrumental) return null;
  if (hit.syncedLyrics) return { synced: true, lines: parseLrc(hit.syncedLyrics) };
  if (hit.plainLyrics) return { synced: false, lines: hit.plainLyrics.split(/\r?\n/).map((text) => ({ t: null, text: text.trim() })) };
  return null;
}

async function get(path) {
  const r = await fetch(`https://lrclib.net/api/${path}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`lrclib ${r.status}`);
  return r.json();
}

export async function lyrics(title, artist, album, duration) {
  title = String(title || '').slice(0, 200);
  artist = String(artist || '').slice(0, 200);
  album = String(album || '').slice(0, 200);
  const d = Math.round(Number(duration) || 0);
  if (!title) return null;
  const key = `${title}\n${artist}\n${d}`;
  if (cache.has(key)) return cache.get(key);
  // the exact match first (LRCLIB allows ±2 s on the length); then the closest search result
  const q = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) q.set('album_name', album);
  if (d) q.set('duration', String(d));
  let found = artist && d ? pick(await get(`get?${q}`)) : null;
  if (!found) {
    const hits = (await get(`search?${new URLSearchParams({ q: `${title} ${artist}`.trim() })}`)) || [];
    const near = hits.filter((h) => !d || Math.abs((h.duration || 0) - d) <= 3);
    found = pick(near.find((h) => h.syncedLyrics) || near[0]);
  }
  return keep(key, found);
}

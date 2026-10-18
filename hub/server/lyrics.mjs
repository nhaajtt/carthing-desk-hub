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

// A Vietnamese line under each line of a foreign song, for immersive Music. One Gemini Flash-Lite request per
// song (free tier), cached; only the lyrics themselves are sent.
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_SUMMARY_MODEL || 'gemini-flash-lite-latest';
const translated = new Map();

export async function translateLyrics(title, artist, album, duration) {
  const l = await lyrics(title, artist, album, duration);
  if (!l || !KEY) return null;
  const key = `${title}\n${artist}\n${Math.round(Number(duration) || 0)}`;
  if (translated.has(key)) return translated.get(key);
  const texts = l.lines.map((x) => x.text);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `Translate these song lyric lines into natural, singable Vietnamese. Answer with a JSON array of exactly ${texts.length} strings, one per line and in the same order; an empty line stays an empty string.\n\n${JSON.stringify(texts)}` }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4000 },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const j = await r.json();
  let out = null;
  try { out = JSON.parse((j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')); } catch {}
  if (!Array.isArray(out) || out.length !== texts.length) return null; // misaligned: better none than wrong lines
  out = out.map((s) => String(s || '').slice(0, 200));
  translated.set(key, out);
  if (translated.size > 100) translated.delete(translated.keys().next().value);
  return out;
}

// Pictures for what the iPhone plays (Music page). Over Bluetooth the phone sends only the title and the artist
// or channel, no picture, so the hub looks one up: a YouTube video's thumbnail from YouTube's public search
// page, anything else from Apple's public iTunes search. No key, no account, nothing logged. The title and
// artist are the only things that leave the hub.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0 Safari/537.36';
const found = new Map(); // "app\ntitle\nartist" → picture URL, or '' when nothing matched
const images = new Map(); // picture URL → { type, buf }
const keep = (m, k, v, max) => { m.set(k, v); if (m.size > max) m.delete(m.keys().next().value); return v; };

async function youtube(title, channel) {
  const q = new URLSearchParams({ search_query: `${title} ${channel}`.trim(), hl: 'en' });
  const r = await fetch(`https://www.youtube.com/results?${q}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`youtube ${r.status}`);
  const id = (await r.text()).match(/"videoId":"([\w-]{11})"/);
  return id ? `https://i.ytimg.com/vi/${id[1]}/mqdefault.jpg` : '';
}

async function itunes(title, artist) {
  const q = new URLSearchParams({ term: `${title} ${artist}`.trim(), entity: 'song', limit: '1' });
  const r = await fetch(`https://itunes.apple.com/search?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`itunes ${r.status}`);
  const hit = (await r.json()).results?.[0];
  return hit?.artworkUrl100 ? hit.artworkUrl100.replace('100x100bb', '400x400bb') : '';
}

export async function cover(app, title, artist) {
  title = String(title).slice(0, 200);
  artist = String(artist).slice(0, 200);
  if (!title) throw new Error('no title');
  const key = `${app}\n${title}\n${artist}`;
  let url = found.get(key);
  if (url === undefined) url = keep(found, key, /youtube/i.test(app) ? await youtube(title, artist) : await itunes(title, artist), 200);
  if (!url) throw new Error('not found');
  if (images.has(url)) return images.get(url);
  const host = new URL(url).hostname;
  if (host !== 'i.ytimg.com' && !host.endsWith('.mzstatic.com')) throw new Error('host not allowed');
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`picture ${r.status}`);
  return keep(images, url, { type: r.headers.get('content-type') || 'image/jpeg', buf: Buffer.from(await r.arrayBuffer()) }, 30);
}

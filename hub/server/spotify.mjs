// Spotify Web API via Authorization Code + PKCE: no client secret is stored anywhere.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify',
].join(' ');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function createSpotify({ state, changed, stateDir }) {
  const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
  const REDIRECT = process.env.SPOTIFY_REDIRECT || 'http://127.0.0.1:8888/callback';
  const TOKEN_FILE = path.join(stateDir, 'spotify.json');

  let tokens = null;
  try { tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch {}
  let pending = null; // { verifier, state, at }
  let lastTrackId = null;
  let backoffUntil = 0;

  state.spotify = { configured: !!CLIENT_ID, linked: !!(tokens && tokens.refresh_token), player: null, at: 0 };

  function saveTokens(t) {
    tokens = t;
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(t), { mode: 0o600 });
    state.spotify.linked = true;
  }

  async function tokenRequest(params) {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`token ${r.status}: ${j.error_description || j.error}`);
    return j;
  }

  async function refresh() {
    const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    saveTokens({
      access_token: j.access_token,
      refresh_token: j.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + (j.expires_in - 60) * 1000,
    });
  }

  async function api(method, p, body) {
    if (!tokens) throw new Error('not linked');
    if (Date.now() < backoffUntil) throw new Error('rate limited');
    if (!tokens.access_token || Date.now() > tokens.expires_at) await refresh();
    const call = () => fetch(`https://api.spotify.com/v1${p}`, {
      method,
      headers: { Authorization: `Bearer ${tokens.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    let r = await call();
    if (r.status === 401) { await refresh(); r = await call(); }
    if (r.status === 429) {
      backoffUntil = Date.now() + Number(r.headers.get('retry-after') || 10) * 1000;
      throw new Error('rate limited');
    }
    if (r.status === 204 || r.status === 202) return null;
    const text = await r.text();
    // player commands can answer 200 with a body that is not JSON; that is still a success
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) {
      const msg = j?.error?.message || text.slice(0, 80);
      console.error(`[spotify] ${method} ${p} ${r.status}: ${msg}`);
      throw new Error(r.status === 404 ? 'No Spotify device is active — start playing on a phone or computer' : msg);
    }
    return j;
  }

  async function poll() {
    if (!tokens) return;
    try {
      const p = await api('GET', '/me/player?additional_types=episode');
      if (!p || !p.item) {
        state.spotify.player = null;
      } else {
        const it = p.item;
        const imgs = it.album?.images || it.images || [];
        const art = (imgs.find((i) => i.width && i.width <= 320) || imgs[imgs.length - 1] || imgs[0] || {}).url || null;
        if (it.id !== lastTrackId && it.type === 'track') {
          lastTrackId = it.id;
          try {
            const [liked] = await api('GET', `/me/tracks/contains?ids=${it.id}`);
            state.spotify.liked = !!liked;
          } catch { state.spotify.liked = null; }
        }
        state.spotify.player = {
          id: it.id,
          type: it.type,
          title: it.name,
          artist: (it.artists || []).map((a) => a.name).join(', ') || it.show?.name || '',
          album: it.album?.name || it.show?.name || '',
          art,
          isPlaying: p.is_playing,
          progress: p.progress_ms,
          duration: it.duration_ms,
          device: p.device ? { name: p.device.name, type: p.device.type, volume: p.device.volume_percent, canVolume: p.device.supports_volume } : null,
          shuffle: p.shuffle_state,
          repeat: p.repeat_state,
        };
      }
      state.spotify.error = undefined;
    } catch (e) {
      state.spotify.error = e.message;
    }
    state.spotify.at = Date.now();
    changed();
  }

  setInterval(poll, 4000);
  poll();
  const pollSoon = () => setTimeout(poll, 400);

  // ------------------------------------------------------------ actions (Car Thing only)
  async function action(name, body = {}) {
    const pl = state.spotify.player;
    switch (name) {
      case 'toggle': {
        if (!pl) {
          // nothing is active: wake the first Spotify device that is open somewhere
          const d = await api('GET', '/me/player/devices');
          const dev = (d?.devices || []).find((x) => !x.is_restricted);
          if (!dev) throw new Error('Open Spotify on a phone or computer first');
          await api('PUT', '/me/player', { device_ids: [dev.id], play: true });
          break;
        }
        await api('PUT', pl.isPlaying ? '/me/player/pause' : '/me/player/play');
        pl.isPlaying = !pl.isPlaying;
        break;
      }
      case 'next': await api('POST', '/me/player/next'); break;
      case 'prev': await api('POST', '/me/player/previous'); break;
      case 'volume': {
        const cur = pl?.device?.volume ?? 50;
        const v = Math.max(0, Math.min(100, Math.round(cur + Number(body.delta || 0))));
        await api('PUT', `/me/player/volume?volume_percent=${v}`);
        if (pl?.device) pl.device.volume = v;
        break;
      }
      case 'like': {
        if (!pl?.id || pl.type !== 'track') return;
        const like = !state.spotify.liked;
        await api(like ? 'PUT' : 'DELETE', `/me/tracks?ids=${pl.id}`);
        state.spotify.liked = like;
        break;
      }
      default: throw new Error('unknown action');
    }
    changed();
    pollSoon();
  }

  // ------------------------------------------------------------ album art proxy (the Car Thing has no internet)
  const artCache = new Map();
  async function art(u) {
    const url = new URL(u);
    if (url.protocol !== 'https:' || url.hostname !== 'i.scdn.co') throw new Error('host not allowed');
    if (artCache.has(u)) return artCache.get(u);
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`art ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const v = { type: r.headers.get('content-type') || 'image/jpeg', buf };
    artCache.set(u, v);
    if (artCache.size > 30) artCache.delete(artCache.keys().next().value);
    return v;
  }

  // ------------------------------------------------------------ linking
  function linkUrl() {
    const verifier = b64url(crypto.randomBytes(64));
    pending = { verifier, state: b64url(crypto.randomBytes(16)), at: Date.now() };
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    return 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES,
      code_challenge_method: 'S256', code_challenge: challenge, state: pending.state,
    });
  }

  async function callback(code, st) {
    if (!pending || st !== pending.state || Date.now() - pending.at > 10 * 60000) throw new Error('invalid or expired link attempt');
    const { verifier } = pending;
    pending = null;
    const j = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });
    saveTokens({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 });
    poll();
  }

  return { action, art, linkUrl, callback, configured: () => !!CLIENT_ID };
}

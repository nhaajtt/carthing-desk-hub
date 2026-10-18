// Price alerts: percentage moves over a window, and level crossings. Levels come from config.json, and from
// the Car Thing (Markets zoom → press the knob): those are kept in state/levels.json and fire once.
import fs from 'node:fs';
import path from 'node:path';

const WINDOWS = { '15m': 15 * 60000, '1h': 3600000, '4h': 4 * 3600000, '24h': 24 * 3600000 };
const KEEP = 26 * 3600000;

export function createAlerts({ state, changed, config, priceOf, labelOf, stateDir }) {
  const cfg = config.alerts || {};
  const cooldown = (cfg.cooldownMinutes ?? 60) * 60000;
  const history = new Map(); // asset -> [[t, price], ...] one sample per minute
  const lastFired = new Map();
  let seq = 0;
  state.alerts = [];

  const assets = new Set([...(cfg.moves || []), ...(cfg.levels || [])].map((r) => r.asset));
  const userFile = path.join(stateDir, 'levels.json');
  let user = {}; // asset -> { above, below }, set on the Car Thing
  try { user = JSON.parse(fs.readFileSync(userFile, 'utf8')) || {}; } catch {}
  function publishLevels() {
    state.levels = Object.entries(user).map(([asset, v]) => ({ asset, label: labelOf(asset), above: v.above ?? null, below: v.below ?? null }));
    for (const a of Object.keys(user)) assets.add(a);
    try { fs.writeFileSync(userFile, JSON.stringify(user)); } catch (e) { console.error('[alerts]', e.message); }
    changed();
  }
  // POST /api/alerts/level {asset, kind: 'above' | 'below' | 'clear', value}
  function setLevel(asset, kind, value) {
    if (priceOf(asset) == null) return false;
    if (kind === 'clear') delete user[asset];
    else {
      const v = Number(value);
      if (!(v > 0) || !['above', 'below'].includes(kind)) return false;
      user[asset] = { ...user[asset], [kind]: v };
    }
    if (user[asset] && user[asset].above == null && user[asset].below == null) delete user[asset];
    publishLevels();
    return true;
  }

  function sample() {
    const t = Date.now();
    for (const a of assets) {
      const p = priceOf(a);
      if (p == null) continue;
      const h = history.get(a) || [];
      h.push([t, p]);
      while (h.length && t - h[0][0] > KEEP) h.shift();
      history.set(a, h);
    }
  }

  function priceAgo(a, ms) {
    const h = history.get(a);
    if (!h || !h.length || Date.now() - h[0][0] < ms * 0.9) return null; // not enough history yet
    const target = Date.now() - ms;
    let best = h[0];
    for (const s of h) { if (s[0] <= target) best = s; else break; }
    return best[1];
  }

  function fire(key, asset, dir, text) {
    const k = `${key}:${dir}`;
    if (Date.now() - (lastFired.get(k) || 0) < cooldown) return;
    lastFired.set(k, Date.now());
    state.alerts.unshift({ id: ++seq, at: Date.now(), asset, dir, text });
    state.alerts.length = Math.min(state.alerts.length, 20);
    console.log('[alert]', text);
    changed();
  }

  const vi = () => state.display?.lang === 'vi';
  const fmt = (p) => (Math.abs(p) >= 1000 ? Math.round(p).toLocaleString('en-US') : Number(p.toPrecision(5)).toString());

  function check() {
    sample();
    (cfg.moves || []).forEach((r, i) => {
      const ms = WINDOWS[r.window];
      const now = priceOf(r.asset);
      const then = ms && priceAgo(r.asset, ms);
      if (now == null || !then) return;
      const chg = (now / then - 1) * 100;
      if (Math.abs(chg) >= r.pct) {
        const dir = chg > 0 ? 'up' : 'down';
        fire(`move${i}`, r.asset, dir, `${labelOf(r.asset)} ${chg > 0 ? '+' : ''}${chg.toFixed(2)}% ${vi() ? 'trong' : 'in'} ${r.window} · ${vi() ? 'hiện' : 'now'} ${fmt(now)}`);
      }
    });
    // one-shot levels from the Car Thing: banner, then gone
    for (const [a, v] of Object.entries(user)) {
      const h = history.get(a);
      if (!h || h.length < 2) continue;
      const prev = h[h.length - 2][1], now = h[h.length - 1][1];
      for (const kind of ['above', 'below']) {
        const lvl = v[kind];
        if (lvl == null || !(kind === 'above' ? prev < lvl && now >= lvl : prev > lvl && now <= lvl)) continue;
        lastFired.delete(`user:${a}:${kind}`);
        fire(`user:${a}:${kind}`, a, kind === 'above' ? 'up' : 'down', vi()
          ? `🔔 ${labelOf(a)} ${kind === 'above' ? 'đã lên tới' : 'đã xuống'} ${fmt(lvl)} · hiện ${fmt(now)}`
          : `🔔 ${labelOf(a)} ${kind === 'above' ? 'reached' : 'fell to'} ${fmt(lvl)} · now ${fmt(now)}`);
        delete v[kind];
        if (v.above == null && v.below == null) delete user[a];
        publishLevels();
      }
    }
    (cfg.levels || []).forEach((r, i) => {
      const h = history.get(r.asset);
      if (!h || h.length < 2) return;
      const prev = h[h.length - 2][1], now = h[h.length - 1][1];
      if (r.above != null && prev < r.above && now >= r.above) fire(`level${i}`, r.asset, 'up', vi() ? `${labelOf(r.asset)} vượt lên trên ${fmt(r.above)} · hiện ${fmt(now)}` : `${labelOf(r.asset)} crossed above ${fmt(r.above)} · now ${fmt(now)}`);
      if (r.below != null && prev > r.below && now <= r.below) fire(`level${i}`, r.asset, 'down', vi() ? `${labelOf(r.asset)} giảm xuống dưới ${fmt(r.below)} · hiện ${fmt(now)}` : `${labelOf(r.asset)} crossed below ${fmt(r.below)} · now ${fmt(now)}`);
    });
  }

  setInterval(check, 60000);
  setTimeout(check, 15000);

  // banners from other parts of the hub (security, rain, CI): kind is 'sec', 'rain' or 'ci'
  function notify(kind, text) {
    state.alerts.unshift({ id: ++seq, at: Date.now(), asset: null, dir: kind, text });
    state.alerts.length = Math.min(state.alerts.length, 20);
    console.log(`[${kind}]`, text);
    changed();
  }
  state.levels = [];
  if (Object.keys(user).length) publishLevels();
  return { notify, setLevel };
}

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import { createAlerts } from './alerts.mjs';
import { createAssistant } from './assistant.mjs';
import { createSpotify } from './spotify.mjs';
import { NEWS_FEEDS, fetchFeed, summarize, cachedSummary } from './news.mjs';
import { createCalendar } from './calendar.mjs';
import { createHistory } from './history.mjs';
import { createSecurity } from './security.mjs';
import { createRegistry } from './registry.mjs';
import { createGitHub } from './github.mjs';
import { cover } from './covers.mjs';
import { lyrics, translateLyrics } from './lyrics.mjs';
import { createDesk } from './desk.mjs';
import { createReminders } from './reminders.mjs';

const PORT = Number(process.env.PORT || 8787);
const LAT = Number(process.env.LAT || 37.3382);
const LON = Number(process.env.LON || -121.8863);
const CITY = process.env.CITY || 'San Jose';
const WX_TZ = process.env.WX_TZ || 'America/Los_Angeles';
const IMPERIAL = (process.env.UNITS || 'imperial') === 'imperial';
const CARTHING_IP = process.env.CARTHING_IP || '10.42.1.2';
const DOCKER_STATUS_URL = process.env.DOCKER_STATUS_URL || 'http://docker-status:8080/';
const STATE_DIR = path.resolve('state');
const PUBLIC_DIR = path.resolve('public');
// read-only mount with this host's report (host/host-report.sh) and the Car Thing check (carthing/check-carthing.sh)
const HOST_DIR = path.resolve(process.env.HOST_REPORT_DIR || 'host');
// Yahoo answers 429 to full browser UA strings but accepts this short form
const UA = 'Mozilla/5.0';
// changes on every hub start; the screen reloads itself when it sees a new one (picks up UI updates)
const BOOT = Date.now().toString(36);

// ---------------------------------------------------------------- config (edit config.json, then restart the hub)

const config = JSON.parse(fs.readFileSync(path.resolve('config.json'), 'utf8'));
const CRYPTO = (config.crypto || ['BTC']).map((s) => String(s).toUpperCase()).slice(0, 6);
const INDICES = (config.indices || []).slice(0, 6);
// gold/silver futures and USD/VND are always fetched: the gold & FX rows use them
const YAHOO = { gold: 'GC=F', silver: 'SI=F', usdvnd: 'VND=X', ...Object.fromEntries(INDICES.map((i) => [i.key, i.symbol])) };

// ---------------------------------------------------------------- state

const state = {
  city: CITY,
  units: IMPERIAL ? { temp: '°F', wind: 'mph' } : { temp: '°C', wind: 'km/h' },
  tz: WX_TZ,
  config: { crypto: CRYPTO, indices: INDICES.map(({ key, name, sub, decimals }) => ({ key, name, sub, decimals })) },
  display: { brightness: 80, lang: 'en' },
  crypto: Object.fromEntries(CRYPTO.map((s) => [s, { price: null, open24h: null, high24h: null, low24h: null, spark: [], at: 0 }])),
  metals: { xau: null, xag: null, at: 0 },
  yahoo: {},
  vngold: { items: [], at: 0 },
  nowcast: null,
  fx: { rates: {}, at: 0 },
  weather: null,
  aqi: null,
  servers: { server2: null, server1: null },
  news: { feeds: NEWS_FEEDS.map(({ key, name }) => ({ key, name, items: [], at: 0 })), at: 0 },
  sources: {},
};

// res -> true when the client may see everything (the Car Thing), false for the read-only LAN preview
const clients = new Map();
let pending = false;
function changed() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    const full = `data: ${JSON.stringify({ t: Date.now(), v: BOOT, state })}\n\n`;
    let pub = null;
    for (const [res, all] of clients) res.write(all ? full : (pub ??= `data: ${JSON.stringify({ t: Date.now(), v: BOOT, state: publicState() })}\n\n`));
  }, 500); // at most two updates a second: each one is parsed and drawn by the Car Thing's small CPU
}

// The LAN preview is read-only but anyone on the LAN can open it, so it gets no calendar, no security or
// update details, no GitHub and no Mei answers (those can quote the calendar). PREVIEW_FULL_FROM lists
// addresses that may see everything anyway.
const PREVIEW_FULL_FROM = (process.env.PREVIEW_FULL_FROM || '').split(/[\s,]+/).filter(Boolean);
function publicState() {
  const v = state.voice;
  return {
    ...state,
    calendar: state.calendar && { configured: state.calendar.configured, events: [], at: state.calendar.at, hidden: true },
    alerts: (state.alerts || []).filter((a) => ['up', 'down', 'rain'].includes(a.dir)),
    security: null, updates: null,
    github: { configured: false, hidden: true },
    voice: v && { ...v, transcript: '', answer: v.answer ? 'Answers show on the Car Thing only.' : '' },
    // when you are at your desk, and what you asked to be reminded of, are nobody else's business
    desk: null, reminders: [],
  };
}

function markSource(name, ok, err) {
  state.sources[name] = { ok, at: Date.now(), err: ok ? undefined : String(err).slice(0, 160) };
}

async function getJSON(url, opts = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000), ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function every(ms, name, fn) {
  const run = async () => {
    try {
      await fn();
      markSource(name, true);
    } catch (e) {
      markSource(name, false, e.message || e);
      console.error(`[${name}]`, e.message || e);
    }
    changed();
  };
  run();
  setInterval(run, ms);
}

// ---------------------------------------------------------------- crypto: OKX websocket (free, no key)

function applyTicker(d) {
  const sym = d.instId.split('-')[0];
  const c = state.crypto[sym];
  if (!c) return;
  c.price = Number(d.last);
  c.open24h = Number(d.open24h);
  c.high24h = Number(d.high24h);
  c.low24h = Number(d.low24h);
  c.at = Date.now();
}

let okxLastMsg = 0;
function connectOKX() {
  let ws;
  try {
    ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
  } catch (e) {
    markSource('okx-ws', false, e.message);
    return setTimeout(connectOKX, 5000);
  }
  let ping;
  ws.onopen = () => {
    ws.send(JSON.stringify({ op: 'subscribe', args: CRYPTO.map((s) => ({ channel: 'tickers', instId: `${s}-USDT` })) }));
    ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 20000);
    markSource('okx-ws', true);
  };
  ws.onmessage = (ev) => {
    okxLastMsg = Date.now();
    if (ev.data === 'pong') return;
    const m = JSON.parse(ev.data);
    if (m.arg?.channel === 'tickers' && Array.isArray(m.data)) {
      m.data.forEach(applyTicker);
      changed();
    }
  };
  ws.onclose = ws.onerror = () => {
    clearInterval(ping);
    markSource('okx-ws', false, 'disconnected');
    try { ws.close(); } catch {}
    setTimeout(connectOKX, 5000);
  };
}
connectOKX();

// REST fallback when the websocket has been quiet for a while
every(30000, 'okx-rest', async () => {
  if (Date.now() - okxLastMsg < 30000) return;
  const j = await getJSON('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
  for (const d of j.data || []) if (CRYPTO.some((s) => d.instId === `${s}-USDT`)) applyTicker(d);
});

// 24h sparkline from 15-minute candles
every(5 * 60000, 'okx-candles', async () => {
  for (const s of CRYPTO) {
    const j = await getJSON(`https://www.okx.com/api/v5/market/candles?instId=${s}-USDT&bar=15m&limit=96`);
    state.crypto[s].spark = (j.data || []).map((k) => Number(k[4])).reverse();
  }
});

// ---------------------------------------------------------------- metals spot (gold-api.com, free)

every(30000, 'gold-api', async () => {
  const [xau, xag] = await Promise.all([
    getJSON('https://api.gold-api.com/price/XAU'),
    getJSON('https://api.gold-api.com/price/XAG'),
  ]);
  state.metals = { xau: xau.price, xag: xag.price, at: Date.now() };
});

// ---------------------------------------------------------------- yahoo spark (indices, fx, futures)

// one request for every symbol, to stay well under Yahoo's rate limit
every(60000, 'yahoo', async () => {
  const syms = [...new Set(Object.values(YAHOO))].map(encodeURIComponent).join(',');
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/spark?symbols=${syms}&range=1d&interval=15m`);
  for (const [key, sym] of Object.entries(YAHOO)) {
    const r = j[sym];
    const closes = (r?.close || []).filter((v) => v != null);
    if (!closes.length) continue;
    state.yahoo[key] = {
      price: closes[closes.length - 1],
      prev: r.chartPreviousClose ?? r.previousClose,
      marketTime: r.end * 1000,
      spark: closes,
      at: Date.now(),
    };
  }
});

// ---------------------------------------------------------------- vietnam gold (PNJ, free)

every(5 * 60000, 'pnj', async () => {
  const j = await getJSON('https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price?zone=00');
  const want = { SJC: 'Vàng miếng SJC', N24K: 'Nhẫn trơn 999.9' };
  state.vngold = {
    // PNJ quotes in units of 10,000 VND per tael (lượng)
    items: (j.data || []).filter((x) => want[x.masp]).map((x) => ({
      code: x.masp, name: want[x.masp], buy: x.giamua * 10000, sell: x.giaban * 10000,
    })),
    at: Date.now(),
  };
});

// ---------------------------------------------------------------- Vietcombank FX (max 1 request / 5 min)

every(5 * 60000 + 5000, 'vietcombank', async () => {
  const xml = await getText('https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx');
  const num = (s) => (s && s !== '-' ? Number(s.replace(/,/g, '')) : null);
  const rates = {};
  for (const m of xml.matchAll(/<Exrate CurrencyCode="(\w+)"[^>]*Buy="([^"]*)" Transfer="([^"]*)" Sell="([^"]*)"/g)) {
    rates[m[1]] = { buy: num(m[2]), transfer: num(m[3]), sell: num(m[4]) };
  }
  if (!rates.USD) throw new Error('no USD in response');
  state.fx = { rates, at: Date.now() };
});

// ---------------------------------------------------------------- weather + air quality (Open-Meteo, free)

every(10 * 60000, 'open-meteo', async () => {
  const units = IMPERIAL ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
  const q = `latitude=${LAT}&longitude=${LON}&timezone=${encodeURIComponent(WX_TZ)}${units}`;
  const w = await getJSON(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&hourly=temperature_2m,precipitation_probability,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset&forecast_days=4`);
  // hourly times are local wall-clock strings; convert with the offset Open-Meteo reports
  const toMs = (t) => Date.parse(t + ':00Z') - w.utc_offset_seconds * 1000;
  const nowIdx = Math.max(0, w.hourly.time.findIndex((t) => toMs(t) > Date.now()) - 1);
  state.weather = {
    current: w.current,
    hourly: w.hourly.time.slice(nowIdx, nowIdx + 12).map((t, i) => ({
      t, temp: w.hourly.temperature_2m[nowIdx + i], pop: w.hourly.precipitation_probability[nowIdx + i], code: w.hourly.weather_code[nowIdx + i],
    })),
    daily: w.daily.time.map((t, i) => ({
      t, max: w.daily.temperature_2m_max[i], min: w.daily.temperature_2m_min[i], pop: w.daily.precipitation_probability_max[i], code: w.daily.weather_code[i],
    })),
    sunrise: w.daily.sunrise[0], sunset: w.daily.sunset[0],
    at: Date.now(),
  };
});

every(15 * 60000, 'open-meteo-aqi', async () => {
  const a = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}&current=us_aqi,pm2_5,pm10,uv_index&timezone=${encodeURIComponent(WX_TZ)}`);
  state.aqi = { ...a.current, at: Date.now() };
});

// rain in the next two hours, in 15-minute steps (Open-Meteo minutely_15)
let lastRainNote = 0;
every(5 * 60000, 'nowcast', async () => {
  const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&timezone=${encodeURIComponent(WX_TZ)}&minutely_15=precipitation,precipitation_probability&past_minutely_15=1&forecast_minutely_15=9`);
  const m = w.minutely_15;
  const toMs = (t) => Date.parse(t + ':00Z') - w.utc_offset_seconds * 1000;
  const slots = m.time.map((t, i) => ({ t: toMs(t), mm: m.precipitation[i] ?? 0, prob: m.precipitation_probability?.[i] ?? 0 }));
  const now = Date.now();
  const ci = Math.max(0, slots.findLastIndex((x) => x.t <= now));
  const wet = (x) => x.mm >= 0.1 || x.prob >= 60;
  const ahead = slots.slice(ci + 1);
  const mins = (t) => Math.max(5, Math.round((t - now) / 300000) * 5);
  const cur = slots[ci];
  let text = null, startsAt = null, endsAt = null;
  if (wet(cur)) {
    const end = ahead.find((x) => !wet(x));
    endsAt = end ? end.t : null;
    text = end ? `Rain now, easing in about ${mins(end.t)} min` : 'Rain now, for the next two hours';
  } else {
    const start = ahead.find(wet);
    if (start) { startsAt = start.t; text = `Rain likely in about ${mins(start.t)} min`; }
  }
  state.nowcast = { text, wetNow: wet(cur), startsAt, endsAt, bars: slots.slice(ci, ci + 9).map(({ t, mm, prob }) => ({ t, mm, prob })), at: now };
  if (startsAt && startsAt - now <= 30 * 60000 && now - lastRainNote > 3 * 3600000) {
    lastRainNote = now;
    alerts.notify('rain', state.display.lang === 'vi' ? `Có thể mưa trong khoảng ${mins(startsAt)} phút nữa ở ${CITY}` : `${text} in ${CITY}`);
  }
});

// ---------------------------------------------------------------- headlines (Google News RSS + Hacker News, free)

// every 2 minutes: fresh enough for breaking news without hammering the feeds
const newsItems = new Map();
every(2 * 60000, 'news', async () => {
  const results = await Promise.allSettled(NEWS_FEEDS.map((f) => fetchFeed(f, getText, getJSON)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length) {
      // the screen gets only what it draws; links and related headlines stay on the hub for summaries
      r.value.forEach((it) => newsItems.set(it.id, it));
      Object.assign(state.news.feeds[i], { items: r.value.map(({ id, title, source, at, score }) => ({ id, title, source, at, score })), at: Date.now() });
    }
    else if (r.status === 'rejected') console.error('[news]', NEWS_FEEDS[i].key, r.reason?.message);
  });
  if (results.every((r) => r.status === 'rejected')) throw new Error('all feeds failed');
  state.news.at = Date.now();
  if (newsItems.size > 2000) [...newsItems.keys()].slice(0, newsItems.size - 2000).forEach((k) => newsItems.delete(k));
});

// ---------------------------------------------------------------- calendar (secret iCal links, read-only)

createCalendar({ state, changed, tz: WX_TZ, every });

// ---------------------------------------------------------------- servers

let prevCpu = null;
function readCpu() {
  const [, ...f] = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/);
  const v = f.map(Number);
  const idle = v[3] + (v[4] || 0);
  const total = v.reduce((a, b) => a + b, 0);
  let pct = null;
  if (prevCpu) pct = 100 * (1 - (idle - prevCpu.idle) / (total - prevCpu.total || 1));
  prevCpu = { idle, total };
  return pct;
}

function readFirst(...files) {
  for (const f of files) {
    try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  }
  return null;
}

function maxTemp() {
  let max = null;
  try {
    for (const z of fs.readdirSync('/sys/class/thermal')) {
      if (!z.startsWith('thermal_zone')) continue;
      const v = Number(readFirst(`/sys/class/thermal/${z}/temp`)) / 1000;
      if (v > 0 && (max == null || v > max)) max = v;
    }
  } catch {}
  return max;
}

every(5000, 'server2', async () => {
  const mem = Object.fromEntries(fs.readFileSync('/proc/meminfo', 'utf8').split('\n').filter(Boolean).map((l) => {
    const [k, v] = l.split(':');
    return [k, Number(v.trim().split(' ')[0]) * 1024];
  }));
  const st = fs.statfsSync('/');
  const bat = readFirst('/sys/class/power_supply/BAT1/capacity', '/sys/class/power_supply/BAT0/capacity');
  const batStatus = readFirst('/sys/class/power_supply/BAT1/status', '/sys/class/power_supply/BAT0/status');
  const prev = state.servers.server2;
  state.servers.server2 = {
    name: 'server 2', ip: '10.10.10.20',
    cpu: readCpu(),
    load: fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number),
    cores: os.cpus().length,
    memUsed: mem.MemTotal - mem.MemAvailable, memTotal: mem.MemTotal,
    diskUsed: (st.blocks - st.bfree) * st.bsize, diskTotal: st.blocks * st.bsize,
    temp: maxTemp(),
    battery: bat == null ? null : Number(bat), batteryStatus: batStatus,
    uptime: Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]),
    containers: prev && prev.containers,
    at: Date.now(),
  };
});

const cleanContainers = (list) => (Array.isArray(list) ? list.slice(0, 80).map((c) => ({
  name: String(c.name || '').slice(0, 40),
  state: String(c.state || '').slice(0, 20),
  health: c.health ? String(c.health).slice(0, 12) : null,
  status: String(c.status || '').slice(0, 60),
  image: c.image ? String(c.image).slice(0, 120) : null,
  digest: /^sha256:[0-9a-f]{64}$/.test(c.digest || '') ? c.digest : null,
  open: Array.isArray(c.open) ? c.open.slice(0, 10).map((p) => String(p).slice(0, 12)) : [],
})) : null);

every(15000, 'docker-server2', async () => {
  const list = await getJSON(DOCKER_STATUS_URL);
  if (state.servers.server2) state.servers.server2.containers = { list: cleanContainers(list), at: Date.now() };
});

function tcpLatency(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const s = net.connect({ host, port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeout, () => done(null));
    s.on('connect', () => done(performance.now() - t0));
    s.on('error', () => done(null));
  });
}

every(15000, 'server1', async () => {
  const ms = await tcpLatency('10.10.10.21', 22);
  const prev = state.servers.server1;
  state.servers.server1 = {
    name: 'server 1', ip: '10.10.10.21',
    online: ms != null, latency: ms,
    since: prev && prev.online === (ms != null) ? prev.since : Date.now(),
    stats: prev && prev.stats,
    at: Date.now(),
  };
});

// ---------------------------------------------------------------- stats pushed by the server 1 agent

const INGEST_TOKEN = process.env.INGEST_TOKEN || '';
const INGEST_FROM = (process.env.INGEST_FROM || '10.10.10.21').split(',');

function ingestAllowed(req) {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!INGEST_TOKEN || !INGEST_FROM.includes(ip)) return false;
  const got = Buffer.from(req.headers.authorization || '');
  const want = Buffer.from(`Bearer ${INGEST_TOKEN}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function applyServer1Stats(b) {
  const s1 = state.servers.server1 || { name: 'server 1', ip: '10.10.10.21' };
  s1.stats = {
    cpu: finite(b.cpu), cores: finite(b.cores),
    load: Array.isArray(b.load) ? b.load.slice(0, 3).map(finite) : null,
    memUsed: finite(b.memUsed), memTotal: finite(b.memTotal),
    diskUsed: finite(b.diskUsed), diskTotal: finite(b.diskTotal),
    temp: finite(b.temp), uptime: finite(b.uptime),
    containers: b.containers ? { list: cleanContainers(b.containers), at: Date.now() } : null,
    at: Date.now(),
  };
  state.servers.server1 = s1;
  if (b.report) security.server1(b.report);
  changed();
}

// ---------------------------------------------------------------- price alerts

const assetLabel = (a) => {
  const i = INDICES.find((x) => x.key === a);
  return i ? i.name : a === 'XAU' ? 'Gold' : a === 'XAG' ? 'Silver' : a;
};
function priceOf(a) {
  if (state.crypto[a]) return state.crypto[a].price;
  if (a === 'XAU') return state.metals.xau;
  if (a === 'XAG') return state.metals.xag;
  return state.yahoo[a]?.price ?? null;
}
const alerts = createAlerts({ state, changed, config, priceOf, labelOf: assetLabel });

// ---------------------------------------------------------------- 24 h graphs, security, updates, GitHub

createHistory({ state, stateDir: STATE_DIR });
const desk = createDesk({ state, changed, stateDir: STATE_DIR, tz: WX_TZ, notify: alerts.notify, lang: () => state.display.lang });
// light the screen for something that matters (a reminder): at night and while the phone is away
function wakeDisplay() {
  if (state.display.night?.active) { wakeUntil = Date.now() + WAKE_MS; updateNight(); }
  if (state.display.away) { state.display.away = false; changed(); }
}
const reminders = createReminders({ state, changed, stateDir: STATE_DIR, notify: alerts.notify, wake: wakeDisplay });
// counts only (never the text) of what the paired iPhone got, sent by the Car Thing for the morning briefing
let phoneSummary = null;
const security = createSecurity({ state, changed, stateDir: STATE_DIR, hostDir: HOST_DIR, notify: alerts.notify });
createRegistry({ state, changed, every });
createGitHub({ state, changed, notify: alerts.notify, every });

// ---------------------------------------------------------------- voice assistant

function snapshot() {
  const tz = { timeZone: WX_TZ };
  const lines = [`Local time: ${new Date().toLocaleString('en-US', tz)}`];
  for (const s of CRYPTO) {
    const c = state.crypto[s];
    if (c.price) lines.push(`${s}/USDT ${c.price} (24h ${(((c.price / c.open24h) - 1) * 100).toFixed(2)}%)`);
  }
  if (state.metals.xau) lines.push(`Gold spot ${state.metals.xau} USD/oz, silver ${state.metals.xag} USD/oz`);
  for (const g of state.vngold.items) lines.push(`${g.name}: buy ${g.buy} VND, sell ${g.sell} VND per tael`);
  const usd = state.fx.rates?.USD;
  if (usd) lines.push(`USD/VND Vietcombank buy ${usd.transfer} sell ${usd.sell}; interbank ${state.yahoo.usdvnd?.price ?? 'n/a'}`);
  for (const i of INDICES) {
    const q = state.yahoo[i.key];
    if (q) lines.push(`${i.name} ${q.price} (vs prev close ${(((q.price / q.prev) - 1) * 100).toFixed(2)}%)`);
  }
  const w = state.weather;
  if (w) lines.push(`Weather in ${CITY}: ${w.current.temperature_2m}${state.units.temp}, today ${w.daily[0].min}-${w.daily[0].max}, rain chance ${w.daily[0].pop}%, AQI ${state.aqi?.us_aqi ?? 'n/a'}`);
  const s2 = state.servers.server2, s1 = state.servers.server1;
  if (s2) lines.push(`Server 2: CPU ${Math.round(s2.cpu || 0)}%, RAM ${(s2.memUsed / 2 ** 30).toFixed(1)} GB used`);
  if (s1) lines.push(`Server 1: ${s1.online ? 'online' : 'offline'}${s1.stats ? `, CPU ${Math.round(s1.stats.cpu || 0)}%` : ''}`);
  const ph = phoneSummary;
  if (ph && Date.now() - ph.at < 2 * 3600000) lines.push(`Phone (last 12 hours): ${ph.notes} notifications, ${ph.calls} missed calls${ph.battery != null ? `, battery ${ph.battery}%` : ''}`);
  if (state.alerts?.length) lines.push(`Recent alerts: ${state.alerts.slice(0, 3).map((a) => a.text).join('; ')}`);
  if (state.calendar?.configured) {
    const day = (ms) => new Date(ms).toLocaleDateString('en-CA', tz);
    const today = day(Date.now()), tomorrow = day(Date.now() + 86400000);
    const when = (e) => (e.allDay ? 'all day' : new Date(e.start).toLocaleTimeString('en-US', { ...tz, hour: 'numeric', minute: '2-digit' }));
    for (const [label, d] of [['today', today], ['tomorrow', tomorrow]]) {
      const evs = state.calendar.events.filter((e) => day(e.start) === d || (e.allDay && e.start <= Date.now() && e.end > Date.now() && label === 'today'));
      lines.push(`Calendar ${label}: ${evs.length ? evs.map((e) => `${when(e)} ${e.title}${e.location ? ` (${e.location})` : ''}`).join('; ') : 'nothing'}`);
    }
  }
  for (const f of state.news.feeds) if (f.items.length) lines.push(`Headlines, ${f.name}: ${f.items.slice(0, 4).map((h) => `${h.title} (${h.source})`).join(' | ')}`);
  return lines.join('\n');
}

// what the screen showed when the knob was pressed, so "what does this story say?" works
function describe(ctx) {
  if (!ctx) return '';
  const out = [];
  if (typeof ctx.page === 'string') out.push(`Page: ${ctx.page.slice(0, 20)}`);
  const item = typeof ctx.story === 'string' ? newsItems.get(ctx.story) : null;
  if (item) {
    const sum = cachedSummary(item.id);
    out.push(`Open story: "${item.title}" (${item.source})${sum?.summary ? `\nIts summary: ${sum.summary}` : ''}`);
  }
  return out.join('\n');
}
const assistant = createAssistant({ state, changed, snapshot, describe, onReminder: (m, t) => reminders.add(m, t) });

// ---------------------------------------------------------------- morning briefing (once a day at BRIEFING_AT, local time)

const BRIEFING_AT = process.env.BRIEFING_AT || '07:00'; // "off" to disable
// the briefing follows the screen language unless BRIEFING_LANG pins one
const briefingLang = () => process.env.BRIEFING_LANG || (state.display.lang === 'vi' ? 'Vietnamese' : 'English');
const BRIEFING_FILE = path.join(STATE_DIR, 'briefing.json');
let lastBriefing = '';
try { lastBriefing = JSON.parse(fs.readFileSync(BRIEFING_FILE, 'utf8')).date || ''; } catch {}
setInterval(() => {
  const m = BRIEFING_AT.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: WX_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const mins = Number(p.hour) * 60 + Number(p.minute), at = Number(m[1]) * 60 + Number(m[2]);
  // only inside a two-hour window, so restarting the hub in the afternoon does not trigger it
  if (date === lastBriefing || mins < at || mins > at + 120) return;
  lastBriefing = date;
  try { fs.writeFileSync(BRIEFING_FILE, JSON.stringify({ date })); } catch (e) { console.error('[briefing]', e.message); }
  assistant.briefing(briefingLang());
}, 30000);

// ---------------------------------------------------------------- display brightness (set from the Car Thing, applied there by a small sync script)

const DISPLAY_FILE = path.join(STATE_DIR, 'display.json');
try { Object.assign(state.display, JSON.parse(fs.readFileSync(DISPLAY_FILE, 'utf8'))); } catch {}

function setBrightness(pct) {
  state.display.brightness = Math.max(5, Math.min(100, Math.round(pct)));
  saveDisplay();
}
function saveDisplay() {
  try { fs.writeFileSync(DISPLAY_FILE, JSON.stringify({ brightness: state.display.brightness, lang: state.display.lang })); } catch (e) { console.error('[display]', e.message); }
  changed();
}

// Night: the backlight goes off between NIGHT_DIM's two times (local, WX_TZ). Any knob turn or button press
// lights it for WAKE_MINUTES; that first touch only wakes the screen.
const NIGHT = (process.env.NIGHT_DIM || '23:00-06:30').match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
const WAKE_MS = Number(process.env.WAKE_MINUTES || 2) * 60000;
let wakeUntil = 0;
function updateNight() {
  if (!NIGHT) { state.display.night = null; return; }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: WX_TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const mins = Number(p.hour) * 60 + Number(p.minute);
  const from = Number(NIGHT[1]) * 60 + Number(NIGHT[2]), to = Number(NIGHT[3]) * 60 + Number(NIGHT[4]);
  const active = from > to ? mins >= from || mins < to : mins >= from && mins < to;
  const dark = active && Date.now() > wakeUntil;
  const prev = state.display.night;
  const next = { from: `${NIGHT[1].padStart(2, '0')}:${NIGHT[2]}`, to: `${NIGHT[3].padStart(2, '0')}:${NIGHT[4]}`, active, dark, wakeUntil: active ? wakeUntil : 0 };
  state.display.night = next;
  if (!prev || prev.active !== active || prev.dark !== dark || prev.wakeUntil !== next.wakeUntil) changed();
}
updateNight();
setInterval(updateNight, 10000);

const fromCarThing = (req) => (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === CARTHING_IP;
const fullView = (req) => fromCarThing(req) || PREVIEW_FULL_FROM.includes((req.socket.remoteAddress || '').replace(/^::ffff:/, ''));

// ---------------------------------------------------------------- spotify

const spotify = createSpotify({ state, changed, stateDir: STATE_DIR });

const page = (title, msg) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;background:#0b0d10;color:#e9edf2;display:grid;place-items:center;height:90vh"><div><h2>${title}</h2><p>${msg}</p></div>`;

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { req.destroy(); reject(new Error('too large')); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- http

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (url.pathname === '/health') return res.end('ok');

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const all = fullView(req);
    res.write(`retry: 3000\ndata: ${JSON.stringify({ t: Date.now(), v: BOOT, state: all ? state : publicState() })}\n\n`);
    clients.set(res, all);
    // a named event (not a comment) so the screen can tell a quiet hub from a dead connection
    const hb = setInterval(() => res.write(`event: hb\ndata: ${JSON.stringify({ t: Date.now(), v: BOOT })}\n\n`), 10000);
    req.on('close', () => { clearInterval(hb); clients.delete(res); });
    return;
  }

  if (url.pathname === '/api/state') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ t: Date.now(), state: fullView(req) ? state : publicState() }));
  }

  // plain-text percentage, polled by the sync script on the Car Thing
  if (url.pathname === '/api/brightness' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/plain');
    return res.end(String(state.display.night?.dark || state.display.away ? 0 : state.display.brightness));
  }

  // screen language, chosen in the quick menu: 'en' or 'vi'
  if (url.pathname === '/api/display/lang' && req.method === 'POST') {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    readRaw(req, 100).then((b) => {
      let lang = '';
      try { lang = JSON.parse(b.toString() || '{}').lang; } catch {}
      if (lang !== 'en' && lang !== 'vi') { res.writeHead(400); return res.end(); }
      state.display.lang = lang;
      saveDisplay();
      res.end(lang);
    }).catch(() => { res.writeHead(413); res.end(); });
    return;
  }

  // any input on the Car Thing during the night lights the screen for a while
  if (url.pathname === '/api/display/wake' && req.method === 'POST') {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    if (state.display.night?.active) { wakeUntil = Date.now() + WAKE_MS; updateNight(); }
    return res.end('ok');
  }

  // the paired iPhone left the desk (or came back): the screen goes off until it returns or is touched
  if (url.pathname === '/api/display/away' && req.method === 'POST') {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    readRaw(req, 100).then((b) => {
      let away = false;
      try { away = JSON.parse(b.toString() || '{}').away === true; } catch {}
      if (state.display.away !== away) { state.display.away = away; changed(); }
      res.end(String(away));
    }).catch(() => { res.writeHead(413); res.end(); });
    return;
  }

  if (url.pathname === '/api/brightness' && req.method === 'POST') {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    readRaw(req, 200).then((b) => {
      let pct = NaN;
      try { pct = Number(JSON.parse(b.toString() || '{}').pct); } catch {}
      if (!Number.isFinite(pct)) { res.writeHead(400); return res.end(); }
      setBrightness(pct);
      res.end(String(state.display.brightness));
    }).catch(() => { res.writeHead(413); res.end(); });
    return;
  }

  // linking is started from a browser on the LAN, never from the Car Thing
  if (url.pathname === '/spotify/link') {
    if (fromCarThing(req)) { res.writeHead(403); return res.end(); }
    if (!spotify.configured()) { res.writeHead(503, { 'Content-Type': 'text/html' }); return res.end(page('Spotify not configured', 'Set SPOTIFY_CLIENT_ID in .env first.')); }
    res.writeHead(302, { Location: spotify.linkUrl() });
    return res.end();
  }

  // Spotify redirects the browser to 127.0.0.1:8888/callback, which is tunnelled here during linking
  if (url.pathname === '/callback') {
    spotify.callback(url.searchParams.get('code') || '', url.searchParams.get('state') || '')
      .then(() => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page('Spotify linked', 'You can close this tab.')); })
      .catch((e) => { res.writeHead(400, { 'Content-Type': 'text/html' }); res.end(page('Spotify link failed', String(e.message).replace(/[<>&]/g, ''))); });
    return;
  }

  if (url.pathname === '/api/spotify/art') {
    spotify.art(url.searchParams.get('u') || '')
      .then((a) => { res.writeHead(200, { 'Content-Type': a.type, 'Cache-Control': 'max-age=86400' }); res.end(a.buf); })
      .catch(() => { res.writeHead(404); res.end(); });
    return;
  }

  // the paired iPhone came to or left the desk (heartbeat every few minutes)
  if (url.pathname === '/api/desk' && req.method === 'POST') {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    readRaw(req, 100).then((b) => {
      let near = false;
      try { near = JSON.parse(b.toString() || '{}').near === true; } catch {}
      desk.report(near);
      res.end('ok');
    }).catch(() => { res.writeHead(413); res.end(); });
    return;
  }
  if (url.pathname === '/api/phone/summary' && req.method === 'POST') {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    readRaw(req, 200).then((b) => {
      let j = {};
      try { j = JSON.parse(b.toString() || '{}'); } catch {}
      const n = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(999, Math.round(v))) : 0);
      phoneSummary = { notes: n(j.notes), calls: n(j.calls), battery: Number.isFinite(j.battery) ? n(j.battery) : null, at: Date.now() };
      res.end('ok');
    }).catch(() => { res.writeHead(413); res.end(); });
    return;
  }

  // a Vietnamese line under each lyric line (Gemini Flash-Lite, one request per song)
  if (url.pathname === '/api/media/lyrics/vi') {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    const q = url.searchParams;
    translateLyrics(q.get('t'), q.get('a'), q.get('al'), q.get('d'))
      .then((l) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(l)); })
      .catch(() => { res.writeHead(502); res.end('null'); });
    return;
  }

  // timed lyrics for what is playing (LRCLIB)
  if (url.pathname === '/api/media/lyrics') {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    const q = url.searchParams;
    lyrics(q.get('t'), q.get('a'), q.get('al'), q.get('d'))
      .then((l) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' }); res.end(JSON.stringify(l)); })
      .catch(() => { res.writeHead(502); res.end('null'); });
    return;
  }

  // picture for what the paired iPhone plays; only the Car Thing knows what that is
  if (url.pathname === '/api/media/cover') {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    const q = url.searchParams;
    cover(q.get('app') || '', q.get('t') || '', q.get('a') || '', q.get('al') || '')
      .then((a) => { res.writeHead(200, { 'Content-Type': a.type, 'Cache-Control': 'max-age=86400' }); res.end(a.buf); })
      .catch(() => { res.writeHead(404); res.end(); });
    return;
  }

  const sp = url.pathname.match(/^\/api\/spotify\/(toggle|pause|play|next|prev|volume|like)$/);
  if (sp && req.method === 'POST') {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    readRaw(req, 500)
      .then((b) => { let body = {}; try { body = JSON.parse(b.toString() || '{}'); } catch {} return spotify.action(sp[1], body); })
      .then(() => res.end('ok'))
      .catch((e) => { res.writeHead(502); res.end(String(e.message)); });
    return;
  }

  // restart / shut down the Car Thing itself; carried out by the agent script on the device
  const dev = url.pathname.match(/^\/api\/device\/(reboot|poweroff)$/);
  if (dev && req.method === 'POST') {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    assistant.command(dev[1]);
    return res.end('ok');
  }

  // voice: every endpoint is for the Car Thing only (its UI and its recorder script)
  if (url.pathname.startsWith('/api/voice/')) {
    if (!fromCarThing(req)) { res.writeHead(403); return res.end(); }
    res.setHeader('Content-Type', 'text/plain');
    if (url.pathname === '/api/voice/cmd') return assistant.waitCommand(res);
    if (url.pathname === '/api/voice/start' && req.method === 'POST') {
      readRaw(req, 500).then((b) => {
        let ctx = null;
        try { ctx = JSON.parse(b.toString() || 'null'); } catch {}
        assistant.start(ctx && typeof ctx === 'object' ? ctx : null);
        res.end('ok');
      }).catch(() => { res.writeHead(413); res.end(); });
      return;
    }
    if (url.pathname === '/api/voice/briefing' && req.method === 'POST') { assistant.briefing(briefingLang()); return res.end('ok'); }
    if (url.pathname === '/api/voice/dismiss' && req.method === 'POST') { assistant.dismiss(); return res.end('ok'); }
    if (url.pathname === '/api/voice/stop' && req.method === 'POST') { assistant.stop(); return res.end('ok'); }
    if (url.pathname === '/api/voice/started') { assistant.started(url.searchParams.get('id')); return res.end('ok'); }
    if (url.pathname === '/api/voice/audio' && req.method === 'POST') {
      readRaw(req, 16_000_000) // up to 15 s of 4-channel 48 kHz audio
        .then((wav) => { res.end('ok'); return assistant.audio(url.searchParams.get('id'), wav); })
        .catch(() => { res.writeHead(413); res.end(); });
      return;
    }
    res.writeHead(404); return res.end();
  }

  // one-paragraph summary of a headline (tap a story on the News page)
  if (url.pathname === '/api/news/detail') {
    const item = newsItems.get(url.searchParams.get('id') || '');
    res.setHeader('Content-Type', 'application/json');
    if (!item) { res.writeHead(404); return res.end('{}'); }
    // the lite model answers in about a second, which matters when you tap a story
    summarize(item, { key: process.env.GEMINI_API_KEY || '', model: process.env.GEMINI_SUMMARY_MODEL || 'gemini-flash-lite-latest' })
      .then((d) => res.end(JSON.stringify(d)))
      .catch((e) => { res.writeHead(502); res.end(JSON.stringify({ error: String(e.message).slice(0, 200) })); });
    return;
  }

  if (url.pathname === '/api/ingest' && req.method === 'POST') {
    if (!ingestAllowed(req)) { res.writeHead(403); return res.end(); }
    readRaw(req, 20000)
      .then((b) => { applyServer1Stats(JSON.parse(b.toString())); res.end('ok'); })
      .catch(() => { res.writeHead(400); res.end(); });
    return;
  }

  const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`hub listening on :${PORT}`));

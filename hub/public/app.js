'use strict';

const $ = (id) => document.getElementById(id);
const pages = [...document.querySelectorAll('.page')];
// page order: News, Markets, Mei (Ask), Weather, Music, Servers, Focus. Settings is a pop-up menu, not a page.
const NEWS = 0, MARKETS = 1, ASK = 2, MUSIC = 4, FOCUS = 6;
let page = 0;
let editing = false;
let S = null;
const last = {};

// The Car Thing has no internet and no NTP, so its own clock drifts. Use the hub's clock.
let clockOffset = 0;
const now = () => Date.now() + clockOffset;
const tz = () => (S && S.tz) || 'America/Los_Angeles';

// ---------------------------------------------------------------- formatting

const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
function usd(p) {
  if (p == null || isNaN(p)) return '—';
  const a = Math.abs(p);
  const d = a >= 10000 ? 0 : a >= 100 ? 2 : a >= 1 ? 3 : 5;
  return nf(d).format(p);
}
const num = (p, d = 2) => (p == null || isNaN(p) ? '—' : nf(d).format(p));
const vnd = (p) => (p == null ? '—' : nf(0).format(p));
const millions = (p) => (p == null ? '—' : nf(1).format(p / 1e6));
const pct = (n, ref) => (n == null || !ref ? null : (n / ref - 1) * 100);
function chg(v) {
  if (v == null || isNaN(v)) return '<span class="chg flat">—</span>';
  const cls = v > 0.005 ? 'up' : v < -0.005 ? 'down' : 'flat';
  return `<span class="chg ${cls}">${v > 0 ? '+' : ''}${nf(2).format(v)}%</span>`;
}
const stale = (at, maxAge) => (!at || now() - at > maxAge ? ' stale' : '');
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function spark(values, w = 54, h = 20, up = null) {
  const v = (values || []).filter((x) => x != null);
  if (v.length < 2) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  const min = Math.min(...v), max = Math.max(...v), r = max - min || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 1 - ((y - min) / r) * (h - 2)).toFixed(1)}`).join(' ');
  const rising = up == null ? v[v.length - 1] >= v[0] : up;
  const c = rising ? 'var(--up)' : 'var(--down)';
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline pathLength="1" points="${pts}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

// Update a row by swapping only the child elements whose markup changed (a new price should not
// rebuild the sparkline next to it), and flash the value green/red when it moves.
const tpl = document.createElement('template');
function setVal(el, key, value, html) {
  const prev = last[key];
  if (el._html === html) return;
  el._html = html;
  tpl.innerHTML = html;
  const next = [...tpl.content.children];
  next.forEach((n) => { n._h = n.outerHTML; });
  if (el.children.length !== next.length) {
    el.replaceChildren(...next);
  } else {
    next.forEach((n, i) => { const cur = el.children[i]; if (cur._h !== n._h) cur.replaceWith(n); });
  }
  if (prev != null && value != null && value !== prev) {
    const v = el.querySelector('.val') || el;
    v.classList.remove('flash-up', 'flash-down');
    void v.offsetWidth;
    v.classList.add(value > prev ? 'flash-up' : 'flash-down');
  }
  last[key] = value;
}

function rowEl(container, key, cols) {
  let el = container.querySelector(`[data-k="${key}"]`);
  if (!el) {
    el = document.createElement('div');
    el.dataset.k = key;
    container.appendChild(el);
  }
  el.className = 'row';
  if (cols) el.style.gridTemplateColumns = cols;
  return el;
}

// ---------------------------------------------------------------- markets

function renderMarkets() {
  const c = S.crypto;
  const coins = (S.config && S.config.crypto) || Object.keys(c);
  const btc = c[coins[0]];
  const hero = $('hero');
  hero.className = 'hero' + stale(btc.at, 60000);
  if (!hero.dataset.built) {
    hero.innerHTML = '<div class="top"><span class="sym" id="heroSym"></span><span id="heroChg"></span></div><div class="price"><span class="odo" id="heroPrice"></span></div><div class="meta" id="heroMeta"></div><div id="heroSpark"></div>';
    hero.dataset.built = '1';
  }
  $('heroSym').textContent = `${coins[0]} / USDT`;
  $('heroChg').innerHTML = chg(pct(btc.price, btc.open24h));
  odometer($('heroPrice'), usd(btc.price));
  $('heroMeta').innerHTML = `<span>24h low ${usd(btc.low24h)}</span><span>high ${usd(btc.high24h)}</span>`;
  const sk = spark(btc.spark, 266, 54);
  if ($('heroSpark').dataset.sig !== sk.length + ':' + btc.spark.length) { $('heroSpark').innerHTML = sk; $('heroSpark').dataset.sig = sk.length + ':' + btc.spark.length; }

  const rows = $('cryptoRows');
  for (const s of coins.slice(1, 6)) {
    const x = c[s];
    if (!x) continue;
    const el = rowEl(rows, s);
    el.className += stale(x.at, 60000);
    setVal(el, s, x.price, `<span class="label">${s}</span>${spark(x.spark)}<span class="val">${usd(x.price)}</span>${chg(pct(x.price, x.open24h))}`);
  }

  const y = S.yahoo || {};
  const m = S.metals || {};
  const gold = $('goldRows');
  let el = rowEl(gold, 'xau');
  el.className += stale(m.at, 120000);
  setVal(el, 'xau', m.xau, `<span class="label">Gold<small>XAU/USD · oz</small></span><span class="val">${usd(m.xau)}</span>${chg(y.gold ? pct(y.gold.price, y.gold.prev) : null)}`);
  el = rowEl(gold, 'xag');
  el.className += stale(m.at, 120000);
  setVal(el, 'xag', m.xag, `<span class="label">Silver<small>XAG/USD · oz</small></span><span class="val">${num(m.xag, 2)}</span>${chg(y.silver ? pct(y.silver.price, y.silver.prev) : null)}`);
  for (const g of S.vngold.items || []) {
    el = rowEl(gold, g.code, '1fr auto');
    el.className += stale(S.vngold.at, 15 * 60000);
    el.lang = 'vi';
    const [name, sub] = g.code === 'SJC' ? ['SJC', 'vàng miếng · tr/lượng'] : ['Nhẫn', '9999 · tr/lượng'];
    setVal(el, g.code, g.sell, `<span class="label">${name}<small>${sub}</small></span>
      <span class="pair"><span><i>mua</i>${millions(g.buy)}</span><span class="val"><i>bán</i>${millions(g.sell)}</span></span>`);
  }

  const fx = $('fxRows');
  const r = (S.fx && S.fx.rates) || {};
  const fxAt = S.fx && S.fx.at;
  const vcb = (code, label) => {
    const q = r[code] || {};
    const e = rowEl(fx, code, '1fr auto');
    e.className += stale(fxAt, 15 * 60000);
    e.lang = 'vi';
    setVal(e, 'fx-' + code, q.sell, `<span class="label">${label}<small>Vietcombank</small></span>
      <span class="pair"><span><i>mua</i>${vnd(q.transfer ?? q.buy)}</span><span class="val"><i>bán</i>${vnd(q.sell)}</span></span>`);
  };
  vcb('USD', 'USD');
  const ib = y.usdvnd || {};
  el = rowEl(fx, 'usdvnd-ib');
  el.className += stale(ib.at, 5 * 60000);
  el.lang = 'vi';
  setVal(el, 'usdvnd-ib', ib.price, `<span class="label">USD<small>liên ngân hàng</small></span><span class="val">${vnd(ib.price)}</span>${chg(pct(ib.price, ib.prev))}`);
  vcb('EUR', 'EUR');

  const idx = $('indexRows');
  for (const { key: k, name, sub, decimals } of (S.config && S.config.indices) || []) {
    const q = y[k] || {};
    el = rowEl(idx, k, '1fr auto auto auto');
    el.className += stale(q.at, 5 * 60000);
    setVal(el, 'i-' + k, q.price, `<span class="label">${esc(name)}<small>${esc(sub || '')}</small></span>${spark(q.spark, 44, 18, q.price >= q.prev)}<span class="val">${num(q.price, decimals ?? 2)}</span>${chg(pct(q.price, q.prev))}`);
  }
}

// ---------------------------------------------------------------- markets zoom (preset buttons 1-4 on the Markets page)

let zoom = 0; // 0 closed, 1 BTC, 2 gold, 3 FX, 4 indices
function tile(name, sub, value, extra = '') {
  return `<div class="zt"><span class="zn">${name}<small>${sub}</small></span><b class="zv">${value}</b>${extra}</div>`;
}
function renderZoom() {
  const z = $('mzoom');
  z.className = zoom ? `mzoom on z${zoom}` : 'mzoom';
  if (!zoom || !S) return;
  const y = S.yahoo || {}, m = S.metals || {}, r = (S.fx && S.fx.rates) || {};
  let html = '';
  if (zoom === 1) {
    const coin = ((S.config && S.config.crypto) || ['BTC'])[0], c = S.crypto[coin];
    html = `<div class="zh">${coin} / USDT ${chg(pct(c.price, c.open24h))}</div>
      <div class="zbig">${usd(c.price)}</div>
      <div class="zmeta"><span>24h low ${usd(c.low24h)}</span><span>open ${usd(c.open24h)}</span><span>high ${usd(c.high24h)}</span></div>
      <div class="zchart">${spark(c.spark, 760, 210)}</div>`;
  } else if (zoom === 2) {
    const items = S.vngold.items || [];
    const vn = (code, name) => { const g = items.find((x) => x.code === code) || {}; return tile(name, 'triệu đ / lượng', `<i>mua</i> ${millions(g.buy)} <i>bán</i> ${millions(g.sell)}`); };
    html = `<div class="zh">Gold &amp; Silver</div><div class="zgrid g2">
      ${tile('Gold', 'XAU/USD · oz', usd(m.xau), chg(y.gold ? pct(y.gold.price, y.gold.prev) : null))}
      ${tile('Silver', 'XAG/USD · oz', num(m.xag, 2), chg(y.silver ? pct(y.silver.price, y.silver.prev) : null))}
      ${vn('SJC', 'Vàng SJC')}${vn('N24K', 'Nhẫn 9999')}</div>
      <div class="zchart small">${spark(y.gold && y.gold.spark, 760, 90)}</div>`;
  } else if (zoom === 3) {
    const vcb = (code) => { const q = r[code] || {}; return tile(code, 'Vietcombank', `<i>mua</i> ${vnd(q.transfer ?? q.buy)} <i>bán</i> ${vnd(q.sell)}`); };
    const ib = y.usdvnd || {};
    html = `<div class="zh" lang="vi">Tỷ giá VND</div><div class="zgrid g3">
      ${vcb('USD')}${tile('USD', 'liên ngân hàng', vnd(ib.price), chg(pct(ib.price, ib.prev)))}${vcb('EUR')}
      ${vcb('JPY')}${vcb('CNY')}${vcb('AUD')}${vcb('GBP')}${vcb('SGD')}${vcb('KRW')}</div>`;
  } else if (zoom === 4) {
    html = `<div class="zh">Indices</div><div class="zgrid g3">${((S.config && S.config.indices) || []).map(({ key, name, sub, decimals }) => {
      const q = y[key] || {};
      return tile(esc(name), esc(sub || ''), num(q.price, decimals ?? 2), chg(pct(q.price, q.prev)) + `<span class="zs">${spark(q.spark, 200, 40, q.price >= q.prev)}</span>`);
    }).join('')}</div>`;
  }
  if (z._html !== html) { z._html = html; z.innerHTML = html; }
}
function marketZoom(n) { zoom = zoom === n ? 0 : n; renderZoom(); }

// ---------------------------------------------------------------- preset buttons: what 1-4 do depends on the page

function presetButton(n) {
  if (setMode) return;
  if (page === NEWS) { const i = n === 4 ? newsCat + 1 : newsFeeds().findIndex((f) => f.key === NEWS_BUTTONS[n - 1]); return newsTopic(i); }
  if (page === MARKETS) return marketZoom(n);
  if (page === MUSIC) return spotifyAction(['prev', 'toggle', 'next', 'like'][n - 1]);
  if (page === FOCUS) return pomoSet([15, 25, 45, 60][n - 1]);
}

// ---------------------------------------------------------------- alerts (banner on every page, history on Settings)

let alertSeen = null;
let bannerTimer = null;
function renderAlerts() {
  const list = S.alerts || [];
  const newest = list[0];
  if (alertSeen === null) alertSeen = newest ? newest.id : 0; // do not replay old alerts after a reload
  if (newest && newest.id > alertSeen) {
    alertSeen = newest.id;
    const b = $('alertBanner');
    b.className = `alert-banner on ${newest.dir}`;
    b.textContent = `${newest.dir === 'up' ? '▲' : '▼'} ${newest.text}`;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('on'), 30000);
  }
}

// ---------------------------------------------------------------- weather

const WMO = {
  0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'],
  80: ['Light showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Heavy showers', '⛈️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'],
};
const wmo = (c) => WMO[c] || ['—', '🌡️'];
function aqiLabel(a) {
  if (a == null) return ['—', 'var(--muted)'];
  if (a <= 50) return ['Good', 'var(--up)'];
  if (a <= 100) return ['Moderate', 'var(--gold)'];
  if (a <= 150) return ['Unhealthy (sensitive)', '#ff9f43'];
  if (a <= 200) return ['Unhealthy', 'var(--down)'];
  if (a <= 300) return ['Very unhealthy', '#b05cff'];
  return ['Hazardous', '#8e2440'];
}
const hourLabel = (t) => {
  const h = Number(t.slice(11, 13));
  return `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;
};

function renderWeather() {
  const w = S.weather;
  if (!w) return;
  const u = S.units || { temp: '°F', wind: 'mph' };
  const cur = w.current;
  const [desc, icon] = wmo(cur.weather_code);
  const c = cur.weather_code;
  document.body.dataset.sky = c >= 51 ? 'rain' : !cur.is_day ? 'night' : c >= 2 ? 'cloudy' : 'clear';
  const a = S.aqi || {};
  const [al, ac] = aqiLabel(a.us_aqi);
  $('wxNow').className = 'wx-now' + stale(w.at, 30 * 60000);
  $('wxNow').innerHTML = `
    <div class="icon">${cur.is_day ? icon : icon.replace('☀️', '🌙').replace('🌤️', '🌙')}</div>
    <div><div class="temp">${Math.round(cur.temperature_2m)}°</div></div>
    <div><div class="desc">${desc} · ${S.city}</div>
      <div class="sub">Feels like ${Math.round(cur.apparent_temperature)}° · Humidity ${cur.relative_humidity_2m}%<br>
      Wind ${Math.round(cur.wind_speed_10m)} ${u.wind} · UV ${a.uv_index != null ? num(a.uv_index, 0) : '—'}<br>
      Today ${Math.round(w.daily[0].min)}° – ${Math.round(w.daily[0].max)}${u.temp}</div></div>
    <div class="aqi"><div class="l">AQI (US)</div><div class="n" style="color:${ac}">${a.us_aqi ?? '—'}</div><div class="l">${al} · PM2.5 ${a.pm2_5 != null ? num(a.pm2_5, 0) : '—'}</div></div>`;
  $('wxHourly').innerHTML = w.hourly.map((h) => `<div>${hourLabel(h.t)}<span>${wmo(h.code)[1]}</span><b>${Math.round(h.temp)}°</b>${h.pop ?? 0}%</div>`).join('');
  const dn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  $('wxDaily').innerHTML = w.daily.map((d, i) => {
    const day = i === 0 ? 'Today' : dn[new Date(d.t + 'T12:00:00Z').getUTCDay()];
    return `<div class="day"><span class="ic">${wmo(d.code)[1]}</span><div class="tx">${day} · ${d.pop ?? 0}% rain<b>${Math.round(d.min)}° – ${Math.round(d.max)}°</b></div></div>`;
  }).join('');
}

// ---------------------------------------------------------------- news

let newsCat = 0, newsShownKey = '', newsShown = '', newsRotate = 0;
let newsSel = -1;      // story highlighted while browsing with the knob (-1: not browsing)
let newsDetail = null; // id of the story whose summary is open
const NEWS_BUTTONS = ['top', 'research', 'business']; // presets 1-3; preset 4 = next topic
const summaries = new Map();
function ago(t) {
  if (!t) return '';
  const m = Math.max(0, Math.round((now() - t) / 60000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}
const newsFeeds = () => (S && S.news && S.news.feeds) || [];
const newsItems = () => { const f = newsFeeds()[newsCat]; return f ? f.items.slice(0, 6) : []; };

function renderNews() {
  const feeds = newsFeeds();
  if (!feeds.length) return;
  newsCat = (newsCat + feeds.length) % feeds.length;
  const f = feeds[newsCat];
  const btn = (k) => { const i = NEWS_BUTTONS.indexOf(k); return i >= 0 ? `<i class="kb">${i + 1}</i>` : ''; };
  const track = $('newsTrack');
  const chips = feeds.map((x, i) => `<span class="nc ${i === newsCat ? 'on' : ''}">${btn(x.key)}${esc(x.name)}</span>`).join('') + '<span class="nc nc-next"><i class="kb">4</i>next topic</span>';
  if (track._html !== chips) {
    track._html = chips;
    track.innerHTML = chips;
    // slide the strip so the chosen topic stays in view
    const on = track.querySelector('.nc.on');
    const shift = Math.max(0, Math.min(on.offsetLeft - 70, track.scrollWidth - $('newsCats').clientWidth));
    track.style.transform = `translate3d(${-shift}px,0,0)`;
  }
  $('newsUp').textContent = f.at ? `updated ${now() - f.at < 60000 ? 'just now' : ago(f.at)}` : '';
  const items = newsItems();
  if (newsSel >= items.length) newsSel = items.length - 1;
  const html = items.length
    ? items.map((h, i) => `<div class="nh ${i === newsSel ? 'sel' : ''}" data-i="${i}"><b>${esc(h.title)}</b><span>${esc(h.source || '')}${h.at ? ` · ${ago(h.at)}` : ''}${h.score ? ` · ${h.score} points` : ''}</span></div>`).join('')
    : '<div class="nh empty">Loading headlines…</div>';
  if (html !== newsShown) {
    newsShown = html;
    $('newsList').innerHTML = html;
    if (f.key !== newsShownKey) { // animate only when the topic changes, not when the highlight moves
      newsShownKey = f.key;
      $('newsList').classList.remove('swap'); void $('newsList').offsetWidth; $('newsList').classList.add('swap');
    }
  }
}

function showDetail(d, item) {
  $('ndMeta').textContent = [item.source, item.at ? ago(item.at) : '', d && d.host && d.host !== item.source ? d.host : ''].filter(Boolean).join(' · ');
  $('ndTitle').textContent = item.title;
  const sum = $('ndSum');
  if (!d) { sum.className = 'nd-sum loading'; sum.textContent = 'Reading the article and summarising…'; return; }
  sum.className = d.error ? 'nd-sum err' : 'nd-sum';
  sum.textContent = d.error ? `Could not summarise this story: ${d.error}` : d.summary;
}
function openDetail(i) {
  const items = newsItems();
  if (!items.length) return;
  newsSel = Math.max(0, Math.min(items.length - 1, i));
  const item = items[newsSel];
  newsDetail = item.id;
  $('ndetail').classList.add('on');
  renderNews();
  if (summaries.has(item.id)) return showDetail(summaries.get(item.id), item);
  showDetail(null, item);
  fetch(`/api/news/detail?id=${encodeURIComponent(item.id)}`)
    .then((r) => r.json())
    .catch(() => ({ error: 'the hub did not answer' }))
    .then((d) => { if (!d.error) summaries.set(item.id, d); if (newsDetail === item.id) showDetail(d, item); });
}
function closeDetail() { newsDetail = null; $('ndetail').classList.remove('on'); }
function newsKnob(step) {
  const n = newsItems().length;
  if (!n) return;
  const next = Math.max(0, Math.min(n - 1, newsSel + step));
  if (newsDetail) return openDetail(next);
  newsSel = next; renderNews();
}
function newsEnter() {
  if (newsDetail) return;
  if (newsSel < 0) { newsSel = 0; return renderNews(); }
  openDetail(newsSel);
}
function newsBack() {
  if (newsDetail) { closeDetail(); return true; }
  if (newsSel >= 0) { newsSel = -1; renderNews(); return true; }
  return false;
}
function newsTopic(i) {
  closeDetail(); newsSel = -1; newsCat = i; newsRotate = Date.now(); renderNews();
}
$('newsList').addEventListener('click', (e) => { const el = e.target.closest('.nh'); if (el && el.dataset.i) openDetail(Number(el.dataset.i)); });
$('ndetail').addEventListener('click', closeDetail);
// topics rotate on their own every 15 s while nobody is reading
setInterval(() => { if (page === NEWS && newsSel < 0 && !newsDetail && S && Date.now() - newsRotate > 15000) { newsCat++; renderNews(); } }, 15000);

// ---------------------------------------------------------------- servers

const gb = (b) => (b == null ? '—' : nf(1).format(b / 1073741824) + ' GB');
function dur(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
function meter(k, ratio, text, highIsGood = false) {
  const p = Math.max(0, Math.min(1, ratio || 0)) * 100;
  const risk = highIsGood ? 100 - p : p;
  const cls = risk > 90 ? 'bad' : risk > 75 ? 'warn' : '';
  return `<div class="meter"><span class="k">${k}</span><div class="track"><div class="fill ${cls}" style="width:${p}%"></div></div><span class="v">${text}</span></div>`;
}
const degF = (c) => (c == null ? '—' : (S.units && S.units.temp === '°C' ? `${num(c, 0)}°C` : `${num(c * 9 / 5 + 32, 0)}°F`));

function statsBlock(st, extra = '') {
  return `
    ${meter('CPU', (st.cpu || 0) / 100, `${num(st.cpu, 0)}%`)}
    ${meter('Memory', st.memUsed / st.memTotal, gb(st.memUsed))}
    ${meter('Disk', st.diskUsed / st.diskTotal, gb(st.diskUsed))}
    ${extra}
    <div class="kv"><span>Temperature</span><b>${degF(st.temp)}</b></div>
    <div class="kv"><span>Load (1/5/15)</span><b>${(st.load || []).map((l) => num(l, 2)).join(' · ')}</b></div>
    <div class="kv"><span>Uptime</span><b>${dur(st.uptime || 0)}</b></div>`;
}

// running = fine; exited/created/paused = stopped (amber); unhealthy/restarting/dead = problem (red)
function containersBlock(c) {
  if (!c || !c.list || now() - c.at > 60000) return '<div class="ct"><div class="ct-sum">Containers <b>—</b></div></div>';
  const bad = c.list.filter((x) => x.health === 'unhealthy' || x.state === 'restarting' || x.state === 'dead');
  const stopped = c.list.filter((x) => !bad.includes(x) && x.state !== 'running');
  const running = c.list.length - bad.length - stopped.length;
  const lines = [
    ...bad.map((x) => `<div class="ct-bad">✖ ${esc(x.name)} · ${esc(x.health === 'unhealthy' ? 'unhealthy' : x.state)}</div>`),
    ...stopped.map((x) => `<div class="ct-stop">■ ${esc(x.name)} · ${esc(x.status)}</div>`),
  ];
  return `<div class="ct">
    <div class="ct-sum">Containers <b>${running} running</b>${stopped.length ? ` · <span class="ct-stop">${stopped.length} stopped</span>` : ''}${bad.length ? ` · <span class="ct-bad">${bad.length} failing</span>` : ''}${!bad.length && !stopped.length ? ' <span class="ct-ok">✓ all up</span>' : ''}</div>
    ${lines.slice(0, 4).join('')}${lines.length > 4 ? `<div class="ct-more">+${lines.length - 4} more</div>` : ''}
  </div>`;
}

function renderServers() {
  const s2 = S.servers.server2;
  if (s2) {
    $('srv2').className = 'srv' + stale(s2.at, 30000);
    $('srv2').innerHTML = `
      <div class="head"><div><b>Server 2</b> <span>${s2.ip} · laptop</span></div><span class="state up">Online</span></div>
      ${statsBlock(s2, s2.battery != null ? meter('Battery', s2.battery / 100, `${s2.battery}%`, true) : '')}
      ${containersBlock(s2.containers)}`;
  }
  const s1 = S.servers.server1;
  if (s1) {
    const st = s1.stats && now() - s1.stats.at < 60000 ? s1.stats : null;
    $('srv1').className = 'srv' + stale(s1.at, 60000);
    $('srv1').innerHTML = `
      <div class="head"><div><b>Server 1</b> <span>${s1.ip} · BRIX</span></div><span class="state ${s1.online ? 'up' : 'down'}">${s1.online ? 'Online' : 'Offline'}</span></div>
      ${st ? statsBlock(st) : `<div class="note">No stats from the server 1 agent yet.</div>`}
      <div class="kv"><span>Network latency</span><b>${s1.online ? num(s1.latency, 1) + ' ms' : '—'}</b></div>
      ${containersBlock(st && st.containers)}`;
  }
}

// ---------------------------------------------------------------- focus timer (client side)

function load(k, d) { try { return Object.assign(d, JSON.parse(localStorage.getItem(k) || '{}')); } catch { return d; } }
const pomo = load('pomo', { focusMin: 25, mode: 'focus', running: false, endsAt: 0, left: 25 * 60, done: 0 });
function savePomo() { try { localStorage.setItem('pomo', JSON.stringify(pomo)); } catch {} }
const modeLen = () => (pomo.mode === 'focus' ? pomo.focusMin * 60 : pomo.done % 4 === 0 && pomo.done ? 15 * 60 : 5 * 60);
function pomoTick() {
  if (pomo.running) {
    pomo.left = Math.max(0, Math.round((pomo.endsAt - Date.now()) / 1000));
    if (pomo.left === 0) {
      if (pomo.mode === 'focus') pomo.done++;
      pomo.mode = pomo.mode === 'focus' ? 'break' : 'focus';
      pomo.left = modeLen();
      pomo.endsAt = Date.now() + pomo.left * 1000;
      toast(pomo.mode === 'focus' ? 'Break over — back to focus' : 'Session done — take a break');
      setPage(FOCUS);
      savePomo();
    }
  }
  const mm = String(Math.floor(pomo.left / 60)).padStart(2, '0'), ss = String(pomo.left % 60).padStart(2, '0');
  $('pomoTime').textContent = `${mm}:${ss}`;
  $('pomoTime').className = 'pomo-time ' + (pomo.running ? 'running' : 'paused');
  $('pomoMode').textContent = (pomo.mode === 'focus' ? 'Focus' : 'Break') + (pomo.running ? '' : ' · paused');
  $('pomoFill').style.width = `${100 * (1 - pomo.left / modeLen())}%`;
  pages[FOCUS].classList.toggle('break', pomo.mode !== 'focus');
  $('pomoCount').textContent = `${pomo.done} session${pomo.done === 1 ? '' : 's'} completed`;
}
function pomoToggle() {
  pomo.running = !pomo.running;
  if (pomo.running) pomo.endsAt = Date.now() + pomo.left * 1000;
  savePomo(); pomoTick();
}
function pomoSet(min) {
  if (pomo.running) return toast('Pause the timer to change its length');
  pomo.mode = 'focus';
  pomo.focusMin = min;
  pomo.left = min * 60;
  savePomo(); pomoTick();
  toast(`Focus · ${min} min`);
}
function pomoAdjust(step) {
  if (pomo.running) return toast('Pause the timer to change its length');
  pomo.mode = 'focus';
  pomo.focusMin = Math.max(5, Math.min(90, pomo.focusMin + step * 5));
  pomo.left = pomo.focusMin * 60;
  savePomo(); pomoTick();
}

// ---------------------------------------------------------------- brightness

let brightPending = null;
function renderBrightness() {
  const b = brightPending ?? (S && S.display && S.display.brightness);
  $('brightVal').textContent = b == null ? '--%' : `${b}%`;
  $('brightFill').style.width = `${b || 0}%`;
}
let brightTimer = null;
function brightAdjust(step) {
  const curr = brightPending ?? (S && S.display ? S.display.brightness : 80);
  brightPending = Math.max(5, Math.min(100, curr + step * 5));
  renderBrightness();
  clearTimeout(brightTimer);
  brightTimer = setTimeout(() => {
    fetch('/api/brightness', { method: 'POST', body: JSON.stringify({ pct: brightPending }) })
      .then((r) => { if (!r.ok) toast('Brightness can only be changed on the Car Thing'); })
      .catch(() => toast('Could not reach the hub'))
      .finally(() => { brightPending = null; });
  }, 250);
}

// ---------------------------------------------------------------- music (Spotify)

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.6v12.8a1.1 1.1 0 0 0 1.7.9l9.8-6.4a1.1 1.1 0 0 0 0-1.8L9.7 4.7A1.1 1.1 0 0 0 8 5.6z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.4" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.4" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.3C19.5 15.4 12 20 12 20z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
  hearted: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.3C19.5 15.4 12 20 12 20z" fill="currentColor"/></svg>',
};
const setIcon = (el, name) => { if (el.dataset.icon !== name) { el.innerHTML = ICON[name]; el.dataset.icon = name; } };
setIcon($('mPlay'), 'play');
setIcon($('mLike'), 'heart');

const mmss = (ms) => { const s = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let shownArt = null;

function musicProgress() {
  const sp = S && S.spotify;
  const p = sp && sp.player;
  if (!p) return;
  const pos = Math.min(p.duration, p.progress + (p.isPlaying ? now() - sp.at : 0));
  $('mFill').style.width = `${(100 * pos) / (p.duration || 1)}%`;
  $('mPos').textContent = mmss(pos);
  $('mDur').textContent = mmss(p.duration);
}

function renderMusic() {
  const sp = S.spotify || {};
  const p = sp.player;
  if (!sp.configured || !sp.linked) {
    $('mTitle').textContent = 'Spotify not linked';
    $('mArtist').textContent = 'Linking is done once from a browser on the LAN.';
    $('mAlbum').textContent = '';
    $('mDev').textContent = '';
    return;
  }
  if (!p) {
    $('mTitle').textContent = 'Nothing playing';
    $('mArtist').textContent = 'Start Spotify on any device, then control it here.';
    $('mAlbum').textContent = '';
    $('mDev').textContent = sp.error ? `Spotify: ${sp.error}` : '';
    setIcon($('mPlay'), 'play');
    return;
  }
  if (p.art !== shownArt) {
    shownArt = p.art;
    $('mArt').style.backgroundImage = p.art ? `url("/api/spotify/art?u=${encodeURIComponent(p.art)}")` : 'none';
  }
  $('mTitle').textContent = p.title;
  $('mArtist').textContent = p.artist;
  $('mAlbum').textContent = p.album;
  setIcon($('mPlay'), p.isPlaying ? 'pause' : 'play');
  setIcon($('mLike'), sp.liked ? 'hearted' : 'heart');
  $('mLike').parentElement.classList.toggle('on', !!sp.liked);
  const d = p.device;
  $('mDev').textContent = d ? `${d.name}${d.canVolume && d.volume != null ? ` · volume ${d.volume}%` : ''}` : '';
  musicProgress();
}

function spotifyAction(act, body) {
  fetch(`/api/spotify/${act}`, { method: 'POST', body: JSON.stringify(body || {}) })
    .then((r) => { if (!r.ok) return r.text().then((t) => toast(r.status === 403 ? 'Controls work on the Car Thing only' : `Spotify: ${t || r.status}`)); })
    .catch(() => toast('Could not reach the hub'));
}

let volTimer = null, volDelta = 0;
function volumeAdjust(step) {
  const d = S && S.spotify && S.spotify.player && S.spotify.player.device;
  if (!d || !d.canVolume) return toast('This device does not allow volume control');
  volDelta += step * 5;
  d.volume = Math.max(0, Math.min(100, (d.volume || 0) + step * 5));
  renderMusic();
  clearTimeout(volTimer);
  volTimer = setTimeout(() => { spotifyAction('volume', { delta: volDelta }); volDelta = 0; }, 300);
}

document.querySelectorAll('.m-ctrl button').forEach((b) => b.addEventListener('click', () => spotifyAction(b.dataset.act)));

// ---------------------------------------------------------------- ask: Mei, the desk cat (voice assistant)

const MIT_SVG = `
<svg viewBox="0 0 130 96" class="mit-svg" aria-hidden="true">
  <path class="tail" d="M30 58 C 12 56, 6 38, 14 24" fill="none" stroke="#f2a627" stroke-width="9" stroke-linecap="round"/>
  <g class="legs">
    <rect class="leg la" x="36" y="62" width="9" height="22" rx="4.5" fill="#e8971c"/>
    <rect class="leg lb" x="48" y="62" width="9" height="22" rx="4.5" fill="#f6b93b"/>
    <rect class="leg lb" x="74" y="62" width="9" height="22" rx="4.5" fill="#e8971c"/>
    <rect class="leg la" x="86" y="62" width="9" height="22" rx="4.5" fill="#f6b93b"/>
  </g>
  <ellipse cx="64" cy="58" rx="36" ry="21" fill="#f6b93b"/>
  <path d="M52 40 q4 9 0 18 M64 38 q4 10 0 20 M76 40 q4 9 0 18" stroke="#e39219" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <ellipse cx="66" cy="66" rx="22" ry="9" fill="#fde3a7"/>
  <g class="head">
    <polygon class="ear" points="86,22 92,2 104,18" fill="#f6b93b"/>
    <polygon class="ear" points="108,18 120,4 122,26" fill="#f6b93b"/>
    <polygon points="90,18 93,8 100,17" fill="#ff9bb0"/>
    <polygon points="111,18 118,9 119,23" fill="#ff9bb0"/>
    <circle cx="104" cy="38" r="22" fill="#f6b93b"/>
    <path d="M96 20 q2 6 0 10 M106 18 q2 6 0 10" stroke="#e39219" stroke-width="3" fill="none" stroke-linecap="round"/>
    <g class="eyes"><ellipse cx="97" cy="37" rx="3.6" ry="4.6" fill="#2b2b2b"/><ellipse cx="114" cy="37" rx="3.6" ry="4.6" fill="#2b2b2b"/>
      <circle cx="98.2" cy="35.4" r="1.3" fill="#fff"/><circle cx="115.2" cy="35.4" r="1.3" fill="#fff"/></g>
    <ellipse cx="92" cy="46" rx="4" ry="2.4" fill="#ff9bb0" opacity=".7"/><ellipse cx="119" cy="46" rx="4" ry="2.4" fill="#ff9bb0" opacity=".7"/>
    <path d="M104 43 l-2.6 -2.2 h5.2 z" fill="#ff7a93"/>
    <path class="mouth" d="M104 44 q-3 4 -6 1 M104 44 q3 4 6 1" stroke="#7a4a12" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M90 44 h-14 M90 47 l-13 4 M118 44 h14 M118 47 l13 4" stroke="#7a4a12" stroke-width="1.2" stroke-linecap="round"/>
  </g>
</svg>`;

// the actors on this page live in stage.js (window.stage would be the #stage element itself)
function mitStart() { if (window.meiStage) window.meiStage.start(); }

function renderAsk() {
  const v = S.voice || {};
  const phase = v.phase || 'idle';
  pages[ASK].dataset.phase = phase;
  const secs = phase === 'listening' && v.startedAt ? Math.min(v.maxSeconds, Math.floor((now() - v.startedAt) / 1000)) : 0;
  $('askChip').textContent = v.configured === false ? 'needs a key' : { idle: 'ready', starting: 'getting ready', listening: `listening · ${secs}s`, thinking: 'thinking', answer: 'answered', error: 'oops' }[phase];
  $('askHint').textContent = v.configured === false
    ? 'Gemini API key not set on the hub yet'
    : { idle: 'Press the knob and ask me anything', starting: 'Waking up the microphone… start talking when it says Listening', listening: `Press the knob when you are done · max ${v.maxSeconds}s`, thinking: 'Hmm, let me think…', answer: 'Press the knob to ask again', error: 'Press the knob to try again' }[phase];
  const bubble = $('askBubble');
  if (phase === 'answer' || phase === 'error') {
    bubble.className = `ask-bubble on ${phase}`;
    $('askQ').textContent = v.transcript ? `“${v.transcript}”` : '';
    $('askA').textContent = phase === 'error' ? v.error : v.answer;
    const src = phase === 'answer' ? [
      (v.searches || []).length ? `Searched Google: ${v.searches.join(' · ')}` : '',
      (v.sources || []).length ? `Sources: ${v.sources.join(', ')}` : '',
    ].filter(Boolean).join('\n') : '';
    $('askSrc').textContent = src;
  } else {
    bubble.className = 'ask-bubble';
  }
  $('askHello').style.display = phase === 'idle' ? '' : 'none';
  $('askMeter').style.width = `${(100 * secs) / (v.maxSeconds || 15)}%`;
}

function askToggle() {
  const phase = S && S.voice && S.voice.phase;
  if (phase === 'thinking') return;
  const act = phase === 'listening' || phase === 'starting' ? 'stop' : 'start';
  fetch(`/api/voice/${act}`, { method: 'POST' })
    .then((r) => { if (!r.ok) toast(r.status === 403 ? 'Mei only listens on the Car Thing' : 'Assistant unavailable'); })
    .catch(() => toast('Could not reach the hub'));
}


// ---------------------------------------------------------------- quick menu (round settings button, top right)

let setMode = null; // null (closed) | 'menu' | 'bright' | 'confirm'
let setIdx = 0;     // 0 brightness, 1 restart, 2 shut down, 3 rotate
let setTimer = null;

function renderSettings() {
  $('overlay').classList.toggle('on', setMode != null);
  document.querySelectorAll('.ov-tile').forEach((el, i) => {
    el.classList.toggle('sel', i === setIdx);
    el.classList.toggle('confirm', setMode === 'confirm' && i === setIdx);
  });
  $('ovSlider').classList.toggle('active', setMode === 'bright');
  $('setHint').textContent = setMode === 'bright'
    ? 'Turn the knob to change brightness · press the knob or Back when done'
    : setMode === 'confirm'
      ? `Press the knob again to ${setIdx === 1 ? 'restart' : 'shut down'} · Back to cancel`
      : 'Turn the knob to choose · press the knob to select · Back to close';
}

function setModeTo(m) {
  setMode = m;
  renderSettings();
  renderBrightness();
  clearTimeout(setTimer);
  if (m) setTimer = setTimeout(() => setModeTo(null), 20000);
}

function deviceAction(act) {
  fetch(`/api/device/${act}`, { method: 'POST' })
    .then((r) => toast(r.ok ? (act === 'reboot' ? 'Restarting the Car Thing…' : 'Shutting down — unplug and replug to start again') : 'Only the Car Thing can do this'))
    .catch(() => toast('Could not reach the hub'));
  setModeTo(null);
}

function settingsKnob(step) {
  if (setMode === 'menu') { setIdx = (setIdx + step + 4) % 4; setModeTo('menu'); }
  else if (setMode === 'bright') { brightAdjust(step); setModeTo('bright'); }
  else if (setMode === 'confirm') setModeTo('menu');
}

function settingsPress() {
  if (setMode === 'menu') { if (setIdx === 3) return rotate(); return setModeTo(setIdx === 0 ? 'bright' : 'confirm'); }
  if (setMode === 'bright') return setModeTo('menu');
  if (setMode === 'confirm') deviceAction(setIdx === 1 ? 'reboot' : 'poweroff');
}

function settingsBack() {
  setModeTo(setMode === 'bright' || setMode === 'confirm' ? 'menu' : null);
}

function settingsButton() {
  if (setMode) return setModeTo(null);
  setIdx = 0;
  setModeTo('menu');
}

// touch: tap a tile, tap the slider to set brightness, tap outside the panel to close
$('overlay').addEventListener('click', (e) => {
  const tile = e.target.closest('.ov-tile');
  const track = e.target.closest('#ovTrack');
  if (track) {
    const r = track.getBoundingClientRect();
    const pct = Math.round(Math.max(5, Math.min(100, ((e.clientX - r.left) / r.width) * 100)) / 5) * 5;
    brightAdjust((pct - (brightPending ?? (S && S.display ? S.display.brightness : 80))) / 5);
    setIdx = 0;
    return setModeTo('bright');
  }
  if (tile) {
    const i = Number(tile.dataset.i);
    if (setMode === 'confirm' && i === setIdx) return deviceAction(i === 1 ? 'reboot' : 'poweroff');
    setIdx = i;
    if (i === 3) return rotate();
    return setModeTo(i === 0 ? 'bright' : 'confirm');
  }
  if (!e.target.closest('.ov-panel')) setModeTo(null);
});

// ---------------------------------------------------------------- motion helpers

// odometer: each digit is a reel of 0-9 that rolls to its new value
function odometer(el, text) {
  if (el.dataset.text === text) return;
  const chars = [...text];
  if (el.children.length !== chars.length || el.dataset.shape !== text.replace(/d/g, '0')) {
    el.innerHTML = chars.map((ch) => (/d/.test(ch)
      ? `<span class="d"><span class="reel">${'0123456789'.split('').map((n) => `<span>${n}</span>`).join('')}</span></span>`
      : `<span class="s">${ch}</span>`)).join('');
    el.dataset.shape = text.replace(/d/g, '0');
  }
  chars.forEach((ch, k) => {
    const reel = el.children[k].firstElementChild;
    if (reel) reel.style.transform = `translateY(-${Number(ch) * 1.05}em)`;
  });
  el.dataset.text = text;
}

function movePill() {
  const on = $('tabs').querySelector('.tab.on');
  if (!on) return;
  const pill = $('tabPill');
  pill.style.width = `${on.offsetWidth}px`;
  pill.style.transform = `translateX(${on.offsetLeft}px)`;
}

function transition(from, to, dir) {
  const tag = dir > 0 ? 'next' : 'prev';
  from.classList.remove('enter-next', 'enter-prev', 'fresh');
  from.classList.add('leaving', `leave-${tag}`);
  setTimeout(() => from.classList.remove('leaving', 'leave-next', 'leave-prev'), 340);
  to.classList.remove('enter-next', 'enter-prev', 'leave-next', 'leave-prev', 'leaving', 'fresh');
  void to.offsetWidth;
  to.classList.add(`enter-${tag}`, 'fresh');
  clearTimeout(to._fx);
  to._fx = setTimeout(() => to.classList.remove('enter-next', 'enter-prev', 'fresh'), 1400);
}

// ---------------------------------------------------------------- screen orientation (landscape, portrait turned right, portrait turned left)

const ORIENTS = ['land', 'cw', 'ccw'];
const ORIENT_NAME = { land: 'Landscape', cw: 'Portrait ↻', ccw: 'Portrait ↺' };
let orient = 'land';
try { orient = ORIENTS.includes(localStorage.getItem('orient')) ? localStorage.getItem('orient') : 'land'; } catch {}
function applyOrient() {
  document.body.dataset.orient = orient;
  document.body.classList.toggle('portrait', orient !== 'land');
  $('rotLabel').textContent = ORIENT_NAME[orient];
  requestAnimationFrame(movePill);
}
function rotate() {
  orient = ORIENTS[(ORIENTS.indexOf(orient) + 1) % ORIENTS.length];
  try { localStorage.setItem('orient', orient); } catch {}
  applyOrient();
  toast(ORIENT_NAME[orient]);
  setModeTo('menu');
}
applyOrient();

// ---------------------------------------------------------------- navigation + input

let editTimer = null;
function setEditing(on) {
  editing = on && pages[page].dataset.editable === '1';
  pages.forEach((p, j) => p.classList.toggle('editing', editing && j === page));
  clearTimeout(editTimer);
  if (editing) editTimer = setTimeout(() => setEditing(false), 20000);
}

function setPage(i) {
  const prev = page;
  page = (i + pages.length) % pages.length;
  setEditing(false);
  if (setMode) setModeTo(null);
  if (zoom) { zoom = 0; renderZoom(); }
  if (newsSel >= 0 || newsDetail) { closeDetail(); newsSel = -1; }
  const dir = page === prev ? 0 : (i > prev ? 1 : -1);
  pages.forEach((p, j) => p.classList.toggle('on', j === page));
  if (dir) transition(pages[prev], pages[page], dir);
  document.body.dataset.page = page;
  // the knob changes pages; the four preset buttons act on the page that is open
  $('tabs').innerHTML = pages.map((p, j) => `<span class="tab ${j === page ? 'on' : ''}">${p.dataset.name}</span>`).join('');
  if (page === ASK) mitStart();
  movePill();
  render();
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('on'), 2500);
}

function knob(step) {
  if (setMode) return settingsKnob(step);
  if (page === NEWS && (newsSel >= 0 || newsDetail)) return newsKnob(step);
  if (!editing) return setPage(page + step);
  setEditing(true); // keep edit mode alive while turning
  if (page === MUSIC) volumeAdjust(step);
  else if (page === FOCUS) pomoAdjust(step);
}

function back() {
  if (setMode) return settingsBack();
  if (page === MARKETS && zoom) return marketZoom(zoom);
  if (page === NEWS && newsBack()) return;
  if (editing) setEditing(false); // Back only ever leaves a mode; the knob press enters one
}

function press() {
  if (setMode) return settingsPress();
  if (page === ASK) askToggle();
  else if (page === NEWS) newsEnter();
  else if (page === MUSIC) setEditing(!editing); // volume mode; play/pause is button 2
  else if (page === FOCUS) pomoToggle();
  else if (editing) setEditing(false);
}

addEventListener('keydown', (e) => {
  const k = e.key;
  if (/^[1-4]$/.test(k)) return presetButton(Number(k));
  if (k === 'm' || k === 'M') return settingsButton(); // the round settings button, top right
  if (k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack') return back();
  if (k === 'Enter' || k === ' ') return press();
  if (k === 'ArrowRight' || k === 'ArrowDown') return knob(1);
  if (k === 'ArrowLeft' || k === 'ArrowUp') return knob(-1);
});

let wheelAcc = 0, wheelAt = 0;
addEventListener('wheel', (e) => {
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  const t = Date.now();
  if (t - wheelAt > 400) wheelAcc = 0;
  wheelAt = t;
  wheelAcc += d;
  if (Math.abs(wheelAcc) >= 1) { knob(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; }
}, { passive: true });

// touch: swipe left/right to change page; tap to talk to Mei or start/pause the focus timer
let tx = null;
addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
addEventListener('touchend', (e) => {
  if (tx == null || setMode) { tx = null; return; }
  const dx = e.changedTouches[0].clientX - tx;
  tx = null;
  if (Math.abs(dx) > 60) setPage(page + (dx < 0 ? 1 : -1));
  else if (page === FOCUS) pomoToggle();
  else if (page === ASK) askToggle();
});

// ---------------------------------------------------------------- clock + data stream

function tickClock() {
  $('clock').textContent = new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(new Date(now()));
  pomoTick();
  musicProgress();
  if (S && page === ASK) renderAsk();
}

const RENDER = { 0: () => renderNews(), 1: () => renderMarkets(), 2: () => renderAsk(), 3: () => renderWeather(), 4: () => renderMusic(), 5: () => renderServers() };
function render() {
  if (!S) return;
  try { RENDER[page] && RENDER[page](); } catch (e) { console.error(e); }
  if (zoom && page === MARKETS) try { renderZoom(); } catch (e) { console.error(e); }
  try { renderAlerts(); } catch (e) { console.error(e); }
  if (setMode) renderBrightness();
  if (!render.sky && S.weather) { render.sky = true; try { renderWeather(); } catch {} } // sky colour on first load
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => $('conn').classList.add('ok');
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    clockOffset = msg.t - Date.now();
    S = msg.state;
    render();
  };
  es.onerror = () => $('conn').classList.remove('ok');
}

renderSettings();
setPage(0);
tickClock();
setInterval(tickClock, 1000);
setInterval(render, 15000);
connect();

'use strict';

const $ = (id) => document.getElementById(id);
const pages = [...document.querySelectorAll('.page')];
// page order: News, Markets, Weather, Calendar, Music, Servers, Focus, Mei (Ask). Settings is a pop-up menu, not a page.
const NEWS = 0, MARKETS = 1, WEATHER = 2, CALENDAR = 3, MUSIC = 4, SERVERS = 5, FOCUS = 6, PHONE = 7, WORDS = 8, ASK = 9;
let page = 0;
let editing = false;
let S = null;
const last = {};

// The Car Thing has no internet and no NTP, so its own clock drifts. Use the hub's clock.
let clockOffset = 0;
const now = () => Date.now() + clockOffset;
const tz = () => (S && S.tz) || 'America/Los_Angeles';

// ---------------------------------------------------------------- formatting

// Intl formatters are slow to create on this CPU (a Markets update made dozens of them): build each one once
const NF = [];
const nf = (d) => NF[d] || (NF[d] = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const DTF = new Map();
function dtf(locale, opts) {
  const k = locale + JSON.stringify(opts);
  let f = DTF.get(k);
  if (!f) DTF.set(k, (f = new Intl.DateTimeFormat(locale, opts)));
  return f;
}
// touch the DOM only when something changed: every write makes the browser restyle and lay out again
const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
const setClass = (el, v) => { if (el.className !== v) el.className = v; };
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
let entering = false; // true while setPage() draws the page that is about to slide in
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
  // no flash on a page that is sliding in: a burst of them at the start of a slide cost frames
  if (prev != null && value != null && value !== prev && !entering) {
    const v = el.querySelector('.val') || el;
    // A tinted glow behind the number fades out: opacity runs on the GPU. (Animating the text colour ran on
    // the main thread, and with prices every half second one was always running, so slides had to wait for it.)
    v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'ease-out', pseudoElement: value > prev ? '::before' : '::after' });
  }
  last[key] = value;
}

// write markup only when it changed: rebuilding a block forces the browser to lay it out and paint it again
// New markup is merged into what is there: only the text nodes and attributes that changed are written,
// so a new number restyles and lays out one line instead of the whole rebuilt block (a page that slid in
// with fresh numbers used to restyle and lay out every element of it, 30-60 ms on this chip).
function setHTML(el, html) {
  if (el._html === html) return;
  const first = el._html === undefined;
  el._html = html;
  if (first || !el.firstChild) { el.innerHTML = html; return; }
  tpl.innerHTML = html;
  morph(el, tpl.content);
}
function morph(cur, next) {
  const a = cur.childNodes, b = [...next.childNodes];
  if (a.length !== b.length) { cur.replaceChildren(...b); return; }
  for (let i = 0; i < b.length; i++) {
    const x = a[i], y = b[i];
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { cur.replaceChild(y, x); continue; }
    if (x.nodeType === 3) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
    if (x.nodeType !== 1 || x.isEqualNode(y)) continue;
    for (const { name, value } of y.attributes) if (x.getAttribute(name) !== value) x.setAttribute(name, value);
    for (const { name } of [...x.attributes]) if (!y.hasAttribute(name)) x.removeAttribute(name);
    // SVG keeps its own namespace and inner structure: replace it whole when it differs
    if (x.namespaceURI !== 'http://www.w3.org/1999/xhtml') { cur.replaceChild(y, x); continue; }
    morph(x, y);
  }
}

function rowEl(container, key, cols) {
  let el = container.querySelector(`[data-k="${key}"]`);
  if (!el) {
    el = document.createElement('div');
    el.dataset.k = key;
    el.className = 'row';
    if (cols) el.style.gridTemplateColumns = cols;
    container.appendChild(el);
  }
  return el;
}

// ---------------------------------------------------------------- markets

function renderMarkets() {
  const c = S.crypto;
  const coins = (S.config && S.config.crypto) || Object.keys(c);
  const btc = c[coins[0]];
  const hero = $('hero');
  setClass(hero, 'hero' + stale(btc.at, 60000));
  if (!hero.dataset.built) {
    hero.innerHTML = '<div class="top"><span class="sym" id="heroSym"></span><span id="heroChg"></span></div><div class="price"><span class="odo" id="heroPrice"></span></div><div class="meta" id="heroMeta"></div><div id="heroSpark"></div>';
    hero.dataset.built = '1';
  }
  setText($('heroSym'), `${coins[0]} / USDT`);
  setHTML($('heroChg'), chg(pct(btc.price, btc.open24h)));
  odometer($('heroPrice'), usd(btc.price));
  setHTML($('heroMeta'), `<span>${tr('24h low')} ${usd(btc.low24h)}</span><span>${tr('high')} ${usd(btc.high24h)}</span>`);
  const sk = spark(btc.spark, 266, 54);
  if ($('heroSpark').dataset.sig !== sk.length + ':' + btc.spark.length) { $('heroSpark').innerHTML = sk; $('heroSpark').dataset.sig = sk.length + ':' + btc.spark.length; }

  const rows = $('cryptoRows');
  for (const s of coins.slice(1, 6)) {
    const x = c[s];
    if (!x) continue;
    const el = rowEl(rows, s);
    setClass(el, 'row' + stale(x.at, 60000));
    setVal(el, s, x.price, `<span class="label">${s}</span>${spark(x.spark)}<span class="val">${usd(x.price)}</span>${chg(pct(x.price, x.open24h))}`);
  }

  const y = S.yahoo || {};
  const m = S.metals || {};
  const gold = $('goldRows');
  let el = rowEl(gold, 'xau');
  setClass(el, 'row' + stale(m.at, 120000));
  setVal(el, 'xau', m.xau, `<span class="label">${tr('Gold')}<small>XAU/USD · oz</small></span><span class="val">${usd(m.xau)}</span>${chg(y.gold ? pct(y.gold.price, y.gold.prev) : null)}`);
  el = rowEl(gold, 'xag');
  setClass(el, 'row' + stale(m.at, 120000));
  setVal(el, 'xag', m.xag, `<span class="label">${tr('Silver')}<small>XAG/USD · oz</small></span><span class="val">${num(m.xag, 2)}</span>${chg(y.silver ? pct(y.silver.price, y.silver.prev) : null)}`);
  for (const g of S.vngold.items || []) {
    el = rowEl(gold, g.code, '1fr auto');
    setClass(el, 'row' + stale(S.vngold.at, 15 * 60000));
    if (el.lang !== 'vi') el.lang = 'vi';
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
    setClass(e, 'row' + stale(fxAt, 15 * 60000));
    if (e.lang !== 'vi') e.lang = 'vi';
    setVal(e, 'fx-' + code, q.sell, `<span class="label">${label}<small>Vietcombank</small></span>
      <span class="pair"><span><i>mua</i>${vnd(q.transfer ?? q.buy)}</span><span class="val"><i>bán</i>${vnd(q.sell)}</span></span>`);
  };
  vcb('USD', 'USD');
  const ib = y.usdvnd || {};
  el = rowEl(fx, 'usdvnd-ib');
  setClass(el, 'row' + stale(ib.at, 5 * 60000));
  if (el.lang !== 'vi') el.lang = 'vi';
  setVal(el, 'usdvnd-ib', ib.price, `<span class="label">USD<small>liên ngân hàng</small></span><span class="val">${vnd(ib.price)}</span>${chg(pct(ib.price, ib.prev))}`);
  vcb('EUR', 'EUR');

  const idx = $('indexRows');
  for (const { key: k, name, sub, decimals } of (S.config && S.config.indices) || []) {
    const q = y[k] || {};
    el = rowEl(idx, k, '1fr auto auto auto');
    setClass(el, 'row' + stale(q.at, 5 * 60000));
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
      <div class="zmeta"><span>${tr('24h low')} ${usd(c.low24h)}</span><span>${tr('open')} ${usd(c.open24h)}</span><span>${tr('high')} ${usd(c.high24h)}</span></div>
      <div class="zchart">${spark(c.spark, 760, 210)}</div>`;
  } else if (zoom === 2) {
    const items = S.vngold.items || [];
    const vn = (code, name) => { const g = items.find((x) => x.code === code) || {}; return tile(name, 'triệu đ / lượng', `<i>mua</i> ${millions(g.buy)} <i>bán</i> ${millions(g.sell)}`); };
    html = `<div class="zh">${esc(tr('Gold & Silver'))}</div><div class="zgrid g2">
      ${tile(tr('Gold'), 'XAU/USD · oz', usd(m.xau), chg(y.gold ? pct(y.gold.price, y.gold.prev) : null))}
      ${tile(tr('Silver'), 'XAG/USD · oz', num(m.xag, 2), chg(y.silver ? pct(y.silver.price, y.silver.prev) : null))}
      ${vn('SJC', 'Vàng SJC')}${vn('N24K', 'Nhẫn 9999')}</div>
      <div class="zchart small">${spark(y.gold && y.gold.spark, 760, 90)}</div>`;
  } else if (zoom === 3) {
    const vcb = (code) => { const q = r[code] || {}; return tile(code, 'Vietcombank', `<i>mua</i> ${vnd(q.transfer ?? q.buy)} <i>bán</i> ${vnd(q.sell)}`); };
    const ib = y.usdvnd || {};
    html = `<div class="zh" lang="vi">Tỷ giá VND</div><div class="zgrid g3">
      ${vcb('USD')}${tile('USD', 'liên ngân hàng', vnd(ib.price), chg(pct(ib.price, ib.prev)))}${vcb('EUR')}
      ${vcb('JPY')}${vcb('CNY')}${vcb('AUD')}${vcb('GBP')}${vcb('SGD')}${vcb('KRW')}</div>`;
  } else if (zoom === 4) {
    html = `<div class="zh">${tr('Indices')}</div><div class="zgrid g3">${((S.config && S.config.indices) || []).map(({ key, name, sub, decimals }) => {
      const q = y[key] || {};
      return tile(esc(name), esc(sub || ''), num(q.price, decimals ?? 2), chg(pct(q.price, q.prev)) + `<span class="zs">${spark(q.spark, 200, 40, q.price >= q.prev)}</span>`);
    }).join('')}</div>`;
  }
  html += levelChips(ZOOM_ASSET[zoom]()) + `<div class="zhint">${tr('Press the knob to set a price alert')}</div>`;
  if (z._html !== html) { z._html = html; z.innerHTML = html; }
}
function marketZoom(n) { zoom = zoom === n ? 0 : n; alertEdit = null; renderZoom(); renderAlertEdit(); }

// ---- price alerts set right here: in a zoomed view, press the knob, turn to the level, press to save.
// The hub fires each one once (banner) and forgets it.
const ZOOM_ASSET = { 1: () => ((S.config && S.config.crypto) || ['BTC'])[0], 2: () => 'XAU', 3: () => 'usdvnd', 4: () => 'vnindex' };
let alertEdit = null; // { asset, price, step, value }
function priceNow(a) {
  if (S.crypto && S.crypto[a]) return S.crypto[a].price;
  if (a === 'XAU') return S.metals && S.metals.xau;
  return S.yahoo && S.yahoo[a] && S.yahoo[a].price;
}
const levelText = (a, v) => (a === 'usdvnd' ? vnd(v) : num(v, v >= 1000 ? 0 : 2));
function alertStart() {
  const a = ZOOM_ASSET[zoom] && ZOOM_ASSET[zoom]();
  const p = a && priceNow(a);
  if (!p) return;
  const step = a === 'usdvnd' ? 10 : 2.5 * Math.pow(10, Math.floor(Math.log10(p)) - 2);
  alertEdit = { asset: a, price: p, step, value: Math.round(p / step) * step };
  renderAlertEdit();
}
function alertKnob(dir) { alertEdit.value = Math.max(alertEdit.step, alertEdit.value + dir * alertEdit.step); renderAlertEdit(); }
function alertSave() {
  const { asset, price, value } = alertEdit;
  const kind = value >= price ? 'above' : 'below';
  alertEdit = null;
  renderAlertEdit();
  fetch('/api/alerts/level', { method: 'POST', body: JSON.stringify({ asset, kind, value }) })
    .then((r) => toast(r.ok ? `🔔 ${tr(kind === 'above' ? 'Alert when it reaches {v}' : 'Alert when it falls to {v}', { v: levelText(asset, value) })}` : tr('Only the Car Thing can do this')))
    .catch(() => toast(tr('Could not reach the hub')));
}
function alertClear() {
  const { asset } = alertEdit;
  alertEdit = null;
  renderAlertEdit();
  fetch('/api/alerts/level', { method: 'POST', body: JSON.stringify({ asset, kind: 'clear' }) }).then((r) => r.ok && toast(tr('Alerts cleared'))).catch(() => {});
}
function renderAlertEdit() {
  const el = $('alertEdit');
  el.classList.toggle('on', !!alertEdit);
  if (!alertEdit) return;
  const { asset, price, value } = alertEdit;
  const d = (value / price - 1) * 100;
  setHTML(el, `<b>🔔 ${esc(asset === 'usdvnd' ? 'USD/VND' : asset === 'XAU' ? tr('Gold') : asset === 'vnindex' ? 'VN-Index' : asset)} ${value >= price ? '≥' : '≤'} ${levelText(asset, value)}</b>`
    + `<span>${tr('now')} ${levelText(asset, price)} · ${d >= 0 ? '+' : ''}${d.toFixed(2)}%</span>`
    + `<small>${tr('Turn to set · press to save · Back to cancel · 4 clears the alerts')}</small>`);
}
// the levels already set, shown on the zoomed view
function levelChips(a) {
  const l = (S.levels || []).find((x) => x.asset === a);
  if (!l) return '';
  return `<div class="zlv">${l.above != null ? `<span>🔔 ≥ ${levelText(a, l.above)}</span>` : ''}${l.below != null ? `<span>🔔 ≤ ${levelText(a, l.below)}</span>` : ''}</div>`;
}

// ---------------------------------------------------------------- preset buttons: what 1-4 do depends on the page

function presetButton(n) {
  if (setMode) return;
  if (alertEdit) { if (n === 4) alertClear(); return; }
  if (page === NEWS && n <= 2) return newsTopic(newsCat + (n === 1 ? 1 : -1));
  if (page === MARKETS) return marketZoom(n);
  if (page === ASK && n === 1) return briefingNow();
  if (page === WEATHER && n === 1) return toggleUnit();
  if (page === CALENDAR && n <= 3) { calView = n - 1; return renderCalendar(); }
  if (page === SERVERS) { srvView = n - 1; return renderServers(); }
  if (page === MUSIC) return musicAction(['prev', 'toggle', 'next', 'like'][n - 1]);
  if (page === FOCUS) return pomoSet([15, 25, 45, 60][n - 1]);
  if (page === PHONE && n === 3) return togglePrivacy(); // 1 and 2 are held keys, see the keydown handler
  if (page === PHONE && n === 4) return replyBySiri();
  if (page === WORDS) return n === 1 ? wordGrade(true) : n === 2 ? wordGrade(false) : n === 3 ? wordsMore() : undefined;
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
    showBanner(newest.dir, `${{ up: '▲', down: '▼', sec: '⚠', rain: '☔', ci: '✖', desk: '🧍', remind: '⏰', net: '🌐' }[newest.dir] || '•'} ${newest.text}`, 30000);
  }
}
function showBanner(cls, text, ms) {
  const b = $('alertBanner');
  b.className = `alert-banner on ${cls}`;
  b.textContent = text;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('on'), ms);
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
const hourLabel = (ts) => {
  const h = Number(ts.slice(11, 13));
  return lang === 'vi' ? `${h}h` : `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;
};

// °C / °F: the hub sends one (UNITS in .env); button 1 on the Weather page shows the other, remembered on this screen
let tempUnit = null;
try { tempUnit = ['C', 'F'].includes(localStorage.getItem('tempUnit')) ? localStorage.getItem('tempUnit') : null; } catch {}
const hubF = () => !S || !S.units || S.units.temp === '°F';
const wantF = () => (tempUnit ? tempUnit === 'F' : hubF());
// a temperature from the hub (in the hub's unit) in the unit on screen
function deg(v) {
  if (v == null) return v;
  if (hubF() === wantF()) return v;
  return wantF() ? (v * 9) / 5 + 32 : ((v - 32) * 5) / 9;
}
const degSym = () => (wantF() ? '°F' : '°C');
const windText = (v) => (hubF() === wantF() ? `${Math.round(v)} ${wantF() ? 'mph' : 'km/h'}` : wantF() ? `${Math.round(v / 1.609)} mph` : `${Math.round(v * 1.609)} km/h`);
function toggleUnit() {
  tempUnit = wantF() ? 'C' : 'F';
  try { localStorage.setItem('tempUnit', tempUnit); } catch {}
  toast(degSym());
  render();
}

function renderWeather() {
  const w = S.weather;
  if (!w) return;
  const cur = w.current;
  const [descEn, icon] = wmo(cur.weather_code);
  const desc = tr(descEn);
  const c = cur.weather_code;
  document.body.dataset.sky = c >= 51 ? 'rain' : !cur.is_day ? 'night' : c >= 2 ? 'cloudy' : 'clear';
  const a = S.aqi || {};
  const [alEn, ac] = aqiLabel(a.us_aqi);
  const al = tr(alEn);
  $('wxNow').className = 'wx-now' + stale(w.at, 30 * 60000);
  setHTML($('wxNow'), `
    <div class="icon">${cur.is_day ? icon : icon.replace('☀️', '🌙').replace('🌤️', '🌙')}</div>
    <div><div class="temp">${Math.round(deg(cur.temperature_2m))}°</div></div>
    <div><div class="desc">${desc} · ${S.city}</div>
      <div class="sub">${tr('Feels like {v}', { v: Math.round(deg(cur.apparent_temperature)) + '°' })} · ${tr('Humidity {v}%', { v: cur.relative_humidity_2m })}<br>
      ${tr('Wind {v}', { v: windText(cur.wind_speed_10m) })} · UV ${a.uv_index != null ? num(a.uv_index, 0) : '—'}<br>
      ${tr('Today {v}', { v: `${Math.round(deg(w.daily[0].min))}° – ${Math.round(deg(w.daily[0].max))}${degSym()}` })}</div>
      <div class="wx-unit"><i class="kb">1</i>${tr('switch to {u}', { u: wantF() ? '°C' : '°F' })}</div></div>
    <div class="aqi"><div class="l">${tr('AQI (US)')}</div><div class="n" style="color:${ac}">${a.us_aqi ?? '—'}</div><div class="l">${al} · PM2.5 ${a.pm2_5 != null ? num(a.pm2_5, 0) : '—'}</div></div>`);
  const nc = S.nowcast;
  const rain = $('wxRain');
  if (nc && now() - nc.at < 30 * 60000) {
    const top = Math.max(1, ...nc.bars.map((b) => b.mm));
    const bars = nc.bars.map((b) => `<i style="height:${Math.max(6, Math.round((100 * b.mm) / top))}%;opacity:${b.mm >= 0.1 || b.prob >= 60 ? 1 : 0.25}"></i>`).join('');
    // the sentence is built here, not on the hub, so it follows the screen language
    const mins = (x) => Math.max(5, Math.round((x - now()) / 300000) * 5);
    const text = nc.wetNow
      ? (nc.endsAt ? tr('Rain now, easing in about {n} min', { n: mins(nc.endsAt) }) : tr('Rain now, for the next two hours'))
      : nc.startsAt ? tr('Rain likely in about {n} min', { n: mins(nc.startsAt) }) : '';
    rain.className = 'wx-rain on' + (text ? ' wet' : '');
    setHTML(rain, `<span class="wr-t">${text ? '☔ ' + esc(text) : tr('No rain in the next 2 hours')}</span><span class="wr-bars">${bars}</span><span class="wr-k">${tr('now · 2 h')}</span>`);
  } else rain.className = 'wx-rain';
  setHTML($('wxHourly'), w.hourly.map((h) => `<div>${hourLabel(h.t)}<span>${wmo(h.code)[1]}</span><b>${Math.round(deg(h.temp))}°</b>${h.pop ?? 0}%</div>`).join(''));
  const dn = dtf(loc(), { timeZone: 'UTC', weekday: 'short' });
  setHTML($('wxDaily'), w.daily.map((d, i) => {
    const day = i === 0 ? tr('Today') : dn.format(new Date(d.t + 'T12:00:00Z'));
    return `<div class="day"><span class="ic">${wmo(d.code)[1]}</span><div class="tx">${tr('{day} · {p}% rain', { day, p: d.pop ?? 0 })}<b>${Math.round(deg(d.min))}° – ${Math.round(deg(d.max))}°</b></div></div>`;
  }).join(''));
}

// ---------------------------------------------------------------- news

let newsCat = 0, newsShownKey = '', newsShown = '', newsRotate = 0;
let newsSel = -1;      // story highlighted while browsing with the knob (-1: not browsing)
let newsDetail = null; // id of the story whose summary is open
const summaries = new Map();
function ago(at) {
  if (!at) return '';
  const m = Math.max(0, Math.round((now() - at) / 60000));
  return m < 60 ? tr('{n}m ago', { n: m }) : m < 1440 ? tr('{n}h ago', { n: Math.round(m / 60) }) : tr('{n}d ago', { n: Math.round(m / 1440) });
}
const newsFeeds = () => (S && S.news && S.news.feeds) || [];
const newsItems = () => { const f = newsFeeds()[newsCat]; return f ? f.items.slice(0, 6) : []; };

function renderNews() {
  const feeds = newsFeeds();
  if (!feeds.length) return;
  newsCat = (newsCat + feeds.length) % feeds.length;
  const f = feeds[newsCat];
  const track = $('newsTrack');
  const chips = feeds.map((x, i) => `<span class="nc ${i === newsCat ? 'on' : ''}">${esc(tr(x.name))}</span>`).join('');
  if (track._html !== chips) {
    track._html = chips;
    track.innerHTML = chips;
    // slide the strip so the chosen topic stays in view
    const on = track.querySelector('.nc.on');
    const shift = Math.max(0, Math.min(on.offsetLeft - 70, track.scrollWidth - $('newsCats').clientWidth));
    track.style.transform = `translate3d(${-shift}px,0,0)`;
  }
  // buttons 1 and 2 step through the topics; the hint stays put while the strip of topics slides
  const up = `<i class="kb">1</i>${tr('next')} <i class="kb">2</i>${tr('back')}${f.at ? `<span class="upd"> · ${tr('updated {t}', { t: now() - f.at < 60000 ? tr('just now') : ago(f.at) })}</span>` : ''}`;
  if ($('newsUp')._html !== up) { $('newsUp')._html = up; $('newsUp').innerHTML = up; }
  const items = newsItems();
  if (newsSel >= items.length) newsSel = items.length - 1;
  const html = items.length
    ? items.map((h, i) => `<div class="nh ${i === newsSel ? 'sel' : ''}" data-i="${i}"><b>${esc(h.title)}</b><span>${esc(h.source || '')}${h.at ? ` · ${ago(h.at)}` : ''}${h.score ? ` · ${tr('{n} points', { n: h.score })}` : ''}</span></div>`).join('')
    : `<div class="nh empty">${tr('Loading headlines…')}</div>`;
  if (html !== newsShown) {
    newsShown = html;
    $('newsList').innerHTML = html;
    if (f.key !== newsShownKey) { // animate only when the topic changes, not when the highlight moves
      newsShownKey = f.key;
      $('newsList').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
  }
}

function showDetail(d, item) {
  $('ndMeta').textContent = [item.source, item.at ? ago(item.at) : '', d && d.host && d.host !== item.source ? d.host : ''].filter(Boolean).join(' · ');
  $('ndTitle').textContent = item.title;
  const sum = $('ndSum');
  if (!d) { sum.className = 'nd-sum loading'; sum.textContent = tr('Reading the article and summarising…'); return; }
  sum.className = d.error ? 'nd-sum err' : 'nd-sum';
  sum.textContent = d.error ? tr('Could not summarise this story: {e}', { e: d.error }) : d.summary;
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
    .catch(() => ({ error: tr('the hub did not answer') }))
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

// ---------------------------------------------------------------- calendar (read-only, from the hub)

let calView = 0; // 0 today, 1 tomorrow, 2 next 7 days (buttons 1-3)
const CAL_VIEWS = ['Today', 'Tomorrow', 'Week'];
const dayKey = (ms) => dtf('en-CA', { timeZone: tz() }).format(new Date(ms));
const timeOf = (ms) => (lang === 'vi'
  ? dtf('vi-VN', { timeZone: tz(), hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
  : dtf('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).replace(':00', '').replace(/\s/g, '').toLowerCase());
function untilText(ms) {
  const m = Math.round((ms - now()) / 60000);
  if (m <= 0) return tr('now');
  if (m < 60) return tr('in {n} min', { n: m });
  const h = Math.floor(m / 60), r = m % 60;
  return h < 24 ? (r ? tr('in {h} h {m} min', { h, m: r }) : tr('in {h} h', { h })) : tr('in {n} days', { n: Math.round(h / 24) });
}
const calEvents = () => (S.calendar && S.calendar.events) || [];
// an event belongs to every day it touches (all-day events end at midnight after their last day)
function onDay(e, key) {
  return dayKey(e.start) <= key && key <= dayKey(Math.max(e.start, e.end - 1));
}

function renderCalendar() {
  const c = S.calendar || {};
  const t = now();
  const d = new Date(t);
  const part = (o) => dtf(loc(), { timeZone: tz(), ...o }).format(d);
  const views = CAL_VIEWS.map((v, i) => `<span class="nc ${i === calView ? 'on' : ''}"><i class="kb">${i + 1}</i>${tr(v)}</span>`).join('');
  const headHtml = `<div class="cal-date"><b>${part({ day: 'numeric' })}</b><span>${part({ weekday: 'long' })}<small>${part({ month: 'long', year: 'numeric' })}</small></span></div><div class="cal-views">${views}</div>`;
  const head = $('calHead');
  if (head._html !== headHtml) { head._html = headHtml; head.innerHTML = headHtml; }

  if (!c.configured) {
    $('calNext').className = 'cal-next';
    setHTML($('calNext'), `<span class="cn-k">${tr('Next up')}</span><b>${tr('No calendar linked')}</b><span class="cn-t">${tr('Run set-calendar-url.sh on server 2')}</span>`);
    setHTML($('calList'), `<div class="cal-none">${tr('Paste the secret iCal address of your Google Calendar into set-calendar-url.sh on server 2, and your events show up here.')}</div>`);
    return;
  }
  const evs = calEvents();
  const next = evs.find((e) => !e.allDay && e.end > t);
  const live = next && next.start <= t;
  $('calNext').className = 'cal-next' + (live ? ' live' : '') + stale(c.at, 30 * 60000);
  const nextHtml = next
    ? `<span class="cn-k">${tr(live ? 'Happening now' : 'Next up')}</span><b>${esc(next.title)}</b><span class="cn-t">${timeOf(next.start)} – ${timeOf(next.end)} · ${live ? tr('ends {t}', { t: untilText(next.end) }) : untilText(next.start)}</span>${next.location ? `<span class="cn-l">${esc(next.location)}</span>` : ''}`
    : `<span class="cn-k">${tr('Next up')}</span><b>${tr('Nothing else scheduled')}</b><span class="cn-t">${tr('Enjoy the free time')}</span>`;
  if ($('calNext')._html !== nextHtml) { $('calNext')._html = nextHtml; $('calNext').innerHTML = nextHtml; }

  const days = calView === 2 ? 7 : 1;
  const keys = Array.from({ length: days }, (_, i) => dayKey(t + (calView === 1 ? 1 : i) * 86400000));
  const label = (k, i) => (calView === 2 && i > 1
    ? dtf(loc(), { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(k + 'T12:00:00Z'))
    : tr(['Today', 'Tomorrow'][calView === 1 ? 1 : i]));
  let html = '';
  keys.forEach((k, i) => {
    const list = evs.filter((e) => onDay(e, k) && (calView !== 0 || e.allDay || e.end > t));
    if (days > 1) html += `<div class="cal-day">${label(k, i)}${list.length ? '' : ` <small>· ${tr('free')}</small>`}</div>`;
    if (!list.length) { if (days === 1) html += `<div class="cal-none">${tr(calView === 0 ? 'Nothing left today' : 'Nothing planned')}</div>`; return; }
    html += list.map((e) => `<div class="ce c${e.cal % 4}${!e.allDay && e.start <= t && e.end > t ? ' now' : ''}"><span class="ce-t">${e.allDay ? tr('all day') : timeOf(e.start)}</span><span class="ce-x"><b>${esc(e.title)}</b>${e.location ? `<small>${esc(e.location)}</small>` : ''}</span></div>`).join('');
  });
  const list = $('calList');
  if (list._html !== html) { list._html = html; list.innerHTML = html; }
}

// a banner 10 minutes before each timed event, on whatever page is open
const reminded = new Set();
function calReminders() {
  const t = now();
  for (const e of calEvents()) {
    if (e.allDay || reminded.has(e.id) || e.start - t > 10 * 60000 || e.start - t < -60000) continue;
    reminded.add(e.id);
    const b = $('alertBanner');
    b.className = 'alert-banner on cal';
    b.textContent = `${timeOf(e.start)} · ${e.title} · ${untilText(e.start)}`;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('on'), 60000);
  }
}

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
  return `<div class="meter"><span class="k">${tr(k)}</span><div class="track"><div class="fill ${cls}" style="transform:scaleX(${(p / 100).toFixed(3)})"></div></div><span class="v">${text}</span></div>`;
}
// sensors report °C; shown in the unit chosen on the Weather page
const degF = (c) => (c == null ? '—' : (wantF() ? `${num(c * 9 / 5 + 32, 0)}°F` : `${num(c, 0)}°C`));

function statsBlock(st, extra = '') {
  return `
    ${meter('CPU', (st.cpu || 0) / 100, `${num(st.cpu, 0)}%`)}
    ${meter('Memory', st.memUsed / st.memTotal, gb(st.memUsed))}
    ${meter('Disk', st.diskUsed / st.diskTotal, gb(st.diskUsed))}
    ${extra}
    <div class="kv"><span>${tr('Temperature')}</span><b>${degF(st.temp)}</b></div>
    <div class="kv"><span>${tr('Load (1/5/15)')}</span><b>${(st.load || []).map((l) => num(l, 2)).join(' · ')}</b></div>
    <div class="kv"><span>${tr('Uptime')}</span><b>${dur(st.uptime || 0)}</b></div>`;
}

// running = fine; exited/created/paused = stopped (amber); unhealthy/restarting/dead = problem (red)
function containersBlock(c) {
  if (!c || !c.list || now() - c.at > 60000) return `<div class="ct"><div class="ct-sum">${tr('Containers')} <b>—</b></div></div>`;
  const bad = c.list.filter((x) => x.health === 'unhealthy' || x.state === 'restarting' || x.state === 'dead');
  const stopped = c.list.filter((x) => !bad.includes(x) && x.state !== 'running');
  const running = c.list.length - bad.length - stopped.length;
  const lines = [
    ...bad.map((x) => `<div class="ct-bad">✖ ${esc(x.name)} · ${esc(x.health === 'unhealthy' ? 'unhealthy' : x.state)}</div>`),
    ...stopped.map((x) => `<div class="ct-stop">■ ${esc(x.name)} · ${esc(x.status)}</div>`),
  ];
  return `<div class="ct">
    <div class="ct-sum">${tr('Containers')} <b>${tr('{n} running', { n: running })}</b>${stopped.length ? ` · <span class="ct-stop">${tr('{n} stopped', { n: stopped.length })}</span>` : ''}${bad.length ? ` · <span class="ct-bad">${tr('{n} failing', { n: bad.length })}</span>` : ''}${!bad.length && !stopped.length ? ` <span class="ct-ok">${tr('✓ all up')}</span>` : ''}</div>
    ${lines.slice(0, 4).join('')}${lines.length > 4 ? `<div class="ct-more">${tr('+{n} more', { n: lines.length - 4 })}</div>` : ''}
  </div>`;
}

// buttons 1-4: now, the last 24 hours, security, updates & GitHub
let srvView = 0;
const SRV_VIEWS = ['Now', '24 h', 'Security', 'Updates'];

function renderServers() {
  const views = SRV_VIEWS.map((v, i) => `<span class="nc ${i === srvView ? 'on' : ''}"><i class="kb">${i + 1}</i>${tr(v)}</span>`).join('');
  if ($('srvViews')._html !== views) { $('srvViews')._html = views; $('srvViews').innerHTML = views; }
  $('srvGrid').style.display = srvView === 0 ? '' : 'none';
  $('srvAlt').style.display = srvView === 0 ? 'none' : '';
  setClass($('srvAlt'), 'srv-alt v' + srvView);
  if (srvView === 0) return renderServersNow();
  const html = [null, srvHistory, srvSecurity, srvUpdates][srvView]();
  if ($('srvAlt')._html !== html) { $('srvAlt')._html = html; $('srvAlt').innerHTML = html; }
}

// area chart of 10-minute averages; nulls (no data) leave gaps
function areaChart(values, w, h, lo, hi) {
  const v = values || [];
  const n = Math.max(v.length, 2);
  const x = (i) => ((i / (n - 1)) * w).toFixed(1);
  const y = (val) => (h - 1 - ((Math.min(hi, Math.max(lo, val)) - lo) / (hi - lo || 1)) * (h - 2)).toFixed(1);
  let line = '', area = '', run = [];
  const flush = () => {
    if (run.length > 1) {
      const pts = run.map(([i, val]) => `${x(i)},${y(val)}`).join(' ');
      line += `<polyline points="${pts}" fill="none" stroke="var(--sky)" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      area += `<polygon points="${x(run[0][0])},${h} ${pts} ${x(run[run.length - 1][0])},${h}" fill="url(#hgFill)"/>`;
    }
    run = [];
  };
  v.forEach((val, i) => { if (val == null) flush(); else run.push([i, val]); });
  flush();
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="hgFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(124,196,255,.45)"/><stop offset="1" stop-color="rgba(124,196,255,0)"/></linearGradient></defs>${area}${line}</svg>`;
}

function srvHistory() {
  const h = S.history;
  if (!h) return `<div class="srv-empty">${tr('No history yet.')}</div>`;
  const col = (key, name, extra = '') => {
    const d = h[key] || {};
    const row = (k, label, fmt, lo, hi) => {
      const vals = (d[k] || []).filter((x) => x != null);
      const last = vals.length ? vals[vals.length - 1] : null;
      const max = vals.length ? Math.max(...vals) : null;
      const range = k === 'temp' && vals.length ? [Math.min(...vals) - 3, Math.max(...vals) + 3] : [lo, hi];
      return `<div class="hg"><div class="hg-k">${tr(label)}<b>${last == null ? '—' : fmt(last)}</b><small>${max == null ? '' : tr('peak {v}', { v: fmt(max) })}</small></div><div class="hg-c">${areaChart(d[k], 300, 70, range[0], range[1])}</div></div>`;
    };
    return `<div class="srv hist"><div class="head"><div><b>${name}</b> <span>${tr('last 24 hours · 10-minute averages')}</span></div></div>
      ${row('cpu', 'CPU', (v) => `${num(v, 0)}%`, 0, 100)}
      ${row('mem', 'Memory', (v) => `${num(v, 0)}%`, 0, 100)}
      ${row('temp', 'Temp', degF, 0, 100)}
      ${extra}
      <div class="hg-x"><span>${tr('24 h ago')}</span><span>${tr('12 h')}</span><span>${tr('now')}</span></div></div>`;
  };
  const n = S.net && S.net.hist;
  const lat = n ? n.ms.filter((x) => x != null) : [];
  const internet = n ? `<div class="hg"><div class="hg-k">Internet<b>${S.net.ok ? `${S.net.ms} ms` : tr('down')}</b>`
    + `<small>${lat.length ? tr('peak {v}', { v: `${Math.max(...lat)} ms` }) : ''}${n.loss.some((x) => x) ? ` · ${tr('{n}% lost', { n: Math.max(...n.loss.filter((x) => x != null)) })}` : ''}</small></div>`
    + `<div class="hg-c">${areaChart(n.ms, 300, 70, 0, Math.max(100, ...lat))}</div></div>` : '';
  return col('server2', 'Server 2', internet) + col('server1', 'Server 1');
}

function srvSecurity() {
  const sec = S.security;
  if (!sec) return `<div class="srv-empty">${tr('Security details show on the Car Thing only.')}</div>`;
  const card = (key, name) => {
    const r = sec[key];
    if (!r) return `<div class="srv sec"><div class="head"><div><b>${name}</b></div></div><div class="note">${tr('No report yet. host-report.sh runs from cron on this server (docs/SETUP.md).')}</div></div>`;
    const fresh = [...r.listen, ...r.docker].filter((x) => x.fresh);
    const loud = r.ssh.fail1h >= 5 || fresh.length;
    const chips = (list) => list.map((x) => `<span class="port${x.fresh ? ' fresh' : ''}">${esc(x.p)}${x.fresh ? ` · ${tr('new')}` : ''}</span>`).join('');
    const old = now() - r.at > 20 * 60000;
    return `<div class="srv sec${old ? ' stale' : ''}">
      <div class="head"><div><b>${name}</b> <span>${tr('checked {t}', { t: ago(r.at) })}</span></div><span class="state ${loud ? 'down' : 'up'}">${tr(loud ? 'Look' : 'Quiet')}</span></div>
      <div class="kv"><span>${tr('Failed SSH logins')}</span><b>${r.ssh.fail1h} · ${r.ssh.fail24h}<small> ${tr('1 h · 24 h')}</small></b></div>
      ${r.ssh.top[0] ? `<div class="sec-top">${tr('most from {ip} ({n})', { ip: esc(r.ssh.top[0].ip), n: r.ssh.top[0].n })}</div>` : ''}
      <div class="kv"><span>${tr('Blocked by the firewall')}</span><b>${r.ufw.block1h} · ${r.ufw.block24h}<small> ${tr('1 h · 24 h')}</small></b></div>
      ${r.ufw.top.slice(0, 2).map((t) => `<div class="sec-top">${esc(t.what)} · ${t.n}×</div>`).join('')}
      <div class="sec-k">${tr('Open on every interface')}</div>
      <div class="ports">${chips(r.listen) || `<span class="sec-none">${tr('nothing')}</span>`}</div>
      ${r.docker.length ? `<div class="sec-k">${tr('Docker, published on 0.0.0.0 (skips UFW)')}</div><div class="ports">${chips(r.docker)}</div>` : ''}
    </div>`;
  };
  const c = sec.carthing;
  const ct = !c
    ? `<div class="note">${tr('Not checked yet. check-carthing.sh runs hourly from cron on server 2.')}</div>`
    : !c.reachable
      ? `<div class="sec-bad">${tr('No SSH access with the hub key. Run check-carthing.sh on server 2.')}</div>`
      : c.problems.length
        ? `<div class="sec-bad">${trn(c.problems.length, '{n} thing to put back', '{n} things to put back')}</div>${c.problems.slice(0, 4).map((p) => `<div class="sec-top">${esc(p)}</div>`).join('')}<div class="note">${tr('Run check-carthing.sh on server 2 to fix.')}</div>`
        : `<div class="sec-ok">${tr('✓ Setup intact')}</div><div class="note">${tr('Key-only SSH, watchdog, time sync, kiosk and helpers all in place.')}</div>`;
  return card('server2', 'Server 2') + card('server1', 'Server 1') + `<div class="srv sec ct-card"><div class="head"><div><b>Car Thing</b></div></div>
    ${c ? `<div class="kv"><span>Nocturne</span><b>${esc(c.version || '—')}</b></div><div class="kv"><span>${tr('Checked')}</span><b>${ago(c.at)}</b></div>` : ''}${ct}</div>`;
}

function srvUpdates() {
  const u = S.updates;
  if (!u) return `<div class="srv-empty">${tr('Update details show on the Car Thing only.')}</div>`;
  const server = (key, name, label) => {
    const a = u[key];
    // images built locally (or private) cannot be compared with a registry and are left out of the count
    const imgs = (u.images || []).filter((i) => i.server === label && i.update !== null);
    const newer = imgs.filter((i) => i.update === true);
    return `<div class="up-s"><div class="up-h"><b>${name}</b>${a && a.reboot ? `<span class="port fresh">${tr('reboot needed')}</span>` : ''}</div>
      <div class="kv"><span>${tr('apt packages')}</span><b>${a ? `${a.upgradable}${a.security ? ` <em>· ${tr('{n} security', { n: a.security })}</em>` : ''}` : '—'}</b></div>
      <div class="kv"><span>${tr('Images with a newer version')}</span><b>${imgs.length ? tr('{a} of {b}', { a: newer.length, b: imgs.length }) : '—'}</b></div>
      ${newer.slice(0, 3).map((i) => `<div class="sec-top">↑ ${esc(i.name)} · ${esc(i.image)}</div>`).join('')}${newer.length > 3 ? `<div class="sec-top">${tr('+{n} more', { n: newer.length - 3 })}</div>` : ''}</div>`;
  };
  const g = S.github || {};
  let gh;
  if (!g.configured) gh = `<div class="note">${tr('Set GITHUB_USER in the hub .env to see CI runs and open issues here.')}</div>`;
  else if (!g.at) gh = `<div class="note">${tr('Asking GitHub…')}</div>`;
  else {
    const dot = (ci) => (!ci ? 'none' : ci.status !== 'completed' ? 'run' : ci.conclusion === 'success' ? 'ok' : ci.conclusion === 'failure' ? 'bad' : 'none');
    gh = g.repos.map((r) => `<div class="gh-r"><i class="gh-d ${dot(r.ci)}"></i><b>${esc(r.name)}</b><span>${r.ci ? `${esc(r.ci.workflow)} · ${r.ci.status !== 'completed' ? tr('running') : esc(tr(r.ci.conclusion || ''))} · ${ago(r.ci.at)}` : tr('no workflows')}</span></div>`).join('')
      + `<div class="gh-o">${tr('Open: {p} · {i}', { p: trn(g.open.prs, '{n} pull request', '{n} pull requests').replace(/^\d+/, (n) => `<b>${n}</b>`), i: trn(g.open.issues, '{n} issue', '{n} issues').replace(/^\d+/, (n) => `<b>${n}</b>`) })}</div>`
      + g.open.items.slice(0, 3).map((i) => `<div class="sec-top">${i.pr ? '⇄' : '●'} ${esc(i.repo)} #${i.n} · ${esc(i.title)}</div>`).join('');
  }
  return `<div class="srv upd"><div class="head"><div><b>${tr('Updates')}</b> <span>${u.imagesAt ? tr('images checked {t}', { t: ago(u.imagesAt) }) : tr('images not checked yet')}</span></div></div>${server('server2', 'Server 2', 'server 2')}${server('server1', 'Server 1', 'server 1')}</div>
    <div class="srv upd"><div class="head"><div><b>GitHub</b> <span>${esc(g.user || '')}</span></div></div>${gh}</div>`;
}

function renderServersNow() {
  const s2 = S.servers.server2;
  if (s2) {
    setClass($('srv2'), 'srv' + stale(s2.at, 30000));
    setHTML($('srv2'), `
      <div class="head"><div><b>Server 2</b> <span>${s2.ip} · ${tr('laptop')}</span></div><span class="state up">${tr('Online')}</span></div>
      ${statsBlock(s2, s2.battery != null ? meter('Battery', s2.battery / 100, `${s2.battery}%`, true) : '')}
      ${netLine()}
      ${containersBlock(s2.containers)}`);
  }
  const s1 = S.servers.server1;
  if (s1) {
    const st = s1.stats && now() - s1.stats.at < 60000 ? s1.stats : null;
    setClass($('srv1'), 'srv' + stale(s1.at, 60000));
    setHTML($('srv1'), `
      <div class="head"><div><b>Server 1</b> <span>${s1.ip} · BRIX</span></div><span class="state ${s1.online ? 'up' : 'down'}">${tr(s1.online ? 'Online' : 'Offline')}</span></div>
      ${st ? statsBlock(st) : `<div class="note">${tr('No stats from the server 1 agent yet.')}</div>`}
      <div class="kv"><span>${tr('Network latency')}</span><b>${s1.online ? num(s1.latency, 1) + ' ms' : '—'}</b></div>
      ${containersBlock(st && st.containers)}`);
  }
  renderCarThingHealth();
}

// the internet line, measured by the hub every 30 s (TCP connect to 1.1.1.1 / 8.8.8.8)
function netLine() {
  const n = S.net;
  if (!n) return '';
  return `<div class="kv"><span>Internet</span><b class="${n.ok ? '' : 'bad'}">${n.ok ? `${n.ms} ms` : tr('down since {t}', { t: timeOf(n.downSince || n.at) })}</b></div>`;
}

// the Car Thing itself, read over SSH from server 2 every 2 minutes (tools/carthing-stats.sh)
function renderCarThingHealth() {
  const h = S.ctHealth, ct = $('srvCt');
  ct.style.display = h ? '' : 'none';
  if (!h) return;
  const ok = h.reachable && now() - h.at < 6 * 60000;
  const down = ok ? Object.values(h.helpers || {}).filter((v) => !v).length : 0;
  setClass(ct, 'srv ct-health' + (ok ? '' : ' stale'));
  setHTML(ct, `<div class="head"><div><b>Car Thing</b> <span>Nocturne ${esc(h.version || '')} · 10.42.1.2</span></div><span class="state ${ok ? 'up' : 'down'}">${tr(ok ? 'Online' : 'Offline')}</span></div>`
    + (ok
      ? `<div class="ct-meters">${meter('CPU', h.cpu / 100, `${num(h.cpu, 0)}%`)}${meter('Memory', h.memUsed / h.memTotal, `${Math.round(h.memUsed / 1048576)} MB`)}`
        + `${meter('Storage', h.diskUsed / h.diskTotal, tr('{v} free', { v: gb(h.diskTotal - h.diskUsed) }))}</div>`
        + `<div class="ct-kv"><span>${tr('Temperature')} <b>${degF(h.temp)}</b></span><span>${tr('Uptime')} <b>${dur(h.uptime)}</b></span>`
        + `<span>Bluetooth <b class="${h.helpers.phone ? 'ok' : 'bad'}">${h.helpers.phone ? '✓' : '✗'}</b></span>`
        + `<span>${tr('Helpers')} <b class="${down ? 'bad' : 'ok'}">${down ? tr('{n} stopped', { n: down }) : '✓'}</b></span></div>`
      : `<div class="note">${tr('No answer from the Car Thing over SSH.')}</div>`));
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
      toast(tr(pomo.mode === 'focus' ? 'Break over — back to focus' : 'Session done — take a break'));
      setPage(FOCUS);
      savePomo();
    }
  }
  const mm = String(Math.floor(pomo.left / 60)).padStart(2, '0'), ss = String(pomo.left % 60).padStart(2, '0');
  $('pomoTime').textContent = `${mm}:${ss}`;
  $('pomoTime').className = 'pomo-time ' + (pomo.running ? 'running' : 'paused');
  $('pomoMode').textContent = tr(pomo.mode === 'focus' ? 'Focus' : 'Break') + (pomo.running ? '' : tr(' · paused'));
  $('pomoFill').style.transform = `scaleX(${1 - pomo.left / modeLen()})`;
  pages[FOCUS].classList.toggle('break', pomo.mode !== 'focus');
  $('pomoCount').textContent = trn(pomo.done, '{n} session completed', '{n} sessions completed');
}
function pomoToggle() {
  pomo.running = !pomo.running;
  if (pomo.running) pomo.endsAt = Date.now() + pomo.left * 1000;
  savePomo(); pomoTick();
}
function pomoSet(min) {
  if (pomo.running) return toast(tr('Pause the timer to change its length'));
  pomo.mode = 'focus';
  pomo.focusMin = min;
  pomo.left = min * 60;
  savePomo(); pomoTick();
  toast(tr('Focus · {n} min', { n: min }));
}
function pomoAdjust(step) {
  if (pomo.running) return toast(tr('Pause the timer to change its length'));
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
      .then((r) => { if (!r.ok) toast(tr('Brightness can only be changed on the Car Thing')); })
      .catch(() => toast(tr('Could not reach the hub')))
      .finally(() => { brightPending = null; });
  }, 250);
}

// ---------------------------------------------------------------- music (Spotify)

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.6v12.8a1.1 1.1 0 0 0 1.7.9l9.8-6.4a1.1 1.1 0 0 0 0-1.8L9.7 4.7A1.1 1.1 0 0 0 8 5.6z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.4" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.4" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.3C19.5 15.4 12 20 12 20z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
  hearted: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.3C19.5 15.4 12 20 12 20z" fill="currentColor"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M4 7h3.5c4 0 5 10 9 10H20M4 17h3.5c1.6 0 2.7-1.6 3.6-3.6M13 9.6C13.9 8 15 7 16.5 7H20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H19M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M16.5 4.5 19 7l-2.5 2.5M7.5 19.5 5 17l2.5-2.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  repeat1: '<svg viewBox="0 0 24 24"><path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H19M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M16.5 4.5 19 7l-2.5 2.5M7.5 19.5 5 17l2.5-2.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="14.6" font-size="7" font-weight="800" text-anchor="middle" fill="currentColor">1</text></svg>',
};
const setIcon = (el, name) => { if (el.dataset.icon !== name) { el.innerHTML = ICON[name]; el.dataset.icon = name; } };
setIcon($('mPlay'), 'play');
setIcon($('mLike'), 'heart');

const mmss = (ms) => { const s = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let shownArt = null;

// Music shows the paired iPhone whenever it is connected and has something to show (any app, read over
// Bluetooth), even if Spotify is playing on another device; otherwise Spotify as before
const phoneMedia = () => (PH.connected && PH.media && PH.media.title ? PH.media : null);
const musicSource = () => (phoneMedia() ? 'phone' : 'spotify');

function musicProgress() {
  if (musicSource() === 'phone') {
    const m = phoneMedia();
    const pos = Math.min(m.duration, m.elapsed + (m.state === 1 ? (m.rate || 1) * (Date.now() - m.at) / 1000 : 0));
    $('mFill').style.transform = `scaleX(${m.duration ? pos / m.duration : 0})`;
    $('mPos').textContent = mmss(pos * 1000);
    $('mDur').textContent = mmss(m.duration * 1000);
    return;
  }
  const sp = S && S.spotify;
  const p = sp && sp.player;
  if (!p) return;
  const pos = Math.min(p.duration, p.progress + (p.isPlaying ? now() - sp.at : 0));
  $('mFill').style.transform = `scaleX(${pos / (p.duration || 1)})`;
  $('mPos').textContent = mmss(pos);
  $('mDur').textContent = mmss(p.duration);
}

function renderPhoneMusic(m) {
  // the Bluetooth link carries no picture: borrow Spotify's when it is the same song, else the hub looks one up
  // (a YouTube video's thumbnail, or the album cover from Apple's search)
  const sp = S && S.spotify && S.spotify.player;
  const art = sp && sp.art && sp.title === m.title
    ? `/api/spotify/art?u=${encodeURIComponent(sp.art)}`
    : `/api/media/cover?${new URLSearchParams({ app: m.app || '', t: m.title, a: m.artist || '', al: m.album || '' })}`;
  if (art !== shownArt) { shownArt = art; $('mArt').style.backgroundImage = art ? `url("${art}")` : 'none'; tintFrom(art); }
  setText($('mTitle'), m.title);
  setText($('mArtist'), m.artist);
  setText($('mAlbum'), m.album);
  setIcon($('mPlay'), m.state === 1 ? 'pause' : 'play');
  // button 4 shuffles on the phone (liking is a Spotify thing); repeat is the chip next to it
  const q = m.queue || {};
  setIcon($('mLike'), 'shuffle');
  $('mLike').parentElement.classList.toggle('on', !!q.shuffle);
  setHTML($('mQueue'), `${q.count > 1 ? `<span>${q.index + 1} / ${q.count}</span>` : ''}`
    + `<span class="q${q.shuffle ? ' on' : ''}" data-q="8">${ICON.shuffle}</span>`
    + `<span class="q${q.repeat ? ' on' : ''}" data-q="7">${q.repeat === 1 ? ICON.repeat1 : ICON.repeat}</span>`);
  setText($('mDev'), `${PH.name || 'iPhone'}${m.app ? ` · ${m.app}` : ''} · ${tr('volume {v}%', { v: Math.round(m.volume * 100) })}`);
  musicProgress();
  loadLyrics();
  lyricTick();
}

// where the song is now (seconds), how long it is, and whether it is moving
function musicPos() {
  const m = musicSource() === 'phone' && phoneMedia();
  if (m) return { pos: Math.min(m.duration, m.elapsed + (m.state === 1 ? (m.rate || 1) * (Date.now() - m.at) / 1000 : 0)), dur: m.duration, playing: m.state === 1 };
  const sp = S && S.spotify, p = sp && sp.player;
  if (!p) return null;
  return { pos: Math.min(p.duration, p.progress + (p.isPlaying ? now() - sp.at : 0)) / 1000, dur: p.duration / 1000, playing: p.isPlaying };
}
function trackInfo() {
  const m = musicSource() === 'phone' && phoneMedia();
  if (m) return { title: m.title, artist: m.artist, album: m.album, dur: m.duration };
  const p = S && S.spotify && S.spotify.player;
  return p ? { title: p.title, artist: p.artist, album: p.album, dur: p.duration / 1000 } : null;
}

// the Music page takes its colours from the cover: drawn once, 12 × 12, into a canvas. Covers come through
// the hub (same origin), so the canvas can be read.
let tintOf = null;
function tintFrom(url) {
  const music = pages[MUSIC];
  if (url === tintOf) return;
  tintOf = url;
  if (!url) { music.style.removeProperty('--np'); music.style.removeProperty('--np-2'); return; }
  const img = new Image();
  img.onload = () => {
    if (tintOf !== url) return;
    const c = document.createElement('canvas');
    c.width = c.height = 12;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 12, 12);
    const d = g.getImageData(0, 0, 12, 12).data;
    let r = 0, gr = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const wt = 1 + (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 24; // colour beats grey
      r += d[i] * wt; gr += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
    }
    const [h, s] = hsl(r / w, gr / w, b / w);
    music.style.setProperty('--np', `hsl(${h} ${Math.max(50, s)}% 62%)`);
    music.style.setProperty('--np-2', `hsl(${h} ${Math.max(45, s)}% 24%)`);
  };
  img.src = url;
}
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round((h * 60 + 360) % 360), Math.round(s * 100)];
}

// lyrics (LRCLIB through the hub), shown in immersive mode. The current line lights up and the column moves
// with one transform per line: a timer wakes up when the next line is due, nothing runs per frame.
let lyr = { key: '', lines: null, synced: false }, lyIdx = -2, lyTimer = null;
function loadLyrics() {
  const t = trackInfo();
  const key = t ? `${t.title}\n${t.artist}` : '';
  if (key === lyr.key) return;
  lyr = { key, lines: null, synced: false };
  lyIdx = -2;
  lyricsEmpty();
  if (!t || !onCarThing) return;
  fetch(`/api/media/lyrics?${new URLSearchParams({ t: t.title, a: t.artist || '', al: t.album || '', d: Math.round(t.dur || 0) })}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((l) => {
      if (lyr.key !== key || !l || !l.lines.length) return;
      lyr = { key, lines: l.lines, synced: l.synced };
      drawLyrics();
      // a song in another language gets a Vietnamese line under each line, when the screen is in Vietnamese
      if (lang === 'vi' && !looksVietnamese(l.lines)) {
        fetch(`/api/media/lyrics/vi?${new URLSearchParams({ t: t.title, a: t.artist || '', al: t.album || '', d: Math.round(t.dur || 0) })}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((vi) => { if (lyr.key === key && Array.isArray(vi)) { lyr.vi = vi; drawLyrics(); } })
          .catch(() => {});
      }
    })
    .catch(() => {});
}
function drawLyrics() {
  $('mLyCol').innerHTML = lyr.lines.map((x, i) => `<div class="ly">${esc(x.text) || '♪'}${lyr.vi && lyr.vi[i] && x.text ? `<small>${esc(lyr.vi[i])}</small>` : ''}</div>`).join('');
  $('mLyCol').style.transform = '';
  lyIdx = -2;
  lyricTick();
}
const looksVietnamese = (lines) => lines.filter((x) => /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(x.text)).length > lines.length * 0.3;
// no lyrics: the title and artist, large
function lyricsEmpty() {
  const t = trackInfo();
  $('mLyCol').innerHTML = t ? `<div class="ly on big">${esc(t.title)}</div><div class="ly">${esc(t.artist || '')}</div>` : '';
  $('mLyCol').style.transform = '';
}
function lyricTick() {
  clearTimeout(lyTimer);
  if (!lyr.lines || !lyr.synced || !pages[MUSIC].classList.contains('immersive')) return;
  const p = musicPos();
  if (!p) return;
  let i = -1;
  while (i + 1 < lyr.lines.length && lyr.lines[i + 1].t <= p.pos + 0.2) i++;
  if (i !== lyIdx) {
    const col = $('mLyCol');
    if (col.children[lyIdx]) col.children[lyIdx].classList.remove('on');
    lyIdx = i;
    const cur = col.children[Math.max(0, i)];
    if (i >= 0 && cur) cur.classList.add('on');
    // .ly-col starts at the middle of the panel: move the current line's centre there
    col.style.transform = `translate3d(0, ${-(cur ? cur.offsetTop + cur.offsetHeight / 2 : 0)}px, 0)`;
  }
  if (p.playing && i + 1 < lyr.lines.length) lyTimer = setTimeout(lyricTick, Math.max(120, (lyr.lines[i + 1].t - p.pos) * 1000));
}

// desk clock: after 10 quiet minutes the screen becomes a large clock with the weather, what is next on the
// calendar and the phone's battery; the first touch or key only brings the page back
const AMBIENT_MS = 10 * 60000;
function ambientCheck() {
  const amb = $('ambient');
  const p = musicPos();
  const busy = setMode || PH.call || PH.pairing || screenOff() || $('digest').classList.contains('on')
    || (page === MUSIC && p && p.playing) || (S && S.voice && ['starting', 'listening', 'thinking', 'answer'].includes(S.voice.phase));
  const want = !!S && (amForced ? !(PH.call || PH.pairing || screenOff()) : !busy && Date.now() - lastInput > AMBIENT_MS);
  if (amForced && !want) amForced = false; // a call or the screen going off ends it
  if (want !== amb.classList.contains('on')) {
    amTimeKey = '';
    amb.classList.toggle('on', want);
    if (want) window.deskTorch.start(); else window.deskTorch.stop();
  }
  if (want) renderAmbient();
}
let amTimeKey = '', amForced = false;
const ambientOn = () => $('ambient').classList.contains('on');
// the quick menu's Clock tile: straight to the desk clock; any touch or key leaves it as usual
function showAmbient() {
  setModeTo(null);
  amForced = true;
  ambientCheck();
}
function leaveAmbient() {
  const amb = $('ambient');
  amForced = false;
  if (!amb.classList.contains('on')) return false;
  amb.classList.remove('on');
  window.deskTorch.stop();
  return true;
}
function renderAmbient() {
  const d = new Date(now());
  const parts = dtf(loc(), { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).formatToParts(d);
  const hm = parts.filter((p) => p.type === 'hour' || p.type === 'minute' || p.type === 'literal' && /[:.h]/.test(p.value)).map((p) => p.value).join('');
  const ap = (parts.find((p) => p.type === 'dayPeriod') || {}).value || '';
  const key = hm + ap;
  if (amTimeKey !== key) { amTimeKey = key; window.deskTorch.time(hm, ap); } // torch.js draws the digits
  setText($('amDate'), dtf(loc(), { timeZone: tz(), weekday: 'long', day: 'numeric', month: 'long' }).format(d));
  const bits = [];
  const w = S.weather && S.weather.current;
  if (w) {
    const [desc, icon] = wmo(w.weather_code);
    bits.push(`<span>${w.is_day ? icon : icon.replace('☀️', '🌙').replace('🌤️', '🌙')} ${num(deg(w.temperature_2m), 0)}${degSym()} · ${esc(tr(desc))}</span>`);
  }
  const next = calEvents().filter((e) => !e.allDay && e.start > now()).sort((a, b) => a.start - b.start)[0];
  if (next) bits.push(`<span>📅 ${esc(next.title)} · ${untilText(next.start)}</span>`);
  if (PH.connected && PH.battery != null) bits.push(`<span>📱 ${PH.battery}%</span>`);
  const row = bits.join('');
  if ($('amRow')._html !== row) { setHTML($('amRow'), row); window.deskTorch.info(); }
}

// immersive mode: after a few quiet seconds while music plays, the cover grows and the lyrics take the rest.
// The first touch or key only leaves it.
let lastInput = Date.now();
function immersiveCheck() {
  const music = pages[MUSIC];
  const p = page === MUSIC && !editing && !setMode && !slide && musicPos();
  const want = !!(p && p.playing && Date.now() - lastInput > 8000);
  if (want === music.classList.contains('immersive')) return;
  music.classList.toggle('immersive', want);
  if (want) { if (!lyr.lines) lyricsEmpty(); lyIdx = -2; lyricTick(); }
}
function leaveImmersive() {
  lastInput = Date.now();
  if (leaveAmbient()) return true;
  const music = pages[MUSIC];
  if (!music.classList.contains('immersive')) return false;
  music.classList.remove('immersive');
  clearTimeout(lyTimer);
  return true;
}

function renderMusic() {
  if (musicSource() === 'phone') return renderPhoneMusic(phoneMedia());
  const sp = S.spotify || {};
  const p = sp.player;
  if (!sp.configured || !sp.linked) {
    $('mTitle').textContent = tr('Spotify not linked');
    $('mArtist').textContent = tr('Linking is done once from a browser on the LAN.');
    $('mAlbum').textContent = '';
    $('mDev').textContent = '';
    return;
  }
  if (!p) {
    $('mTitle').textContent = tr('Nothing playing');
    $('mArtist').textContent = tr('Start Spotify on any device, then control it here.');
    $('mAlbum').textContent = '';
    $('mDev').textContent = sp.error ? `Spotify: ${sp.error}` : '';
    setIcon($('mPlay'), 'play');
    setHTML($('mQueue'), '');
    return;
  }
  if (p.art !== shownArt) {
    shownArt = p.art;
    const url = p.art ? `/api/spotify/art?u=${encodeURIComponent(p.art)}` : null;
    $('mArt').style.backgroundImage = url ? `url("${url}")` : 'none';
    tintFrom(url);
  }
  setHTML($('mQueue'), '');
  $('mTitle').textContent = p.title;
  $('mArtist').textContent = p.artist;
  $('mAlbum').textContent = p.album;
  setIcon($('mPlay'), p.isPlaying ? 'pause' : 'play');
  setIcon($('mLike'), sp.liked ? 'hearted' : 'heart');
  $('mLike').parentElement.classList.toggle('on', !!sp.liked);
  const d = p.device;
  $('mDev').textContent = d ? `${d.name}${d.canVolume && d.volume != null ? ` · ${tr('volume {v}%', { v: d.volume })}` : ''}` : '';
  musicProgress();
  loadLyrics();
  lyricTick();
}

function spotifyAction(act, body) {
  fetch(`/api/spotify/${act}`, { method: 'POST', body: JSON.stringify(body || {}) })
    .then((r) => { if (!r.ok) return r.text().then((t) => toast(r.status === 403 ? tr('Controls work on the Car Thing only') : `Spotify: ${t || r.status}`)); })
    .catch(() => toast(tr('Could not reach the hub')));
}

// AMS remote commands: 2 play/pause, 3 next, 4 previous, 5 volume up, 6 volume down, 7 repeat, 8 shuffle
function musicAction(act) {
  if (musicSource() !== 'phone') return spotifyAction(act);
  phonePost('/media', { cmd: { prev: 4, toggle: 2, next: 3, like: 8 }[act] });
}
$('mQueue').addEventListener('click', (e) => {
  const q = e.target.closest('[data-q]');
  if (q && musicSource() === 'phone') phonePost('/media', { cmd: Number(q.dataset.q) });
});

let volTimer = null, volDelta = 0;
function volumeAdjust(step) {
  const m = musicSource() === 'phone' && phoneMedia();
  if (m) {
    m.volume = Math.max(0, Math.min(1, m.volume + step / 16)); // the phone moves in 16 steps
    renderMusic();
    return phonePost('/media', { cmd: step > 0 ? 5 : 6 });
  }
  const d = S && S.spotify && S.spotify.player && S.spotify.player.device;
  if (!d || !d.canVolume) return toast(tr('This device does not allow volume control'));
  volDelta += step * 5;
  d.volume = Math.max(0, Math.min(100, (d.volume || 0) + step * 5));
  renderMusic();
  clearTimeout(volTimer);
  volTimer = setTimeout(() => { spotifyAction('volume', { delta: volDelta }); volDelta = 0; }, 300);
}

document.querySelectorAll('.m-ctrl button').forEach((b) => b.addEventListener('click', () => musicAction(b.dataset.act)));

// ---------------------------------------------------------------- phone: the paired iPhone, over Bluetooth
// phonelink runs on the Car Thing itself and serves only this page, on 127.0.0.1. What it reads from the
// phone (notifications, calls, what is playing) never goes to the hub, so the LAN preview never sees it.

const PHONELINK = 'http://127.0.0.1:5055';
const onCarThing = /CrKey\//.test(navigator.userAgent);
let PH = { paired: false, connected: false, notes: [] };
let noteSeen = null, callShown = null, pausedForCall = false;
let privacy = false; // hide message text on this screen (iPhone page, button 3)
try { privacy = localStorage.getItem('privacy') === '1'; } catch {}

function phonePost(path, body) {
  if (!onCarThing) return toast(tr('Only the Car Thing can do this'));
  // a plain-text body keeps this a simple request (no CORS preflight)
  return fetch(PHONELINK + path, { method: 'POST', body: JSON.stringify(body || {}) })
    .then((r) => { if (!r.ok) r.text().then((t) => toast(t || `iPhone: ${r.status}`)); })
    .catch(() => toast(tr('The Bluetooth helper is not running')));
}

function phoneConnect() {
  if (!onCarThing) return;
  const es = new EventSource(PHONELINK + '/events');
  es.onmessage = (ev) => {
    const prev = PH;
    PH = JSON.parse(ev.data);
    phoneChanged(prev);
    renderPhone();
    if (page === MUSIC && !slide) renderMusic();
    if (page === PHONE && !slide) renderIphone();
  };
  es.onerror = () => { es.close(); PH = { paired: false, connected: false, notes: [] }; renderPhone(); setTimeout(phoneConnect, 10000); };
}

function renderPhone() {
  const chip = $('phone');
  chip.classList.toggle('on', !!PH.paired);
  chip.classList.toggle('away', !!PH.paired && !PH.connected);
  setText($('phoneBat'), PH.connected && PH.battery != null ? `${PH.battery}%` : '');
  setText($('phoneLabel'), PH.paired ? PH.name || 'iPhone' : tr('Pair iPhone'));

  // a new notification: a short banner. Not for what was already there when the stream started, nor for what
  // the phone had before it connected (those fill the iPhone page quietly).
  const notes = PH.notes || [];
  const top = Math.max(0, ...notes.map((x) => x.uid));
  if (noteSeen === null) noteSeen = top;
  const n = notes.find((x) => !x.old && x.uid > noteSeen);
  if (n) {
    const msg = privacy ? '' : n.msg && n.msg.length > 110 ? n.msg.slice(0, 108) + '…' : n.msg;
    showBanner('phone', `${n.cat === 2 ? '☎' : '💬'} ${n.app ? n.app + ' · ' : ''}${n.title}${msg ? ': ' + msg : ''}`, 9000);
  }
  if (top !== noteSeen) sendSummary();
  noteSeen = Math.max(noteSeen, top);

  // an incoming call takes the whole screen, wakes it at night, and pauses Spotify playing elsewhere
  const c = PH.call;
  $('call').classList.toggle('on', !!c);
  if (c) {
    setText($('callApp'), c.app || tr('Phone'));
    setText($('callName'), c.title || tr('Unknown caller'));
    if (callShown !== c.uid) {
      callShown = c.uid;
      if (screenOff()) wakeScreen();
      const sp = S && S.spotify && S.spotify.player;
      if (sp && sp.isPlaying) { pausedForCall = true; spotifyAction('pause'); }
    }
  } else if (callShown !== null) {
    callShown = null;
    if (pausedForCall) { pausedForCall = false; spotifyAction('play'); }
  }
  renderPairing();
}

// ---- presence, battery, the "while you were away" card

let awaySince = null, digestTimer = null, phoneSeen = false, deskSent = null;
function reportDesk() {
  if (onCarThing) fetch('/api/desk', { method: 'POST', body: JSON.stringify({ near: !!(PH.connected && PH.near) }) }).catch(() => {});
}
setInterval(reportDesk, 120000);
// for the morning briefing: how many notifications and missed calls in the last 12 hours, and the battery.
// Counts only; the text of a notification never leaves the Car Thing.
let summaryTimer = null;
function sendSummary() {
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => {
    if (!onCarThing || !PH.connected) return;
    const recent = (PH.notes || []).filter((n) => noteMs(n) > Date.now() - 12 * 3600000);
    const calls = recent.filter((n) => n.cat === 2).length;
    fetch('/api/phone/summary', { method: 'POST', body: JSON.stringify({ notes: recent.length - calls, calls, battery: PH.battery }) }).catch(() => {});
  }, 20000);
}
setInterval(sendSummary, 10 * 60000);
function phoneChanged(prev) {
  const wasNear = prev.connected && prev.near, isNear = PH.connected && PH.near;
  // left the desk: the screen goes off and a running focus timer pauses. Not on the first message after a
  // (re)load, which says nothing about where the phone was before.
  if (phoneSeen && wasNear && !isNear) {
    awaySince = awaySince || Date.now();
    fetch('/api/display/away', { method: 'POST', body: '{"away":true}' }).catch(() => {});
    if (pomo.running) pomoToggle();
  }
  if (phoneSeen && !wasNear && isNear && S && S.display && S.display.away) {
    fetch('/api/display/away', { method: 'POST', body: '{"away":false}' }).catch(() => {});
    if (S.display.night && S.display.night.dark) wakeScreen();
    toast(greeting());
  }
  phoneSeen = true;
  // time at the desk is counted on the hub from these reports (plus a heartbeat, see below)
  if (isNear !== deskSent) { deskSent = isNear; reportDesk(); }
  // battery: once per crossing on the way down, and when it reaches full while charging
  const a = prev.battery, b = PH.battery;
  if (a != null && b != null && PH.connected && prev.connected) {
    for (const lvl of [20, 10]) if (a > lvl && b <= lvl) showBanner('down', `🔋 ${tr('iPhone battery at {n}%', { n: b })}`, 15000);
    if (b === 100 && a < 100) showBanner('phone', `🔌 ${tr('iPhone is fully charged: you can unplug it')}`, 15000);
  }
}
function greeting() {
  const h = Number(dtf('en-US', { timeZone: tz(), hour: 'numeric', hourCycle: 'h23' }).format(new Date(now())));
  return tr(h < 5 || h >= 18 ? 'Good evening 👋' : h < 11 ? 'Good morning 👋' : 'Good afternoon 👋');
}

// the screen went dark (night, or the phone left) and came back: what arrived meanwhile
function screenChanged(off) {
  if (off) { awaySince = awaySince || Date.now(); return; }
  const since = awaySince;
  awaySince = null;
  // after a reconnect the phone takes a few seconds to list what it got while away
  if (since && Date.now() - since > 60000) setTimeout(() => showDigest(since), 6000);
}

// "yyyyMMddTHHmmSS" in the phone's local time (taken to be the hub's time zone) → epoch ms
function wallMs(s) {
  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)/.exec(s || '');
  if (!m) return 0;
  const guess = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const p = Object.fromEntries(dtf('en-US', { timeZone: tz(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  return guess - (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - guess);
}
const noteMs = (n) => wallMs(n.date) || n.at;

function showDigest(since) {
  const list = (PH.notes || []).filter((n) => noteMs(n) > since);
  if (!list.length) return;
  const calls = list.filter((n) => n.cat === 2);
  const apps = {};
  for (const n of list) if (n.cat !== 2) apps[n.app || '?'] = (apps[n.app || '?'] || 0) + 1;
  const rows = Object.entries(apps).sort((x, y) => y[1] - x[1])
    .map(([app, k]) => `<div class="dg-row"><span>💬 ${esc(app)}</span><em>${k}</em></div>`);
  if (calls.length) rows.unshift(`<div class="dg-row missed"><span>☎ ${privacy ? tr('Missed calls') : esc([...new Set(calls.map((c) => c.title))].join(', '))}</span><em>${calls.length}</em></div>`);
  $('dgCard').innerHTML = `<b>${tr('While you were away')}</b>${rows.slice(0, 6).join('')}<small>${tr('Any button closes this')}</small>`;
  $('digest').classList.add('on');
  clearTimeout(digestTimer);
  digestTimer = setTimeout(hideDigest, 12000);
}
function hideDigest() {
  clearTimeout(digestTimer);
  const d = $('digest');
  if (!d.classList.contains('on')) return false;
  d.classList.remove('on');
  return true;
}
$('digest').addEventListener('click', hideDigest);

// ---- the iPhone page: what the phone got, newest first; clear one on the phone; Siri and the camera

// a letter on a colour taken from the app's name, instead of an emoji: colour emoji are slow to draw on this chip
function appBadge(n) {
  const name = n.app || '?';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `<span class="ip-ic${n.cat === 2 ? ' call' : ''}" style="--h:${h}">${esc([...name][0].toUpperCase())}</span>`;
}
const SPEAKER = '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
let ipSel = -1, ipConfirm = null, ipConfirmTimer = null;
// the list on the iPhone page: "find my iPhone" first while the phone is connected, then its notifications
const ipItems = () => (PH.connected ? [{ find: true }] : []).concat(PH.notes || []);
// a rough distance from the link's signal (−59 dBm at 1 m; walls and hands make it rougher)
function phoneDistance() {
  if (PH.rssi == null) return '';
  if (PH.rssi > -45) return tr('right here');
  const m = Math.pow(10, (-59 - PH.rssi) / 25);
  return tr('about {m} m away', { m: m < 10 ? m.toFixed(m < 3 ? 1 : 0) : Math.round(m) });
}
function renderIphone() {
  setText($('ipPriv'), tr(privacy ? 'Show messages' : 'Hide messages'));
  const head = $('ipHead'), list = $('ipList');
  if (!onCarThing) { setHTML(head, ''); setHTML(list, `<div class="ip-empty">${tr('Only on the Car Thing')}</div>`); return; }
  if (!PH.paired) {
    setHTML(head, '');
    setHTML(list, `<div class="ip-empty"><b>${tr('No iPhone paired')}</b><span>${tr('Press the knob to pair your iPhone')}</span></div>`);
    return;
  }
  const bars = PH.rssi == null ? 0 : Math.max(1, Math.min(4, Math.round((PH.rssi + 95) / 12)));
  setHTML(head, `<div class="ip-name">${esc(PH.name || 'iPhone')}</div><div class="ip-stat">`
    + (PH.connected ? `<span class="ip-bars b${bars}"><i></i><i></i><i></i><i></i></span>${tr(PH.near ? 'At the desk' : 'Away')}` : tr('Not connected'))
    + (PH.connected && PH.battery != null ? `<span>🔋 ${PH.battery}%</span>` : '') + (privacy ? '<span>🙈</span>' : '') + '</div>');
  const items = ipItems();
  if (ipSel >= items.length) ipSel = items.length - 1;
  // only the rows around the selection: the list shows about six, and every row costs layout when the page slides in
  const from = Math.max(0, Math.min(ipSel - 3, items.length - 8));
  setHTML(list, items.slice(from, from + 8).map((n, j) => [n, from + j]).map(([n, i]) => (n.find
    ? `<div class="ip-row find${i === ipSel ? ' sel' : ''}${finding ? ' on' : ''}" data-i="${i}"><span class="ip-ic">${SPEAKER}</span><div class="ip-tx">`
      + `<div class="ip-ti">${tr(finding ? 'Stop the sound' : 'Find my iPhone')}</div><div class="ip-msg">${tr('Plays music loudly on the iPhone')} · ${phoneDistance()}</div></div></div>`
    : `<div class="ip-row${n.cat === 2 ? ' missed' : ''}${i === ipSel ? ' sel' : ''}${ipConfirm === n.uid ? ' confirm' : ''}" data-i="${i}">`
      + `${appBadge(n)}<div class="ip-tx"><div class="ip-top"><b>${esc(n.app || '')}</b><span>${ago(noteMs(n))}</span></div>`
      + `<div class="ip-ti">${esc(n.title || '')}</div>${privacy || !n.msg ? '' : `<div class="ip-msg">${esc(n.msg)}</div>`}</div></div>`)).join('')
    + (PH.notes && PH.notes.length ? '' : `<div class="ip-empty">${tr(PH.connected ? 'No notifications' : 'The iPhone is not connected')}</div>`));
  pages[PHONE].classList.toggle('browsing', ipSel >= 0);
  // scrolling asks for a layout right away: only while choosing, never while the page is about to slide in
  const sel = ipSel >= 0 && list.children[ipSel - from];
  if (sel && !entering) sel.scrollIntoView({ block: 'nearest' });
}
function ipKnob(step) {
  const k = ipItems().length;
  if (!k) return;
  ipSel = Math.max(0, Math.min(k - 1, ipSel + step));
  ipConfirm = null;
  renderIphone();
}
// press: start choosing; on "find", ring; on a chosen notification, press twice to clear it on the iPhone
function ipPress() {
  if (!PH.paired) return phonePost('/pair');
  const items = ipItems();
  if (ipSel < 0) { if (items.length) { ipSel = 0; renderIphone(); } return; }
  const n = items[ipSel];
  if (!n) return;
  if (n.find) return findPhone();
  clearTimeout(ipConfirmTimer);
  if (ipConfirm === n.uid) {
    ipConfirm = null;
    phonePost('/note/clear', { uid: n.uid });
    toast(tr('Cleared on the iPhone'));
  } else {
    ipConfirm = n.uid;
    toast(tr('Press again to clear it on the iPhone'));
    ipConfirmTimer = setTimeout(() => { ipConfirm = null; if (page === PHONE) renderIphone(); }, 3000);
  }
  renderIphone();
}
function ipBack() {
  if (ipSel < 0) return false;
  ipSel = -1;
  ipConfirm = null;
  renderIphone();
  return true;
}

// Find my iPhone: accessories cannot make the phone ring, but they can press its media keys like a headset:
// volume up to the top, then play (with nothing playing, iOS resumes the last app). After 30 s, or a second
// press, pause again and bring the volume back down the same number of steps.
let finding = null;
function tapKey(key, at) {
  setTimeout(() => phonePost('/key', { key, down: true }), at);
  setTimeout(() => phonePost('/key', { key, down: false }), at + 70);
}
function findPhone() {
  if (finding) return stopFinding();
  if (!PH.connected) return toast(tr('The iPhone is not connected'));
  const m = PH.media || {};
  const steps = Math.round((1 - (m.volume != null ? m.volume : 0)) * 16);
  const play = m.state !== 1; // already playing: just make it loud
  for (let i = 0; i < steps; i++) tapKey('volup', i * 160);
  if (play) tapKey('play', steps * 160 + 150);
  finding = { steps, play, timer: setTimeout(stopFinding, 30000) };
  // nothing came on: the iPhone has no app it can resume
  setTimeout(() => { if (finding && play && !(PH.media && PH.media.state === 1)) toast(tr('No app on the iPhone can play right now')); }, steps * 160 + 4000);
  toast(tr('Playing on the iPhone for 30 s'));
  renderIphone();
}
function stopFinding() {
  if (!finding) return;
  const { steps, play, timer } = finding;
  clearTimeout(timer);
  finding = null;
  if (play) tapKey('play', 0);
  for (let i = 0; i < steps; i++) tapKey('voldown', 250 + i * 160);
  if (page === PHONE) renderIphone();
}

// Reply: Apple lets accessories only accept or dismiss a notification, so the reply goes through Siri on the
// phone. Button 4 opens Siri and shows whom to answer; Siri takes the message and sends it.
function replyBySiri() {
  const items = ipItems();
  const n = (items[ipSel] && !items[ipSel].find ? items[ipSel] : null) || (PH.notes || [])[0];
  if (!n) return toast(tr('No notifications'));
  phonePost('/key', { key: 'siri', down: true });
  setTimeout(() => phonePost('/key', { key: 'siri', down: false }), 300);
  showBanner('phone', `🎙 ${tr('Siri is listening: say “Reply to {n}” and your message', { n: n.title || n.app })}`, 10000);
}
function togglePrivacy() {
  privacy = !privacy;
  try { localStorage.setItem('privacy', privacy ? '1' : '0'); } catch {}
  toast(tr(privacy ? 'Messages hidden on this screen' : 'Messages shown'));
  renderIphone();
}
$('ipList').addEventListener('click', (e) => {
  const row = e.target.closest('.ip-row');
  if (!row) return;
  ipSel = Number(row.dataset.i);
  ipPress();
});

function renderPairing() {
  const p = PH.pairing;
  $('pair').classList.toggle('on', !!p);
  if (!p) return;
  setText($('pairCode'), p.passkey ? p.passkey.replace(/(\d{3})(\d{3})/, '$1 $2') : '');
  setText($('pairHelp'), p.passkey
    ? tr('Type this code on your iPhone')
    : tr('On the iPhone: Settings → Bluetooth → tap “Desk Hub” (or “{a}”, if this iPhone met the Car Thing before)', { a: p.alias || 'Nocturne' }));
  setText($('pairLeft'), tr('{s} s left · Back to cancel', { s: Math.max(0, Math.round((p.until - Date.now()) / 1000)) }));
}

function phoneMenu() {
  if (!PH.paired) { setModeTo(null); return phonePost('/pair'); }
  setModeTo('confirm'); // paired: pressing again forgets it
}

$('callYes').addEventListener('click', () => phonePost('/call', { action: 'answer' }));
$('callNo').addEventListener('click', () => phonePost('/call', { action: 'decline' }));
$('pair').addEventListener('click', () => phonePost('/pair/cancel'));

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
  $('askChip').textContent = v.configured === false ? tr('needs a key') : { idle: tr('ready'), starting: tr('getting ready'), listening: tr('listening · {n}s', { n: secs }), thinking: tr(v.kind === 'briefing' ? 'writing your briefing' : 'thinking'), answer: tr(v.kind === 'briefing' ? 'briefing' : 'answered'), error: tr('oops') }[phase];
  $('askHint').textContent = v.configured === false
    ? tr('Gemini API key not set on the hub yet')
    : { idle: tr('Press the knob and ask me anything · button 1 for today’s briefing'), starting: tr('Waking up the microphone… start talking when it says Listening'), listening: tr('Press the knob when you are done · max {n}s', { n: v.maxSeconds }), thinking: tr('Hmm, let me think…'), answer: tr('Press the knob to ask again · Back to close'), error: tr('Press the knob to try again · Back to close') }[phase];
  const bubble = $('askBubble');
  if (phase === 'answer' || phase === 'error') {
    bubble.className = `ask-bubble on ${phase}${v.kind === "briefing" ? " briefing" : ""}`;
    $('askQ').textContent = v.kind === 'briefing' ? tr('Your briefing for today') : v.transcript ? `“${v.transcript}”` : '';
    $('askA').textContent = tr((phase === 'error' ? v.error : v.answer) || ''); // fixed hub messages have translations
    const src = phase === 'answer' ? [
      (v.searches || []).length ? tr('Searched Google: {q}', { q: v.searches.join(' · ') }) : '',
      (v.sources || []).length ? tr('Sources: {s}', { s: v.sources.join(', ') }) : '',
    ].filter(Boolean).join('\n') : '';
    $('askSrc').textContent = src;
  } else {
    bubble.className = 'ask-bubble';
  }
  $('askHello').style.display = phase === 'idle' ? '' : 'none';
  $('askMeter').style.width = `${(100 * secs) / (v.maxSeconds || 15)}%`;
}

// the page the user came from before opening Mei (Mei answers about it)
let ctxPage = NEWS;
function briefingNow() {
  fetch('/api/voice/briefing', { method: 'POST' })
    .then((r) => { if (!r.ok) toast(tr(r.status === 403 ? 'Briefings start on the Car Thing only' : 'Assistant unavailable')); })
    .catch(() => toast(tr('Could not reach the hub')));
}

// a new briefing (scheduled in the morning) brings Mei's page forward unless you are busy with something
let briefSeen = null;
function watchBriefing() {
  const v = S.voice || {};
  const key = v.kind === 'briefing' && v.phase === 'answer' ? v.at : 0;
  if (briefSeen === null) { briefSeen = key; return; }
  if (!key || key === briefSeen) return;
  briefSeen = key;
  if (page !== ASK && !setMode && !editing && !newsDetail && newsSel < 0 && !zoom) setPage(ASK);
}

function askToggle() {
  const phase = S && S.voice && S.voice.phase;
  if (phase === 'thinking') return;
  const act = phase === 'listening' || phase === 'starting' ? 'stop' : 'start';
  // what was on screen, so "what does this story say?" works (Mei's page itself has no context)
  const ctx = { page: pages[ctxPage].dataset.name, story: ctxPage === NEWS && newsDetail ? newsDetail : undefined };
  fetch(`/api/voice/${act}`, { method: 'POST', body: act === 'start' ? JSON.stringify(ctx) : '' })
    .then((r) => { if (!r.ok) toast(tr(r.status === 403 ? 'Mei only listens on the Car Thing' : 'Assistant unavailable')); })
    .catch(() => toast(tr('Could not reach the hub')));
}


// ---------------------------------------------------------------- quick menu (round settings button, top right)

let setMode = null; // null (closed) | 'menu' | 'bright' | 'confirm'
let setIdx = 0;     // 0 brightness, 1 restart, 2 shut down, 3 rotate, 4 language, 5 iPhone, 6 desk clock
const TILES = 7;
let setTimer = null;

function renderSettings() {
  $('overlay').classList.toggle('on', setMode != null);
  document.querySelectorAll('.ov-tile').forEach((el, i) => {
    el.classList.toggle('sel', i === setIdx);
    el.classList.toggle('confirm', setMode === 'confirm' && i === setIdx);
  });
  $('ovSlider').classList.toggle('active', setMode === 'bright');
  $('setHint').textContent = setMode === 'bright'
    ? tr('Turn the knob to change brightness · press the knob or Back when done')
    : setMode === 'confirm'
      ? tr(setIdx === 1 ? 'Press the knob again to restart · Back to cancel' : setIdx === 5 ? 'Press the knob again to forget this iPhone · Back to cancel' : 'Press the knob again to shut down · Back to cancel')
      : tr('Turn the knob to choose · press the knob to select · Back to close');
}

function setModeTo(m) {
  setMode = m;
  renderSettings();
  renderBrightness();
  clearTimeout(setTimer);
  if (m) setTimer = setTimeout(() => setModeTo(null), 20000);
}

function confirmed() {
  if (setIdx === 5) { setModeTo(null); return phonePost('/forget'); }
  deviceAction(setIdx === 1 ? 'reboot' : 'poweroff');
}

function deviceAction(act) {
  fetch(`/api/device/${act}`, { method: 'POST' })
    .then((r) => toast(tr(r.ok ? (act === 'reboot' ? 'Restarting the Car Thing…' : 'Shutting down — unplug and replug to start again') : 'Only the Car Thing can do this')))
    .catch(() => toast(tr('Could not reach the hub')));
  setModeTo(null);
}

function settingsKnob(step) {
  if (setMode === 'menu') { setIdx = (setIdx + step + TILES) % TILES; setModeTo('menu'); }
  else if (setMode === 'bright') { brightAdjust(step); setModeTo('bright'); }
  else if (setMode === 'confirm') setModeTo('menu');
}

function settingsPress() {
  if (setMode === 'menu') { if (setIdx === 3) return rotate(); if (setIdx === 4) return switchLang(); if (setIdx === 5) return phoneMenu(); if (setIdx === 6) return showAmbient(); return setModeTo(setIdx === 0 ? 'bright' : 'confirm'); }
  if (setMode === 'bright') return setModeTo('menu');
  if (setMode === 'confirm') confirmed();
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
    const x = e.target === track || e.target.parentElement === track ? e.offsetX : track.offsetWidth / 2;
    const pct = Math.round(Math.max(5, Math.min(100, (x / track.offsetWidth) * 100)) / 5) * 5;
    brightAdjust((pct - (brightPending ?? (S && S.display ? S.display.brightness : 80))) / 5);
    setIdx = 0;
    return setModeTo('bright');
  }
  if (tile) {
    const i = Number(tile.dataset.i);
    if (setMode === 'confirm' && i === setIdx) return confirmed();
    setIdx = i;
    if (i === 3) return rotate();
    if (i === 4) return switchLang();
    if (i === 5) return phoneMenu();
    if (i === 6) return showAmbient();
    return setModeTo(i === 0 ? 'bright' : 'confirm');
  }
  if (!e.target.closest('.ov-panel')) setModeTo(null);
});

// ---------------------------------------------------------------- motion helpers

// odometer: each digit is a reel of 0-9 that rolls to its new value
function odometer(el, text) {
  if (el.dataset.text === text) return;
  const chars = [...text];
  if (el.children.length !== chars.length || el.dataset.shape !== text.replace(/\d/g, '0')) {
    el.innerHTML = chars.map((ch) => (/\d/.test(ch)
      ? `<span class="d"><span class="reel">${'0123456789'.split('').map((n) => `<span>${n}</span>`).join('')}</span></span>`
      : `<span class="s">${ch}</span>`)).join('');
    el.dataset.shape = text.replace(/\d/g, '0');
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
  pill.style.width = `${on.offsetWidth}px`; // width snaps; only the position animates (on the GPU)
  pill.style.transform = `translateX(${on.offsetLeft}px)`;
}

// Page slide: the old and new page move side by side, fully opaque, so nothing ever shows through
// (a cross-fade is what looked like ghosting). A new turn of the knob finishes the running slide at once,
// so at most two pages are ever on screen. Data that arrives during a slide is drawn when it ends.
let slide = null, slideStage = 0, pendingRender = false;
const SLIDE = { duration: 260, easing: 'cubic-bezier(.22, .8, .24, 1)' };
function transition(from, to, dir) {
  finishSlide();
  // the width is known from the orientation, so nothing has to be measured (measuring forces a layout)
  const w = document.body.classList.contains('portrait') ? 480 : 800;
  from.classList.add('slide', 'leaving');
  to.classList.add('slide');
  to.style.transform = `translate3d(${dir * w}px,0,0)`;
  document.body.classList.add('sliding');
  slide = { from, to, anims: [] };
  // Give the new page two frames to be laid out and drawn just off screen, then move both pages.
  // Starting at once dropped the first few frames of every slide while that work happened.
  const stage = ++slideStage;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (stage !== slideStage || !slide) return;
    to.style.transform = '';
    movePill();
    slide.anims = [
      from.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-dir * w}px,0,0)` }], SLIDE),
      to.animate([{ transform: `translate3d(${dir * w}px,0,0)` }, { transform: 'translate3d(0,0,0)' }], SLIDE),
    ];
    slide.anims[1].onfinish = finishSlide;
  }));
}
function finishSlide() {
  if (!slide) return;
  const s = slide;
  slide = null;
  slideStage++;
  s.anims.forEach((a) => a.cancel());
  s.to.style.transform = '';
  pages.forEach((p) => p.classList.remove('slide', 'leaving'));
  document.body.classList.remove('sliding');
  if (pendingRender) { pendingRender = false; render(); }
}

// Lay out every page once while the screen is idle, so the first visit to a page slides as smoothly
// as the tenth. content-visibility keeps that layout while the page is hidden.
function warmUp(i = 0) {
  if (i >= pages.length) return;
  if (i !== page && RENDER[i]) {
    try { RENDER[i](); } catch (e) { console.error(e); }
    pages[i].classList.add('warm');
    void pages[i].offsetHeight;
    pages[i].classList.remove('warm');
  }
  setTimeout(() => warmUp(i + 1), 300);
}

// ---------------------------------------------------------------- screen orientation (landscape, portrait turned right, portrait turned left)

// each press turns the screen another 90° clockwise: 0°, 90°, 180°, 270°
const ORIENTS = ['land', 'cw', 'flip', 'ccw'];
const ORIENT_NAME = { land: 'Landscape', cw: 'Portrait ↻', flip: 'Upside down', ccw: 'Portrait ↺' };
let orient = 'land';
try { orient = ORIENTS.includes(localStorage.getItem('orient')) ? localStorage.getItem('orient') : 'land'; } catch {}
function applyOrient() {
  document.body.dataset.orient = orient;
  document.body.classList.toggle('portrait', orient === 'cw' || orient === 'ccw');
  $('rotLabel').textContent = tr(ORIENT_NAME[orient]);
  requestAnimationFrame(movePill);
}
function rotate() {
  orient = ORIENTS[(ORIENTS.indexOf(orient) + 1) % ORIENTS.length];
  try { localStorage.setItem('orient', orient); } catch {}
  applyOrient();
  toast(tr(ORIENT_NAME[orient]));
  setModeTo('menu');
}
applyOrient();

// ---------------------------------------------------------------- language (English / Tiếng Việt), kept on the hub

function switchLang() {
  const next = lang === 'vi' ? 'en' : 'vi';
  fetch('/api/display/lang', { method: 'POST', body: JSON.stringify({ lang: next }) })
    .then((r) => { if (!r.ok) toast(tr('Language can only be changed on the Car Thing')); })
    .catch(() => toast(tr('Could not reach the hub')));
  setModeTo('menu');
}
// called on every update: redraws the static text and the open page when the hub's language changes
function applyLang() {
  const want = S && S.display && S.display.lang === 'vi' ? 'vi' : 'en';
  if (want === lang && applyLang.done) return;
  lang = want;
  applyLang.done = true;
  try { localStorage.setItem('lang', lang); } catch {}
  applyStaticText();
  $('langLabel').textContent = lang === 'vi' ? 'Tiếng Việt' : 'English';
  applyOrient();
  renderSettings();
  $('tabs').innerHTML = pages.map((p, j) => `<span class="tab ${j === page ? 'on' : ''}">${tr(p.dataset.name)}</span>`).join('');
  requestAnimationFrame(movePill);
  tickClock();
}
applyStaticText();

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
  if (page === ASK && prev !== ASK) ctxPage = prev;
  setEditing(false);
  if (setMode) setModeTo(null);
  if (zoom) { zoom = 0; renderZoom(); }
  if (alertEdit) { alertEdit = null; renderAlertEdit(); }
  // the open story stays open behind Mei's page, so you can ask her about it
  if (page !== ASK && (newsSel >= 0 || newsDetail)) { closeDetail(); newsSel = -1; }
  const dir = page === prev ? 0 : (i > prev ? 1 : -1);
  // the knob changes pages; the four preset buttons act on the page that is open.
  // Move the pill first: reading its size forces a layout, which is cheap while only the top bar changed.
  [...$('tabs').children].forEach((t, j) => t.classList.toggle('on', j === page));
  finishSlide();
  pages.forEach((p, j) => p.classList.toggle('on', j === page));
  document.body.dataset.page = page;
  if (page === ASK) mitStart();
  if (page !== PHONE) { ipSel = -1; ipConfirm = null; }
  if (page !== MUSIC) leaveImmersive();
  // build the incoming page before it starts to move, so the slide's first frame is not a long one
  entering = true;
  try { render(); } finally { entering = false; }
  // the gold pill moves together with the pages (see transition); started earlier, its first frames were
  // dropped while the new page was being built
  if (dir) transition(pages[prev], pages[page], dir); else movePill();
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('on'), 2500);
}

function knob(step) {
  if (PH.call || PH.pairing) return;
  if (setMode) return settingsKnob(step);
  if (alertEdit) return alertKnob(step);
  if (page === NEWS && (newsSel >= 0 || newsDetail)) return newsKnob(step);
  if (page === PHONE && ipSel >= 0) return ipKnob(step);
  if (!editing) return setPage(page + step);
  setEditing(true); // keep edit mode alive while turning
  if (page === MUSIC) volumeAdjust(step);
  else if (page === FOCUS) pomoAdjust(step);
}

function back() {
  if (setMode) return settingsBack();
  if (alertEdit) { alertEdit = null; return renderAlertEdit(); }
  if (page === MARKETS && zoom) return marketZoom(zoom);
  if (page === NEWS && newsBack()) return;
  if (page === PHONE && ipBack()) return;
  if (page === ASK && S && ['answer', 'error'].includes(S.voice && S.voice.phase)) return void fetch('/api/voice/dismiss', { method: 'POST' }).catch(() => {});
  if (editing) setEditing(false); // Back only ever leaves a mode; the knob press enters one
}

function press() {
  if (setMode) return settingsPress();
  if (page === MARKETS && zoom) return alertEdit ? alertSave() : alertStart();
  if (page === ASK) askToggle();
  else if (page === NEWS) newsEnter();
  else if (page === MUSIC) setEditing(!editing); // volume mode; play/pause is button 2
  else if (page === FOCUS) pomoToggle();
  else if (page === PHONE) ipPress();
  else if (page === WORDS) { wdFlip = !wdFlip; renderWords(); }
  else if (editing) setEditing(false);
}

// ---------------------------------------------------------------- night: the screen is off; the first touch only wakes it

let wakeSent = 0, wokeAt = 0;
// the screen is dark at night, and while the paired iPhone is away from the desk
const screenOff = () => !!(S && S.display && ((S.display.night && S.display.night.dark) || S.display.away));
function wakeScreen() { fetch('/api/display/wake', { method: 'POST' }).catch(() => {}); }
function nightGate() {
  // the phone left and the screen went off: any touch brings it back
  if (S && S.display && S.display.away) {
    const t = Date.now();
    if (t - wakeSent > 3000) { wakeSent = wokeAt = t; fetch('/api/display/away', { method: 'POST', body: '{"away":false}' }).catch(() => {}); }
    return true;
  }
  const n = S && S.display && S.display.night;
  if (!n || !n.active) return false;
  const t = Date.now();
  // while dark, ask once; while awake, keep extending the wake time as you use it
  if ((n.dark && t - wakeSent > 3000) || (!n.dark && t - wakeSent > 20000)) {
    wakeSent = t;
    if (n.dark) wokeAt = t;
    fetch('/api/display/wake', { method: 'POST' }).catch(() => {});
  }
  // the backlight needs up to 2 s to come on: input until then still belongs to the waking touch
  return n.dark || t - wokeAt < 2500;
}
// taps on the dark screen must not press whatever is under the finger
addEventListener('click', (e) => { if (screenOff()) { e.stopPropagation(); e.preventDefault(); } }, true);

addEventListener('keydown', (e) => {
  if (nightGate()) return;
  const k = e.key;
  // on the desk clock the knob feeds the torch; anything else leaves it
  if (ambientOn() && /^Arrow/.test(k)) return window.deskTorch.fuel(k === 'ArrowRight' || k === 'ArrowDown' ? 1 : -1);
  // the first key only closes the "while you were away" card, or leaves immersive Music
  if (hideDigest() | leaveImmersive()) return;
  const isBack = k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack';
  // a ringing call or an open pairing window owns the buttons until it is over
  if (PH.call) {
    if (k === 'Enter' || k === ' ') phonePost('/call', { action: 'answer' });
    else if (isBack) phonePost('/call', { action: 'decline' });
    return;
  }
  if (PH.pairing) { if (isBack) phonePost('/pair/cancel'); return; }
  // upside down, the preset buttons sit along the bottom in reverse order: keep 1 on the left
  if (/^[1-4]$/.test(k)) {
    const n = orient === 'flip' ? 5 - Number(k) : Number(k);
    // on the iPhone page, 1 and 2 are keys of the phone's remote: Siri and the camera shutter, held as long as you hold
    if (page === PHONE && HOLD[n]) { if (!e.repeat && !held) { held = HOLD[n]; phonePost('/key', { key: held, down: true }); } return; }
    return presetButton(n);
  }
  // the knob press, Back and the round settings button (top right) act when released, so that holding them
  // can do something else (see LONG below)
  const kind = keyKind(k);
  if (kind) { if (!e.repeat && !pressing) pressing = { kind, long: false, timer: setTimeout(longPress, LONG_MS) }; return; }
  if (k === 'ArrowRight' || k === 'ArrowDown') return knob(1);
  if (k === 'ArrowLeft' || k === 'ArrowUp') return knob(-1);
});

const HOLD = { 1: 'siri', 2: 'shutter' };
let held = null;

// Held for 0.6 s: the knob plays or pauses music from any page, Back goes home to News, the round button
// switches the screen off (any touch brings it back)
const LONG_MS = 600;
let pressing = null;
const keyKind = (k) => (k === 'Enter' || k === ' ' ? 'enter' : k === 'm' || k === 'M' ? 'menu'
  : k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack' ? 'back' : null);
const SHORT = { enter: () => press(), back: () => back(), menu: () => settingsButton() };
const LONG = {
  enter() { musicAction('toggle'); toast('⏯'); },
  back() {
    if (setMode) setModeTo(null);
    if (editing) setEditing(false);
    if (zoom) { zoom = 0; renderZoom(); }
    if (page !== NEWS) setPage(NEWS);
  },
  menu() {
    if (setMode) setModeTo(null);
    fetch('/api/display/away', { method: 'POST', body: '{"away":true}' }).catch(() => {});
  },
};
function longPress() {
  if (!pressing) return;
  pressing.long = true;
  LONG[pressing.kind]();
}
addEventListener('keyup', (e) => {
  const kind = keyKind(e.key);
  if (kind && pressing && pressing.kind === kind) {
    clearTimeout(pressing.timer);
    const p = pressing;
    pressing = null;
    if (!p.long) SHORT[kind]();
  }
  if (held && /^[1-4]$/.test(e.key)) { phonePost('/key', { key: held, down: false }); held = null; }
});

let wheelAcc = 0, wheelAt = 0;
addEventListener('wheel', (e) => {
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  const t = Date.now();
  if (t - wheelAt > 400) wheelAcc = 0;
  wheelAt = t;
  wheelAcc += d;
  if (Math.abs(wheelAcc) >= 1) { const dir = wheelAcc > 0 ? 1 : -1; wheelAcc = 0; if (ambientOn()) window.deskTorch.fuel(dir); else if (!nightGate() && !(hideDigest() | leaveImmersive())) knob(dir); }
}, { passive: true });

// touch: swipe left/right to change page; tap to talk to Mei or start/pause the focus timer.
// Touch points come in screen coordinates; turn them into the app's own (rotated) coordinates first.
function appX(t) {
  return { land: t.clientX, flip: 800 - t.clientX, cw: t.clientY, ccw: 480 - t.clientY }[orient];
}
let tx = null;
addEventListener('touchstart', (e) => { tx = appX(e.touches[0]); }, { passive: true });
addEventListener('touchend', (e) => {
  if (tx == null || setMode || PH.call || PH.pairing) { tx = null; return; }
  if (nightGate() || hideDigest() | leaveImmersive()) { tx = null; return; }
  const dx = appX(e.changedTouches[0]) - tx;
  tx = null;
  if (Math.abs(dx) > 60) setPage(page + (dx < 0 ? 1 : -1));
  else if (page === FOCUS) pomoToggle();
  else if (page === ASK) askToggle();
});

// ---------------------------------------------------------------- clock + data stream

function tickClock() {
  setText($('clock'), dtf(loc(), { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(new Date(now())));
  pomoTick();
  musicProgress();
  if (PH.pairing) renderPairing();
  immersiveCheck();
  ambientCheck();
  if (page === PHONE && new Date().getSeconds() % 30 === 0) renderIphone(); // "5m ago" labels
  if (S && page === ASK) renderAsk();
  if (S && page === CALENDAR && new Date().getSeconds() === 0) renderCalendar();
  checkLink();
}

// ---------------------------------------------------------------- time at the desk (Focus page), counted on the hub
function renderDesk() {
  const d = S && S.desk;
  if (!d || !d.week.some((w) => w.minutes)) return setHTML($('desk'), '');
  const max = Math.max(60, ...d.week.map((w) => w.minutes));
  const hm = (min) => tr('{h} h {m} min', { h: Math.floor(min / 60), m: min % 60 });
  setHTML($('desk'), `<div class="dk-top"><span>${tr('At the desk today')}</span><b>${hm(d.today)}</b>`
    + `${d.near && d.streak ? `<em>${tr('{m} min without a break', { m: d.streak })}</em>` : ''}</div>`
    + `<div class="dk-week">${d.week.map((w, i) => `<div class="dk-day${i === 6 ? ' today' : ''}"><i style="height:${Math.round((w.minutes / max) * 40)}px"></i><span>${tr(w.day)}</span></div>`).join('')}</div>`);
}

// ---------------------------------------------------------------- words: vocabulary cards (the schedule is on the hub)
let wdFlip = false, wdShown = null;
function renderWords() {
  const w = S.words, card = $('wdCard'), foot = $('wdFoot');
  if (!w || !w.configured) { setHTML(card, `<div class="wd-empty">${tr('Vocabulary cards need GEMINI_API_KEY on the hub.')}</div>`); setHTML(foot, ''); return; }
  const c = w.due[0];
  if (!c) {
    card.classList.remove('flip');
    setHTML(card, `<div class="wd-empty"><b>${tr('All done for today 🎉')}</b><span>${tr('{n} words learned so far', { n: w.learned })}</span></div>`);
    setHTML(foot, `<span><i class="kb">3</i>${tr('5 more words')}</span>`);
    return;
  }
  if (wdShown !== c.id) { wdShown = c.id; wdFlip = false; }
  card.classList.toggle('flip', wdFlip);
  setHTML(card, `<div class="wd-word">${esc(c.word)}</div><div class="wd-ipa">${esc(c.ipa)}${c.pos ? ` · ${esc(tr(c.pos))}` : ''}</div>`
    + (wdFlip
      ? `<div class="wd-vi">${esc(c.vi)}</div><div class="wd-ex">${esc(c.ex)}</div><div class="wd-exvi">${esc(c.exVi)}</div>`
      : `<div class="wd-hint">${tr('Press the knob to see the meaning')}</div>`));
  setHTML(foot, `<span>${tr('{n} left today', { n: w.left })}</span><span><i class="kb">1</i>${tr('Knew it')}</span>`
    + `<span><i class="kb">2</i>${tr('Not yet')}</span><span><i class="kb">3</i>${tr('5 more words')}</span>`);
}
function wordGrade(known) {
  const c = S.words && S.words.due[0];
  if (!c) return;
  // move on at once; the hub sends the new list (a forgotten word comes back at the end)
  S.words.due.shift();
  S.words.left = Math.max(0, S.words.left - 1);
  wdShown = null;
  renderWords();
  fetch('/api/words/grade', { method: 'POST', body: JSON.stringify({ id: c.id, known }) }).catch(() => {});
}
function wordsMore() {
  fetch('/api/words/more', { method: 'POST' }).then((r) => toast(tr(r.ok ? 'Fetching 5 more words…' : 'Only the Car Thing can do this'))).catch(() => {});
}

const RENDER = { [WORDS]: renderWords, [FOCUS]: renderDesk, [NEWS]: renderNews, [MARKETS]: renderMarkets, [ASK]: renderAsk, [WEATHER]: renderWeather, [CALENDAR]: renderCalendar, [MUSIC]: renderMusic, [SERVERS]: renderServers, [PHONE]: renderIphone };
function render() {
  if (!S) return;
  applyLang();
  try { RENDER[page] && RENDER[page](); } catch (e) { console.error(e); }
  if (zoom && page === MARKETS) try { renderZoom(); } catch (e) { console.error(e); }
  try { renderAlerts(); } catch (e) { console.error(e); }
  try { watchBriefing(); calReminders(); } catch (e) { console.error(e); }
  if (setMode) renderBrightness();
  const off = screenOff();
  document.body.classList.toggle('night-dark', off);
  if (off !== !!render.off) { render.off = off; screenChanged(off); }
  if (!render.sky && S.weather) { render.sky = true; try { renderWeather(); } catch {} } // sky colour on first load
}

// The hub sends data on every change and a heartbeat every 10 s. If both stop, say so on screen and
// keep reconnecting; when the hub comes back with a new version (it restarted), reload to pick it up.
let es = null, lastMsg = Date.now(), hubVersion = null;
function heard(msg) {
  lastMsg = Date.now();
  clockOffset = msg.t - Date.now();
  if (msg.v) {
    if (hubVersion && msg.v !== hubVersion) return location.reload();
    hubVersion = msg.v;
  }
}
function connect() {
  if (es) es.close();
  es = new EventSource('/events');
  es.onopen = () => $('conn').classList.add('ok');
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    heard(msg);
    S = msg.state;
    if (slide) pendingRender = true; else render();
    if (!warmUp.started) { warmUp.started = true; setTimeout(warmUp, 1500); }
  };
  es.addEventListener('hb', (ev) => heard(JSON.parse(ev.data)));
  es.onerror = () => $('conn').classList.remove('ok');
}
function checkLink() {
  const quiet = Date.now() - lastMsg;
  const lost = quiet > 25000;
  if (lost !== $('offline').classList.contains('on')) $('offline').classList.toggle('on', lost);
  if (!lost) return;
  $('offSince').textContent = quiet < 120000 ? `${Math.round(quiet / 1000)} s` : `${Math.round(quiet / 60000)} min`;
  // EventSource retries on its own, but not after every kind of failure; start a fresh one every 30 s
  if (Math.floor(quiet / 1000) % 30 === 0) connect();
}

renderSettings();
$('tabs').innerHTML = pages.map((p) => `<span class="tab">${tr(p.dataset.name)}</span>`).join('');
setPage(0);
tickClock();
setInterval(tickClock, 1000);
setInterval(render, 15000);
connect();
phoneConnect();

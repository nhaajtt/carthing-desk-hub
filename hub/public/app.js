'use strict';

const $ = (id) => document.getElementById(id);
const pages = [...document.querySelectorAll('.page')];
// page order: News, Markets, Weather, Calendar, Music, Servers, Focus, Mei (Ask). Settings is a pop-up menu, not a page.
const NEWS = 0, MARKETS = 1, WEATHER = 2, CALENDAR = 3, MUSIC = 4, SERVERS = 5, FOCUS = 6, ASK = 7;
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
  $('heroMeta').innerHTML = `<span>${tr('24h low')} ${usd(btc.low24h)}</span><span>${tr('high')} ${usd(btc.high24h)}</span>`;
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
  setVal(el, 'xau', m.xau, `<span class="label">${tr('Gold')}<small>XAU/USD · oz</small></span><span class="val">${usd(m.xau)}</span>${chg(y.gold ? pct(y.gold.price, y.gold.prev) : null)}`);
  el = rowEl(gold, 'xag');
  el.className += stale(m.at, 120000);
  setVal(el, 'xag', m.xag, `<span class="label">${tr('Silver')}<small>XAG/USD · oz</small></span><span class="val">${num(m.xag, 2)}</span>${chg(y.silver ? pct(y.silver.price, y.silver.prev) : null)}`);
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
  if (z._html !== html) { z._html = html; z.innerHTML = html; }
}
function marketZoom(n) { zoom = zoom === n ? 0 : n; renderZoom(); }

// ---------------------------------------------------------------- preset buttons: what 1-4 do depends on the page

function presetButton(n) {
  if (setMode) return;
  if (page === NEWS && n <= 2) return newsTopic(newsCat + (n === 1 ? 1 : -1));
  if (page === MARKETS) return marketZoom(n);
  if (page === ASK && n === 1) return briefingNow();
  if (page === WEATHER && n === 1) return toggleUnit();
  if (page === CALENDAR && n <= 3) { calView = n - 1; return renderCalendar(); }
  if (page === SERVERS) { srvView = n - 1; return renderServers(); }
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
    b.textContent = `${{ up: '▲', down: '▼', sec: '⚠', rain: '☔', ci: '✖' }[newest.dir] || '•'} ${newest.text}`;
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
  $('wxNow').innerHTML = `
    <div class="icon">${cur.is_day ? icon : icon.replace('☀️', '🌙').replace('🌤️', '🌙')}</div>
    <div><div class="temp">${Math.round(deg(cur.temperature_2m))}°</div></div>
    <div><div class="desc">${desc} · ${S.city}</div>
      <div class="sub">${tr('Feels like {v}', { v: Math.round(deg(cur.apparent_temperature)) + '°' })} · ${tr('Humidity {v}%', { v: cur.relative_humidity_2m })}<br>
      ${tr('Wind {v}', { v: windText(cur.wind_speed_10m) })} · UV ${a.uv_index != null ? num(a.uv_index, 0) : '—'}<br>
      ${tr('Today {v}', { v: `${Math.round(deg(w.daily[0].min))}° – ${Math.round(deg(w.daily[0].max))}${degSym()}` })}</div>
      <div class="wx-unit"><i class="kb">1</i>${tr('switch to {u}', { u: wantF() ? '°C' : '°F' })}</div></div>
    <div class="aqi"><div class="l">${tr('AQI (US)')}</div><div class="n" style="color:${ac}">${a.us_aqi ?? '—'}</div><div class="l">${al} · PM2.5 ${a.pm2_5 != null ? num(a.pm2_5, 0) : '—'}</div></div>`;
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
    rain.innerHTML = `<span class="wr-t">${text ? '☔ ' + esc(text) : tr('No rain in the next 2 hours')}</span><span class="wr-bars">${bars}</span><span class="wr-k">${tr('now · 2 h')}</span>`;
  } else rain.className = 'wx-rain';
  $('wxHourly').innerHTML = w.hourly.map((h) => `<div>${hourLabel(h.t)}<span>${wmo(h.code)[1]}</span><b>${Math.round(deg(h.temp))}°</b>${h.pop ?? 0}%</div>`).join('');
  const dn = new Intl.DateTimeFormat(loc(), { timeZone: 'UTC', weekday: 'short' });
  $('wxDaily').innerHTML = w.daily.map((d, i) => {
    const day = i === 0 ? tr('Today') : dn.format(new Date(d.t + 'T12:00:00Z'));
    return `<div class="day"><span class="ic">${wmo(d.code)[1]}</span><div class="tx">${tr('{day} · {p}% rain', { day, p: d.pop ?? 0 })}<b>${Math.round(deg(d.min))}° – ${Math.round(deg(d.max))}°</b></div></div>`;
  }).join('');
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
      $('newsList').classList.remove('swap'); void $('newsList').offsetWidth; $('newsList').classList.add('swap');
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
const dayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(new Date(ms));
const timeOf = (ms) => (lang === 'vi'
  ? new Intl.DateTimeFormat('vi-VN', { timeZone: tz(), hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
  : new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).replace(':00', '').replace(/\s/g, '').toLowerCase());
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
  const part = (o) => new Intl.DateTimeFormat(loc(), { timeZone: tz(), ...o }).format(d);
  const views = CAL_VIEWS.map((v, i) => `<span class="nc ${i === calView ? 'on' : ''}"><i class="kb">${i + 1}</i>${tr(v)}</span>`).join('');
  const headHtml = `<div class="cal-date"><b>${part({ day: 'numeric' })}</b><span>${part({ weekday: 'long' })}<small>${part({ month: 'long', year: 'numeric' })}</small></span></div><div class="cal-views">${views}</div>`;
  const head = $('calHead');
  if (head._html !== headHtml) { head._html = headHtml; head.innerHTML = headHtml; }

  if (!c.configured) {
    $('calNext').className = 'cal-next';
    $('calNext').innerHTML = `<span class="cn-k">${tr('Next up')}</span><b>${tr('No calendar linked')}</b><span class="cn-t">${tr('Run set-calendar-url.sh on server 2')}</span>`;
    $('calList').innerHTML = `<div class="cal-none">${tr('Paste the secret iCal address of your Google Calendar into set-calendar-url.sh on server 2, and your events show up here.')}</div>`;
    $('calList')._html = '';
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
    ? new Intl.DateTimeFormat(loc(), { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(k + 'T12:00:00Z'))
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
  return `<div class="meter"><span class="k">${tr(k)}</span><div class="track"><div class="fill ${cls}" style="width:${p}%"></div></div><span class="v">${text}</span></div>`;
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
  $('srvAlt').className = 'srv-alt v' + srvView;
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
  const col = (key, name) => {
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
      <div class="hg-x"><span>${tr('24 h ago')}</span><span>${tr('12 h')}</span><span>${tr('now')}</span></div></div>`;
  };
  return col('server2', 'Server 2') + col('server1', 'Server 1');
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
    $('srv2').className = 'srv' + stale(s2.at, 30000);
    $('srv2').innerHTML = `
      <div class="head"><div><b>Server 2</b> <span>${s2.ip} · ${tr('laptop')}</span></div><span class="state up">${tr('Online')}</span></div>
      ${statsBlock(s2, s2.battery != null ? meter('Battery', s2.battery / 100, `${s2.battery}%`, true) : '')}
      ${containersBlock(s2.containers)}`;
  }
  const s1 = S.servers.server1;
  if (s1) {
    const st = s1.stats && now() - s1.stats.at < 60000 ? s1.stats : null;
    $('srv1').className = 'srv' + stale(s1.at, 60000);
    $('srv1').innerHTML = `
      <div class="head"><div><b>Server 1</b> <span>${s1.ip} · BRIX</span></div><span class="state ${s1.online ? 'up' : 'down'}">${tr(s1.online ? 'Online' : 'Offline')}</span></div>
      ${st ? statsBlock(st) : `<div class="note">${tr('No stats from the server 1 agent yet.')}</div>`}
      <div class="kv"><span>${tr('Network latency')}</span><b>${s1.online ? num(s1.latency, 1) + ' ms' : '—'}</b></div>
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
      toast(tr(pomo.mode === 'focus' ? 'Break over — back to focus' : 'Session done — take a break'));
      setPage(FOCUS);
      savePomo();
    }
  }
  const mm = String(Math.floor(pomo.left / 60)).padStart(2, '0'), ss = String(pomo.left % 60).padStart(2, '0');
  $('pomoTime').textContent = `${mm}:${ss}`;
  $('pomoTime').className = 'pomo-time ' + (pomo.running ? 'running' : 'paused');
  $('pomoMode').textContent = tr(pomo.mode === 'focus' ? 'Focus' : 'Break') + (pomo.running ? '' : tr(' · paused'));
  $('pomoFill').style.width = `${100 * (1 - pomo.left / modeLen())}%`;
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
  $('mDev').textContent = d ? `${d.name}${d.canVolume && d.volume != null ? ` · ${tr('volume {v}%', { v: d.volume })}` : ''}` : '';
  musicProgress();
}

function spotifyAction(act, body) {
  fetch(`/api/spotify/${act}`, { method: 'POST', body: JSON.stringify(body || {}) })
    .then((r) => { if (!r.ok) return r.text().then((t) => toast(r.status === 403 ? tr('Controls work on the Car Thing only') : `Spotify: ${t || r.status}`)); })
    .catch(() => toast(tr('Could not reach the hub')));
}

let volTimer = null, volDelta = 0;
function volumeAdjust(step) {
  const d = S && S.spotify && S.spotify.player && S.spotify.player.device;
  if (!d || !d.canVolume) return toast(tr('This device does not allow volume control'));
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
let setIdx = 0;     // 0 brightness, 1 restart, 2 shut down, 3 rotate, 4 language
const TILES = 5;
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
      ? tr(setIdx === 1 ? 'Press the knob again to restart · Back to cancel' : 'Press the knob again to shut down · Back to cancel')
      : tr('Turn the knob to choose · press the knob to select · Back to close');
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
  if (setMode === 'menu') { if (setIdx === 3) return rotate(); if (setIdx === 4) return switchLang(); return setModeTo(setIdx === 0 ? 'bright' : 'confirm'); }
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
    const x = e.target === track || e.target.parentElement === track ? e.offsetX : track.offsetWidth / 2;
    const pct = Math.round(Math.max(5, Math.min(100, (x / track.offsetWidth) * 100)) / 5) * 5;
    brightAdjust((pct - (brightPending ?? (S && S.display ? S.display.brightness : 80))) / 5);
    setIdx = 0;
    return setModeTo('bright');
  }
  if (tile) {
    const i = Number(tile.dataset.i);
    if (setMode === 'confirm' && i === setIdx) return deviceAction(i === 1 ? 'reboot' : 'poweroff');
    setIdx = i;
    if (i === 3) return rotate();
    if (i === 4) return switchLang();
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
  // the open story stays open behind Mei's page, so you can ask her about it
  if (page !== ASK && (newsSel >= 0 || newsDetail)) { closeDetail(); newsSel = -1; }
  const dir = page === prev ? 0 : (i > prev ? 1 : -1);
  pages.forEach((p, j) => p.classList.toggle('on', j === page));
  if (dir) transition(pages[prev], pages[page], dir);
  document.body.dataset.page = page;
  // the knob changes pages; the four preset buttons act on the page that is open
  $('tabs').innerHTML = pages.map((p, j) => `<span class="tab ${j === page ? 'on' : ''}">${tr(p.dataset.name)}</span>`).join('');
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
  if (page === ASK && S && ['answer', 'error'].includes(S.voice && S.voice.phase)) return void fetch('/api/voice/dismiss', { method: 'POST' }).catch(() => {});
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

// ---------------------------------------------------------------- night: the screen is off; the first touch only wakes it

let wakeSent = 0, wokeAt = 0;
function nightGate() {
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
addEventListener('click', (e) => { const n = S && S.display && S.display.night; if (n && n.dark) { e.stopPropagation(); e.preventDefault(); } }, true);

addEventListener('keydown', (e) => {
  if (nightGate()) return;
  const k = e.key;
  // upside down, the preset buttons sit along the bottom in reverse order: keep 1 on the left
  if (/^[1-4]$/.test(k)) return presetButton(orient === 'flip' ? 5 - Number(k) : Number(k));
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
  if (Math.abs(wheelAcc) >= 1) { const dir = wheelAcc > 0 ? 1 : -1; wheelAcc = 0; if (!nightGate()) knob(dir); }
}, { passive: true });

// touch: swipe left/right to change page; tap to talk to Mei or start/pause the focus timer.
// Touch points come in screen coordinates; turn them into the app's own (rotated) coordinates first.
function appX(t) {
  return { land: t.clientX, flip: 800 - t.clientX, cw: t.clientY, ccw: 480 - t.clientY }[orient];
}
let tx = null;
addEventListener('touchstart', (e) => { tx = appX(e.touches[0]); }, { passive: true });
addEventListener('touchend', (e) => {
  if (tx == null || setMode) { tx = null; return; }
  if (nightGate()) { tx = null; return; }
  const dx = appX(e.changedTouches[0]) - tx;
  tx = null;
  if (Math.abs(dx) > 60) setPage(page + (dx < 0 ? 1 : -1));
  else if (page === FOCUS) pomoToggle();
  else if (page === ASK) askToggle();
});

// ---------------------------------------------------------------- clock + data stream

function tickClock() {
  $('clock').textContent = new Intl.DateTimeFormat(loc(), { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(new Date(now()));
  pomoTick();
  musicProgress();
  if (S && page === ASK) renderAsk();
  if (S && page === CALENDAR && new Date().getSeconds() === 0) renderCalendar();
  checkLink();
}

const RENDER = { [NEWS]: renderNews, [MARKETS]: renderMarkets, [ASK]: renderAsk, [WEATHER]: renderWeather, [CALENDAR]: renderCalendar, [MUSIC]: renderMusic, [SERVERS]: renderServers };
function render() {
  if (!S) return;
  applyLang();
  try { RENDER[page] && RENDER[page](); } catch (e) { console.error(e); }
  if (zoom && page === MARKETS) try { renderZoom(); } catch (e) { console.error(e); }
  try { renderAlerts(); } catch (e) { console.error(e); }
  try { watchBriefing(); calReminders(); } catch (e) { console.error(e); }
  if (setMode) renderBrightness();
  document.body.classList.toggle('night-dark', !!(S.display && S.display.night && S.display.night.dark));
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
    render();
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
setPage(0);
tickClock();
setInterval(tickClock, 1000);
setInterval(render, 15000);
connect();

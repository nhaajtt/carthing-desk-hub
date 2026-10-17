// Calendar from secret iCal links (Google Calendar: Settings > your calendar > "Secret address in iCal format").
// Read-only, no OAuth. Recurring events are expanded for the next few days, including exceptions.

const DAY = 86400000;

// ------------------------------------------------------------------ time zones

// offset of a time zone from UTC at a given instant, in ms
function tzOffset(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

// wall-clock time in a zone -> UTC ms (checked twice so DST changes land on the right side)
export function wallToUtc(w, tz) {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h || 0, w.mi || 0, w.s || 0);
  let utc = guess - tzOffset(guess, tz);
  utc = guess - tzOffset(utc, tz);
  return utc;
}

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// ------------------------------------------------------------------ parsing

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

const unescape = (v) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

function parseLine(line) {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const [name, ...params] = line.slice(0, colon).split(';');
  return {
    name: name.toUpperCase(),
    params: Object.fromEntries(params.map((p) => { const [k, v = ''] = p.split('='); return [k.toUpperCase(), v.replace(/"/g, '')]; })),
    value: line.slice(colon + 1),
  };
}

// a DTSTART / DTEND / EXDATE / RECURRENCE-ID value -> { wall, tz, allDay, utc }
function parseTime(value, params, defaultTz) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const wall = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  const allDay = params.VALUE === 'DATE' || !m[4];
  const tz = m[7] ? 'UTC' : allDay ? defaultTz : validTz(params.TZID) ? params.TZID : defaultTz;
  return { wall, tz, allDay, utc: wallToUtc(wall, tz) };
}

export function parseIcs(text, defaultTz) {
  const events = [];
  let ev = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { ev = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (ev && ev.start) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'UID') ev.uid = p.value;
    else if (p.name === 'SUMMARY') ev.title = unescape(p.value);
    else if (p.name === 'LOCATION') ev.location = unescape(p.value);
    else if (p.name === 'STATUS') ev.status = p.value.toUpperCase();
    else if (p.name === 'RRULE') ev.rrule = Object.fromEntries(p.value.split(';').map((kv) => kv.split('=')));
    else if (p.name === 'DTSTART') ev.start = parseTime(p.value, p.params, defaultTz);
    else if (p.name === 'DTEND') ev.end = parseTime(p.value, p.params, defaultTz);
    else if (p.name === 'DURATION') ev.duration = p.value;
    else if (p.name === 'RECURRENCE-ID') ev.recurrenceId = parseTime(p.value, p.params, defaultTz);
    else if (p.name === 'EXDATE') for (const v of p.value.split(',')) { const t = parseTime(v, p.params, defaultTz); if (t) ev.exdates.push(t.utc); }
  }
  return events;
}

function durationMs(d) {
  const m = (d || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * DAY) + ((+m[3] || 0) * DAY) + ((+m[4] || 0) * 3600000) + ((+m[5] || 0) * 60000) + ((+m[6] || 0) * 1000);
  return m[1] === '-' ? -ms : ms;
}

// ------------------------------------------------------------------ recurrence

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const addDays = (w, n) => { const t = new Date(Date.UTC(w.y, w.mo - 1, w.d + n)); return { ...w, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const weekday = (w) => new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();
const daysIn = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

// the dates of one month that match a BYDAY / BYMONTHDAY rule
function monthDays(y, mo, rule, startWall) {
  const n = daysIn(y, mo);
  if (rule.BYMONTHDAY) return rule.BYMONTHDAY.split(',').map(Number).map((d) => (d < 0 ? n + d + 1 : d)).filter((d) => d >= 1 && d <= n).sort((a, b) => a - b);
  if (rule.BYDAY) {
    const out = [];
    for (const spec of rule.BYDAY.split(',')) {
      const m = spec.match(/^([+-]?\d+)?([A-Z]{2})$/);
      if (!m) continue;
      const wd = WEEKDAYS.indexOf(m[2]);
      const all = [];
      for (let d = 1; d <= n; d++) if (weekday({ y, mo, d }) === wd) all.push(d);
      if (!m[1]) out.push(...all);
      else { const k = +m[1]; const d = k > 0 ? all[k - 1] : all[all.length + k]; if (d) out.push(d); }
    }
    return [...new Set(out)].sort((a, b) => a - b);
  }
  return startWall.d <= n ? [startWall.d] : [];
}

// every start (UTC ms) of a recurring event up to `until`
function occurrences(ev, from, until) {
  const r = ev.rrule, s = ev.start;
  const freq = r.FREQ, interval = Math.max(1, +(r.INTERVAL || 1));
  const count = r.COUNT ? +r.COUNT : Infinity;
  const ruleEnd = r.UNTIL ? parseTime(r.UNTIL, {}, s.tz)?.utc ?? Infinity : Infinity;
  const out = [];
  let n = 0;
  const push = (wall) => {
    const utc = wallToUtc(wall, s.tz);
    if (utc < s.utc) return true;
    if (utc > ruleEnd || utc > until || n >= count) return false;
    n++;
    out.push(utc);
    return true;
  };
  const time = { h: s.wall.h, mi: s.wall.mi, s: s.wall.s };
  // without COUNT, old daily / weekly series can start counting near the window instead of years back
  const period = ({ DAILY: DAY, WEEKLY: 7 * DAY }[freq] || 0) * interval;
  const first = period && count === Infinity ? Math.max(0, Math.floor((from - s.utc) / period) - 1) : 0;
  for (let i = first; i < first + 4000; i++) {
    let dates = [];
    if (freq === 'DAILY') dates = [addDays(s.wall, i * interval)];
    else if (freq === 'WEEKLY') {
      // weeks start on Monday (WKST=MO, the iCal default)
      const monday = addDays(s.wall, -((weekday(s.wall) + 6) % 7) + i * 7 * interval);
      const days = (r.BYDAY ? r.BYDAY.split(',') : [WEEKDAYS[weekday(s.wall)]]).map((d) => (WEEKDAYS.indexOf(d.slice(-2)) + 6) % 7).sort((a, b) => a - b);
      dates = days.map((k) => addDays(monday, k));
    } else if (freq === 'MONTHLY') {
      const t = new Date(Date.UTC(s.wall.y, s.wall.mo - 1 + i * interval, 1));
      const y = t.getUTCFullYear(), mo = t.getUTCMonth() + 1;
      dates = monthDays(y, mo, r, s.wall).map((d) => ({ y, mo, d }));
    } else if (freq === 'YEARLY') {
      const y = s.wall.y + i * interval;
      const mo = r.BYMONTH ? +r.BYMONTH.split(',')[0] : s.wall.mo;
      dates = (r.BYDAY || r.BYMONTHDAY ? monthDays(y, mo, r, s.wall) : (s.wall.d <= daysIn(y, mo) ? [s.wall.d] : [])).map((d) => ({ y, mo, d }));
    } else {
      return [s.utc];
    }
    for (const d of dates) if (!push({ ...d, ...time })) return out;
    if (n >= count) return out;
  }
  return out;
}

// ------------------------------------------------------------------ the agenda

// events overlapping [from, to), recurring ones expanded, cancelled ones and EXDATEs removed
export function agenda(events, from, to) {
  const overrides = new Map();
  for (const ev of events) if (ev.recurrenceId) overrides.set(`${ev.uid}|${ev.recurrenceId.utc}`, ev);
  const out = [];
  const add = (ev, start, cal) => {
    if (ev.status === 'CANCELLED') return;
    const len = ev.end ? ev.end.utc - ev.start.utc : durationMs(ev.duration) ?? (ev.start.allDay ? DAY : 0);
    const end = start + Math.max(0, len);
    if (Math.max(end, start + 1) <= from || start >= to) return;
    out.push({
      id: `${ev.uid || ev.title}|${start}`.slice(0, 200),
      title: (ev.title || '(no title)').slice(0, 120),
      location: ev.location ? ev.location.slice(0, 80) : '',
      start, end, allDay: ev.start.allDay, cal,
    });
  };
  for (const ev of events) {
    if (ev.recurrenceId) {
      add(ev, ev.start.utc, ev.cal);
      continue;
    }
    if (!ev.rrule) { add(ev, ev.start.utc, ev.cal); continue; }
    const skip = new Set(ev.exdates);
    for (const t of occurrences(ev, from, to)) {
      if (skip.has(t) || overrides.has(`${ev.uid}|${t}`)) continue;
      add(ev, t, ev.cal);
    }
  }
  return out.sort((a, b) => a.start - b.start || b.allDay - a.allDay);
}

// ------------------------------------------------------------------ polling

export function createCalendar({ state, changed, tz, every }) {
  // one or more secret iCal links, separated by spaces or commas; they never leave the hub
  const urls = (process.env.CALENDAR_ICS || '').split(/[\s,]+/).filter((u) => /^https:\/\//.test(u));
  state.calendar = { configured: urls.length > 0, events: [], at: 0 };
  if (!urls.length) return;

  every(5 * 60000, 'calendar', async () => {
    const all = [];
    const results = await Promise.allSettled(urls.map(async (url, cal) => {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
      // never log the link itself: it is the only thing protecting the calendar
      if (!r.ok) throw new Error(`calendar ${cal + 1}: HTTP ${r.status}`);
      const text = await r.text();
      if (text.length > 8_000_000 || !text.includes('BEGIN:VCALENDAR')) throw new Error(`calendar ${cal + 1}: not an iCal file`);
      for (const ev of parseIcs(text, tz)) all.push({ ...ev, cal });
    }));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === urls.length) throw failed[0].reason;
    const start = Date.now() - DAY;
    state.calendar = { configured: true, events: agenda(all, start, start + 9 * DAY).slice(0, 120), at: Date.now() };
    changed();
  });
}

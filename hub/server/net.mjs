// Is the internet up? Every 30 s the hub opens a TCP connection to two public resolvers (Cloudflare, Google,
// port 443) and resolves a name. No ICMP: the hub's container has no raw sockets. Keeps the latest result,
// 24 hours of 10-minute averages (state/net.json), and raises a banner when the line goes down, comes back,
// or stays slow.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';

const EVERY = 30000;
const STEP = 10 * 60000;
const KEEP = 144;
const TARGETS = ['1.1.1.1', '8.8.8.8'];
const DOWN_AFTER = 3;   // failed samples in a row (1.5 min)
const SLOW_MS = Number(process.env.NET_SLOW_MS || 200);

function connectTime(host) {
  return new Promise((resolve) => {
    const t = performance.now();
    const s = net.connect({ host, port: 443, timeout: 4000 });
    const done = (ms) => { s.destroy(); resolve(ms); };
    s.once('connect', () => done(Math.round(performance.now() - t)));
    s.once('timeout', () => done(null));
    s.once('error', () => done(null));
  });
}

async function dnsTime() {
  const t = performance.now();
  try {
    await Promise.race([dns.promises.lookup('www.google.com'), new Promise((_, no) => setTimeout(no, 4000))]);
    return Math.round(performance.now() - t);
  } catch { return null; }
}

export function createNet({ state, changed, stateDir, notify, lang }) {
  const file = path.join(stateDir, 'net.json');
  const h = { step: STEP, end: Math.floor(Date.now() / STEP) * STEP, ms: [], loss: [] };
  try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); if (s.step === STEP) Object.assign(h, s); } catch {}
  let acc = { ms: 0, n: 0, fail: 0, total: 0 };
  let fails = 0, downSince = 0, slowAt = 0;
  const recent = []; // last 10 latencies, for "slow"
  const vi = () => lang() === 'vi';
  const clock = (ms) => new Date(ms).toLocaleTimeString(vi() ? 'vi-VN' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: process.env.WX_TZ || 'America/Los_Angeles' });

  function roll() {
    const bucket = Math.floor(Date.now() / STEP) * STEP;
    if (bucket <= h.end) return;
    const gaps = Math.min(KEEP, Math.round((bucket - h.end) / STEP));
    h.ms.push(acc.n ? Math.round(acc.ms / acc.n) : null);
    h.loss.push(acc.total ? Math.round((acc.fail / acc.total) * 100) : null);
    for (let i = 1; i < gaps; i++) { h.ms.push(null); h.loss.push(null); }
    for (const k of ['ms', 'loss']) if (h[k].length > KEEP) h[k].splice(0, h[k].length - KEEP);
    h.end = bucket;
    acc = { ms: 0, n: 0, fail: 0, total: 0 };
    try { fs.writeFileSync(file, JSON.stringify(h)); } catch (e) { console.error('[net]', e.message); }
  }

  async function sample() {
    const [a, b, d] = await Promise.all([...TARGETS.map(connectTime), dnsTime()]);
    const best = [a, b].filter((x) => x != null).sort((x, y) => x - y)[0] ?? null;
    const ok = best != null;
    roll();
    acc.total++;
    if (ok) { acc.ms += best; acc.n++; } else acc.fail++;
    const t = Date.now();
    if (ok) {
      if (downSince) {
        const mins = Math.max(1, Math.round((t - downSince) / 60000));
        notify('net', vi() ? `Internet đã có lại sau ${mins} phút` : `Internet is back after ${mins} min`);
        downSince = 0;
      }
      fails = 0;
      recent.push(best);
      if (recent.length > 10) recent.shift();
      const avg = recent.reduce((s, x) => s + x, 0) / recent.length;
      if (recent.length === 10 && avg > SLOW_MS && t - slowAt > 3600000) {
        slowAt = t;
        notify('net', vi() ? `Internet chậm: trung bình ${Math.round(avg)} ms trong 5 phút qua` : `Internet is slow: ${Math.round(avg)} ms on average over 5 minutes`);
      }
    } else if (++fails === DOWN_AFTER) {
      downSince = t - (DOWN_AFTER - 1) * EVERY;
      notify('net', vi() ? `Mất Internet từ ${clock(downSince)}` : `Internet down since ${clock(downSince)}`);
    }
    state.net = { at: t, ok, ms: best, dns: d, down: !!downSince, downSince, hist: { end: h.end, ms: h.ms, loss: h.loss } };
    changed();
  }

  setInterval(sample, EVERY);
  setTimeout(sample, 3000);
}

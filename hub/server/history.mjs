// 24 hours of CPU, memory and temperature per server, as 10-minute averages.
// Saved to state/history.json so a hub restart keeps the graphs.
import fs from 'node:fs';
import path from 'node:path';

const STEP = 10 * 60000;
const KEEP = 144; // 24 h
const METRICS = ['cpu', 'mem', 'temp'];

export function createHistory({ state, stateDir }) {
  const file = path.join(stateDir, 'history.json');
  const blank = () => Object.fromEntries(METRICS.map((m) => [m, []]));
  const h = { step: STEP, end: Math.floor(Date.now() / STEP) * STEP, server2: blank(), server1: blank() };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.step === STEP) Object.assign(h, saved);
  } catch {}
  state.history = h;
  const acc = {}; // "server2.cpu" -> [sum, count] for the bucket in progress

  // move the series forward to the current bucket, closing the one in progress and padding gaps with null
  function roll() {
    const bucket = Math.floor(Date.now() / STEP) * STEP;
    if (bucket <= h.end) return;
    const gaps = Math.min(KEEP, Math.round((bucket - h.end) / STEP));
    for (const s of ['server2', 'server1']) {
      for (const m of METRICS) {
        const a = acc[`${s}.${m}`];
        const series = h[s][m];
        series.push(a && a[1] ? Math.round((a[0] / a[1]) * 10) / 10 : null);
        for (let i = 1; i < gaps; i++) series.push(null);
        if (series.length > KEEP) series.splice(0, series.length - KEEP);
      }
    }
    for (const k of Object.keys(acc)) delete acc[k];
    h.end = bucket;
    try { fs.writeFileSync(file, JSON.stringify(h)); } catch (e) { console.error('[history]', e.message); }
  }

  function add(s, m, v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    const a = acc[`${s}.${m}`] || (acc[`${s}.${m}`] = [0, 0]);
    a[0] += v; a[1]++;
  }

  function sample() {
    roll();
    const s2 = state.servers.server2;
    if (s2 && Date.now() - s2.at < 30000) {
      add('server2', 'cpu', s2.cpu);
      add('server2', 'mem', (100 * s2.memUsed) / s2.memTotal);
      add('server2', 'temp', s2.temp);
    }
    const st = state.servers.server1 && state.servers.server1.stats;
    if (st && Date.now() - st.at < 60000) {
      add('server1', 'cpu', st.cpu);
      add('server1', 'mem', (100 * st.memUsed) / st.memTotal);
      add('server1', 'temp', st.temp);
    }
  }
  setInterval(sample, 60000);
  setTimeout(sample, 10000);
}

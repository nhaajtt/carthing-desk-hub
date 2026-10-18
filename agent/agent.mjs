// Pushes basic host stats to the desk hub. Opens no ports; only makes outbound requests.
import fs from 'node:fs';
import os from 'node:os';

const HUB = process.env.HUB_URL || 'http://10.10.10.20:8787/api/ingest';
const TOKEN = process.env.INGEST_TOKEN;
if (!TOKEN) { console.error('INGEST_TOKEN missing'); process.exit(1); }

let prev = null;
function cpu() {
  const v = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const idle = v[3] + (v[4] || 0), total = v.reduce((a, b) => a + b, 0);
  const pct = prev ? 100 * (1 - (idle - prev.idle) / (total - prev.total || 1)) : null;
  prev = { idle, total };
  return pct;
}

function temp() {
  let max = null;
  try {
    for (const z of fs.readdirSync('/sys/class/thermal')) {
      if (!z.startsWith('thermal_zone')) continue;
      const t = Number(fs.readFileSync(`/sys/class/thermal/${z}/temp`, 'utf8')) / 1000;
      if (t > 0 && (max == null || t > max)) max = t;
    }
  } catch {}
  return max;
}

// container list comes from the read-only docker-status sidecar; this agent never touches docker.sock
const DOCKER_STATUS = process.env.DOCKER_STATUS_URL || 'http://docker-status:8080/';
let containerCache = { at: 0, list: null };
async function containers() {
  if (Date.now() - containerCache.at < 15000) return containerCache.list;
  try {
    const r = await fetch(DOCKER_STATUS, { signal: AbortSignal.timeout(3000) });
    containerCache = { at: Date.now(), list: r.ok ? await r.json() : null };
  } catch { containerCache = { at: Date.now(), list: null }; }
  return containerCache.list;
}

// security / update report written by host/host-report.sh from cron (read-only mount); sent once a minute
const REPORT = process.env.REPORT_FILE || '/app/report/report.json';
let reportSent = 0;
function report() {
  if (Date.now() - reportSent < 60000) return undefined;
  try {
    const r = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
    reportSent = Date.now();
    return r;
  } catch { return undefined; }
}

async function push() {
  const mem = Object.fromEntries(fs.readFileSync('/proc/meminfo', 'utf8').split('\n').filter(Boolean)
    .map((l) => { const [k, v] = l.split(':'); return [k, Number(v.trim().split(' ')[0]) * 1024]; }));
  const st = fs.statfsSync('/');
  const body = {
    cpu: cpu(), cores: os.cpus().length,
    load: fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number),
    memUsed: mem.MemTotal - mem.MemAvailable, memTotal: mem.MemTotal,
    diskUsed: (st.blocks - st.bfree) * st.bsize, diskTotal: st.blocks * st.bsize,
    temp: temp(),
    uptime: Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]),
    containers: await containers(),
    report: report(),
  };
  try {
    const r = await fetch(HUB, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) console.error('hub answered', r.status);
  } catch (e) {
    console.error('push failed:', e.message);
  }
}

cpu();
setInterval(push, 5000);

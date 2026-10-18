// Security and update status per server, from the host reports (host/host-report.sh, run from cron):
// failed SSH logins, packets the firewall blocked, ports open on every interface, pending apt updates.
// Server 2's report is a read-only file mounted into the hub; server 1's arrives with the agent's stats.
// Also reads the Car Thing check written by check-carthing.sh, and raises a banner when something new appears.
import fs from 'node:fs';
import path from 'node:path';

const SSH_ALERT = Number(process.env.SSH_ALERT || 5); // failed logins per hour that raise a banner
const DAY = 86400000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v, n = 60) => String(v ?? '').slice(0, n);

// the report comes from another machine for server 1: keep only the expected shape
export function cleanReport(r) {
  if (!r || typeof r !== 'object') return null;
  const top = (a, f) => (Array.isArray(a) ? a.slice(0, 3).map(f) : []);
  return {
    at: num(r.at),
    ssh: { fail1h: num(r.ssh?.fail1h), fail24h: num(r.ssh?.fail24h), top: top(r.ssh?.top, (x) => ({ ip: str(x?.ip, 45), n: num(x?.n) })) },
    ufw: { block1h: num(r.ufw?.block1h), block24h: num(r.ufw?.block24h), top: top(r.ufw?.top, (x) => ({ what: str(x?.what), via: str(x?.via, 20), n: num(x?.n) })) },
    listen: Array.isArray(r.listen) ? r.listen.slice(0, 40).map((x) => str(x, 12)) : [],
    apt: { upgradable: num(r.apt?.upgradable), security: num(r.apt?.security), reboot: r.apt?.reboot === true },
  };
}

export function createSecurity({ state, changed, stateDir, hostDir, notify }) {
  const seenFile = path.join(stateDir, 'security-seen.json');
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch {}
  const reports = { server2: null, server1: null };
  const lastSshAlert = {};
  let lastCarthing = '';
  state.security = { server2: null, server1: null, carthing: null };
  state.updates = state.updates || {};

  const NAMES = { server2: 'Server 2', server1: 'Server 1' };

  // entries open on every interface: the host's own sockets, plus Docker ports published on 0.0.0.0
  function openItems(s) {
    const r = reports[s];
    const list = s === 'server2' ? state.servers.server2?.containers?.list : state.servers.server1?.stats?.containers?.list;
    const docker = (list || []).flatMap((c) => (c.open || []).map((p) => `${c.name} ${p}`));
    return { host: r ? r.listen : [], docker };
  }

  function mark(s, items) {
    const known = seen[s];
    const now = Date.now();
    if (!known) { // first report from this server: everything already open counts as known
      seen[s] = Object.fromEntries(items.map((k) => [k, 0]));
      save();
      return;
    }
    const fresh = items.filter((k) => !(k in known));
    if (!fresh.length) return;
    fresh.forEach((k) => { known[k] = now; });
    save();
    notify('sec', `${NAMES[s]}: newly open on every interface · ${fresh.slice(0, 3).join(', ')}`);
  }
  function save() { try { fs.writeFileSync(seenFile, JSON.stringify(seen)); } catch (e) { console.error('[security]', e.message); } }

  function update() {
    for (const s of ['server2', 'server1']) {
      const r = reports[s];
      if (!r) continue;
      const { host, docker } = openItems(s);
      mark(s, [...host, ...docker]);
      const isNew = (k) => (seen[s]?.[k] || 0) > Date.now() - DAY;
      state.security[s] = {
        at: r.at, ssh: r.ssh, ufw: r.ufw,
        listen: host.map((p) => ({ p, fresh: isNew(p) })),
        docker: docker.map((p) => ({ p, fresh: isNew(p) })),
      };
      state.updates[s] = { ...r.apt, at: r.at };
      if (r.ssh.fail1h >= SSH_ALERT && Date.now() - (lastSshAlert[s] || 0) > 2 * 3600000) {
        lastSshAlert[s] = Date.now();
        notify('sec', `${NAMES[s]}: ${r.ssh.fail1h} failed SSH logins in the last hour${r.ssh.top[0] ? `, most from ${r.ssh.top[0].ip}` : ''}`);
      }
    }
    readCarthing();
    changed();
  }

  function readCarthing() {
    let c = null;
    try { c = JSON.parse(fs.readFileSync(path.join(hostDir, 'carthing.json'), 'utf8')); } catch { return; }
    const problems = Array.isArray(c.problems) ? c.problems.slice(0, 12).map((p) => str(p, 80)) : [];
    state.security.carthing = { at: num(c.at), reachable: c.reachable !== false, version: str(c.version, 40), problems };
    const sig = `${c.reachable !== false}|${problems.join('|')}`;
    if (lastCarthing && sig !== lastCarthing && (problems.length || c.reachable === false)) {
      notify('sec', c.reachable === false ? 'Car Thing check: no SSH access with the hub key' : `Car Thing setup changed: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1})` : ''}`);
    }
    lastCarthing = sig;
  }

  function readLocal() {
    try { reports.server2 = cleanReport(JSON.parse(fs.readFileSync(path.join(hostDir, 'report.json'), 'utf8'))); }
    catch (e) { if (e.code !== 'ENOENT') console.error('[security] report:', e.message); }
    update();
  }
  setInterval(readLocal, 60000);
  setTimeout(readLocal, 5000);

  return {
    // called with each push from the server 1 agent (only when it carries a report)
    server1(report) {
      const r = cleanReport(report);
      if (!r || (reports.server1 && reports.server1.at === r.at)) return;
      reports.server1 = r;
      update();
    },
  };
}

// Reminders Mei sets when asked by voice ("nhắc mình 10 phút nữa gọi mẹ"). Kept in state/reminders.json so a
// restart of the hub does not lose them. When one is due: a banner on every page, and the screen lights up
// (also at night, or while the phone is away from the desk).
import fs from 'node:fs';
import path from 'node:path';

const MAX = 20;
const MAX_MINUTES = 7 * 24 * 60;

export function createReminders({ state, changed, stateDir, notify, wake }) {
  const FILE = path.join(stateDir, 'reminders.json');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(FILE, 'utf8')).filter((r) => r && r.at && r.text); } catch {}
  let seq = list.reduce((m, r) => Math.max(m, r.id || 0), 0);

  function save() {
    try { fs.writeFileSync(FILE, JSON.stringify(list)); } catch (e) { console.error('[reminders]', e.message); }
    state.reminders = list.map(({ at, text }) => ({ at, text }));
    changed();
  }

  function add(minutes, text) {
    const m = Math.round(Number(minutes));
    text = String(text || '').trim().slice(0, 120);
    if (!(m >= 1 && m <= MAX_MINUTES) || !text || list.length >= MAX) return false;
    list.push({ id: ++seq, at: Date.now() + m * 60000, text });
    list.sort((a, b) => a.at - b.at);
    save();
    console.log(`[reminders] set for ${m} min from now`);
    return true;
  }

  setInterval(() => {
    const due = list.filter((r) => r.at <= Date.now());
    if (!due.length) return;
    list = list.filter((r) => r.at > Date.now());
    for (const r of due) notify('remind', r.text);
    wake();
    save();
  }, 15000);

  state.reminders = list.map(({ at, text }) => ({ at, text }));
  return { add };
}

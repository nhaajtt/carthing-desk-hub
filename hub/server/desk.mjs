// Time at the desk, from the paired iPhone's presence: the Car Thing reports when the phone comes near or
// leaves, plus a heartbeat. Kept as minutes per day for five weeks (state/desk.json). After an hour without a
// break of at least 3 minutes, a banner says to stand up.
import fs from 'node:fs';
import path from 'node:path';

const SIT = Number(process.env.DESK_SIT_MINUTES || 60);
const BREAK = 3 * 60000;
const FRESH = 6 * 60000; // without a report for this long, the Car Thing (or the phone link) is gone

export function createDesk({ state, changed, stateDir, tz, notify, lang }) {
  const FILE = path.join(stateDir, 'desk.json');
  let days = {};
  try { days = JSON.parse(fs.readFileSync(FILE, 'utf8')).days || {}; } catch {}
  let near = false, seenAt = 0, awaySince = 0, streak = 0, nudged = 0, dirty = false;
  const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });

  function publish() {
    const t = Date.now();
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const ms = t - i * 86400000;
      week.push({ day: new Date(ms).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' }), minutes: days[dayKey(ms)] || 0 });
    }
    state.desk = { today: days[dayKey(t)] || 0, week, streak, near: near && t - seenAt < FRESH };
    changed();
  }

  // POST /api/desk {near}
  function report(isNear) {
    const t = Date.now();
    seenAt = t;
    if (isNear && !near) {
      if (awaySince && t - awaySince >= BREAK) { streak = 0; nudged = 0; }
      awaySince = 0;
    }
    if (!isNear && near) awaySince = t;
    near = isNear;
    publish();
  }

  setInterval(() => {
    const t = Date.now();
    if (near && t - seenAt < FRESH) {
      const k = dayKey(t);
      days[k] = (days[k] || 0) + 1;
      streak++;
      dirty = true;
      if (streak >= SIT && streak - nudged >= SIT) {
        nudged = streak;
        notify('desk', lang() === 'vi' ? `Bạn đã ngồi ${streak} phút liền, đứng dậy vận động một chút nhé` : `${streak} minutes at the desk without a break: time to stand up and stretch`);
      }
    } else if (!awaySince || t - awaySince >= BREAK) {
      streak = 0;
      nudged = 0;
    }
    publish();
  }, 60000);

  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    const keep = Object.keys(days).sort().slice(-35);
    days = Object.fromEntries(keep.map((k) => [k, days[k]]));
    try { fs.writeFileSync(FILE, JSON.stringify({ days })); } catch (e) { console.error('[desk]', e.message); }
  }, 5 * 60000);

  publish();
  return { report };
}

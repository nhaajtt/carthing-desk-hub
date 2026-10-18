// Vocabulary cards: a few new English words a day (Gemini Flash-Lite, one request), each with its IPA, a
// Vietnamese meaning and an example, reviewed on a Leitner schedule: remembered cards come back after 1, 3, 7
// and 16 days, forgotten ones the same day. Kept in state/words.json; only the word list goes to Gemini.
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_SUMMARY_MODEL || 'gemini-flash-lite-latest';
const LEVEL = process.env.WORDS_LEVEL || 'B2';
const PER_DAY = Number(process.env.WORDS_PER_DAY || 5);
const DAYS = [0, 1, 3, 7, 16]; // wait after a correct answer, by box (1..5); past box 5 a word is learned
const SESSION = 15;

export function createWords({ state, changed, stateDir, tz }) {
  const file = path.join(stateDir, 'words.json');
  let db = { cards: [], fetchedDay: '' };
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  let seq = db.cards.reduce((m, c) => Math.max(m, c.id), 0);
  const day = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
  // reviews are due from the start of their day, not to the minute
  const dayStart = (d) => Date.parse(`${d}T00:00:00Z`);

  function save() { try { fs.writeFileSync(file, JSON.stringify(db)); } catch (e) { console.error('[words]', e.message); } }

  function publish() {
    const today = dayStart(day());
    const due = db.cards.filter((c) => c.box <= 5 && dayStart(c.due) <= today).sort((a, b) => (a.seen || 0) - (b.seen || 0) || a.id - b.id); // just forgotten: to the back
    state.words = {
      configured: !!KEY,
      due: due.slice(0, SESSION).map(({ id, word, ipa, pos, vi, ex, exVi, box }) => ({ id, word, ipa, pos, vi, ex, exVi, box })),
      left: due.length,
      learned: db.cards.filter((c) => c.box > 5).length,
      total: db.cards.length,
    };
    changed();
  }

  async function fetchNew(n = PER_DAY) {
    if (!KEY) return;
    const known = db.cards.map((c) => c.word).slice(-400);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Pick ${n} useful English words for a ${LEVEL} learner whose native language is Vietnamese, everyday or work words rather than rare ones, none of these: ${JSON.stringify(known)}. `
          + 'Answer with a JSON array of objects {"word", "ipa" (US, with slashes), "pos" (noun, verb, adjective…), "vi" (short Vietnamese meaning), "ex" (a short natural English example), "exVi" (its Vietnamese translation)}.' }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2000 },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    const j = await r.json();
    let list = [];
    try { list = JSON.parse((j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')); } catch {}
    const have = new Set(db.cards.map((c) => c.word.toLowerCase()));
    const s = (v, n) => String(v || '').trim().slice(0, n);
    for (const w of Array.isArray(list) ? list.slice(0, n) : []) {
      if (!w || !w.word || have.has(String(w.word).toLowerCase())) continue;
      db.cards.push({ id: ++seq, word: s(w.word, 40), ipa: s(w.ipa, 40), pos: s(w.pos, 20), vi: s(w.vi, 80), ex: s(w.ex, 160), exVi: s(w.exVi, 160), box: 1, due: day() });
    }
    save();
    publish();
  }

  // a new batch once a day, the first time the hub looks after midnight
  async function daily() {
    if (db.fetchedDay === day()) return;
    db.fetchedDay = day();
    save();
    try { await fetchNew(); } catch (e) { console.error('[words]', e.message); }
  }

  // POST /api/words/grade {id, known}
  function grade(id, known) {
    const c = db.cards.find((x) => x.id === Number(id));
    if (!c) return false;
    c.box = known ? c.box + 1 : 1;
    const wait = known ? DAYS[Math.min(c.box, 5) - 1] || 0 : 0;
    c.due = day(Date.now() + wait * 86400000);
    if (!known) c.seen = Date.now(); // forgotten: again later today
    save();
    publish();
    return true;
  }

  setInterval(daily, 30 * 60000);
  setTimeout(daily, 10000);
  publish();
  return { grade, more: () => fetchNew().catch((e) => console.error('[words]', e.message)) };
}

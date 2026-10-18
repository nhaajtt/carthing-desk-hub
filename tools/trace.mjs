// Counts the frames the screen actually showed vs dropped while turning the knob through every page,
// from Chromium's own frame reporter (compositor side, so it sees what the panel shows).
// usage: node trace.mjs [turn gap ms, default 400]
//        node trace.mjs per      one trace per page change: dropped frames and where the main thread spent its time
//        node trace.mjs per N    only the change to page N, with every main-thread task over 8 ms
const MODE = process.argv[2] === 'per' ? 'per' : 'all';
const GAP = Number((MODE === 'all' && process.argv[2]) || 400);
const list = await (await fetch('http://127.0.0.1:19223/json/list')).json();
const pg = list.find((p) => p.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl.replace(/\/\/[^/]+/, '//127.0.0.1:19223'));
let id = 0; const wait = {}; let events = []; let done;
const call = (method, params = {}) => new Promise((r) => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (wait[d.id]) wait[d.id](d.result);
  if (d.method === 'Tracing.dataCollected') events.push(...d.params.value);
  if (d.method === 'Tracing.tracingComplete') done();
};
await new Promise((r) => (ws.onopen = r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (k) => call('Runtime.evaluate', { expression: `dispatchEvent(new KeyboardEvent('keydown', {key: '${k}'})), dispatchEvent(new KeyboardEvent('keyup', {key: '${k}'})), 1` });
const evalv = async (e) => (await call('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;

async function traced(fn, cats) {
  events = [];
  await call('Tracing.start', { categories: cats, transferMode: 'ReportEvents' });
  await sleep(200);
  await fn();
  const finished = new Promise((r) => (done = r));
  await call('Tracing.end');
  await finished;
  return events;
}

// only frames where something was moving (the slides, flashes): idle frames say nothing about smoothness
function frames(evs) {
  const states = {};
  for (const e of evs) {
    const r = e.name === 'PipelineReporter' && e.ph === 'b' && e.args && e.args.frame_reporter;
    if (!r || !(r.has_compositor_animation || r.has_main_animation || r.affects_smoothness)) continue;
    states[r.state] = (states[r.state] || 0) + 1;
  }
  const shown = (states.STATE_PRESENTED_ALL || 0) + (states.STATE_PRESENTED_PARTIAL || 0);
  return { shown, dropped: states.STATE_DROPPED || 0, states };
}

await call('Runtime.evaluate', { expression: 'setPage(0), 1' });
await sleep(1500);

if (MODE === 'all') {
  const evs = await traced(async () => {
    for (const k of ['ArrowRight', 'ArrowLeft']) for (let i = 0; i < 7; i++) { await key(k); await sleep(GAP); }
    await sleep(600);
  }, 'cc,benchmark,viz,disabled-by-default-devtools.timeline.frame');
  const { shown, dropped, states } = frames(evs);
  console.log(JSON.stringify({ gapMs: GAP, frames: shown + dropped, shown, dropped, droppedPct: +((100 * dropped) / Math.max(1, shown + dropped)).toFixed(1), states }));
} else {
  const n = await evalv('pages.length');
  const WORK = ['UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'FunctionCall', 'EvaluateScript', 'ParseHTML', 'HitTest', 'Commit'];
  const only = Number(process.argv[3]);
  for (let i = only || 1; i < (only ? only + 1 : n); i++) {
    await call('Runtime.evaluate', { expression: `setPage(${i - 1}), 1` });
    await sleep(900);
    const evs = await traced(async () => { await key('ArrowRight'); await sleep(700); },
      'cc,benchmark,viz,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame');
    const { shown, dropped } = frames(evs);
    const work = {};
    for (const e of evs) if (WORK.includes(e.name) && e.ph === 'X' && e.dur) work[e.name] = (work[e.name] || 0) + e.dur / 1000;
    const top = Object.entries(work).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
    const name = await evalv(`pages[${i}].dataset.name`);
    console.log(`${name.padEnd(9)} dropped ${String(dropped).padStart(2)}/${shown + dropped}  ms: ${top}`);
    if (only) {
      const t0 = Math.min(...evs.filter((e) => e.name === 'RunTask').map((e) => e.ts));
      for (const t of evs.filter((e) => e.name === 'RunTask' && e.dur > 8000).sort((a, b) => a.ts - b.ts)) {
        const inner = {};
        for (const e of evs) if (e.tid === t.tid && e.ts >= t.ts && e.ts < t.ts + t.dur && WORK.includes(e.name) && e.dur) inner[e.name] = (inner[e.name] || 0) + e.dur / 1000;
        const fn = evs.find((e) => e.tid === t.tid && e.ts >= t.ts && e.ts < t.ts + t.dur && e.name === 'FunctionCall');
        console.log(`  +${((t.ts - t0) / 1000).toFixed(0)} ms  task ${(t.dur / 1000).toFixed(0)} ms  ${Object.entries(inner).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}${fn && fn.args && fn.args.data ? `  (${fn.args.data.functionName || ''}:${fn.args.data.lineNumber || ''})` : ''}`);
      }
    }
  }
}
process.exit(0);

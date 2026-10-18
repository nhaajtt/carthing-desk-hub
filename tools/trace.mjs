// Counts the frames the screen actually showed vs dropped while turning the knob through every page,
// from Chromium's own frame reporter (compositor side, so it sees what the panel shows).
// usage: node trace.mjs [turn gap ms, default 400]
const GAP = Number(process.argv[2] || 400);
const list = await (await fetch('http://127.0.0.1:19223/json/list')).json();
const pg = list.find((p) => p.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl.replace(/\/\/[^/]+/, '//127.0.0.1:19223'));
let id = 0; const wait = {}; const events = []; let done;
const call = (method, params = {}) => new Promise((r) => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (wait[d.id]) wait[d.id](d.result);
  if (d.method === 'Tracing.dataCollected') events.push(...d.params.value);
  if (d.method === 'Tracing.tracingComplete') done();
};
await new Promise((r) => (ws.onopen = r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (k) => call('Runtime.evaluate', { expression: `dispatchEvent(new KeyboardEvent('keydown', {key: '${k}'})), 1` });

await call('Runtime.evaluate', { expression: 'setPage(0), 1' });
await sleep(1500);
await call('Tracing.start', { categories: 'cc,benchmark,viz,disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' });
await sleep(300);
for (const k of ['ArrowRight', 'ArrowLeft']) for (let i = 0; i < 7; i++) { await key(k); await sleep(GAP); }
await sleep(600);
const finished = new Promise((r) => (done = r));
await call('Tracing.end');
await finished;

// only frames where something was moving (the slides, flashes): idle frames say nothing about smoothness
const states = {};
for (const e of events) {
  const r = e.name === 'PipelineReporter' && e.ph === 'b' && e.args && e.args.frame_reporter;
  if (!r || !(r.has_compositor_animation || r.has_main_animation || r.affects_smoothness)) continue;
  states[r.state] = (states[r.state] || 0) + 1;
}
const shown = (states.STATE_PRESENTED_ALL || 0) + (states.STATE_PRESENTED_PARTIAL || 0);
const dropped = states.STATE_DROPPED || 0;
console.log(JSON.stringify({ gapMs: GAP, frames: shown + dropped, shown, dropped, droppedPct: +((100 * dropped) / Math.max(1, shown + dropped)).toFixed(1), states }));
process.exit(0);

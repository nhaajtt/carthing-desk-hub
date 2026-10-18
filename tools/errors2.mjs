// Sets an orientation, reloads, presses keys, and prints every exception on the way.
const [orient, keys] = [process.argv[2] || 'cw', (process.argv[3] || '3').split(',')];
const list = await (await fetch('http://127.0.0.1:19223/json/list')).json();
const pg = list.find((p) => p.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl.replace(/\/\/[^/]+/, '//127.0.0.1:19223'));
let id = 0; const wait = {};
const call = (method, params = {}) => new Promise((r) => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (wait[d.id]) wait[d.id](d.result);
  if (d.method === 'Runtime.exceptionThrown') { const e = d.params.exceptionDetails; console.log('EXCEPTION', (e.exception?.description || e.text).split('\n').slice(0, 3).join(' | ')); }
};
await new Promise((r) => (ws.onopen = r));
await call('Runtime.enable');
const ev = (expression) => call('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r.result?.value);
await ev(`localStorage.setItem('orient', '${orient}'), 1`);
await call('Page.reload'); await new Promise((r) => setTimeout(r, 8000));
for (const k of keys) { await ev(`dispatchEvent(new KeyboardEvent('keydown', {key: '${k}'})), dispatchEvent(new KeyboardEvent('keyup', {key: '${k}'})), 1`); await new Promise((r) => setTimeout(r, 1500)); }
console.log('page now', await ev('page'), 'orient', await ev('document.body.dataset.orient'));
process.exit(0);

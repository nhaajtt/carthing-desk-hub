// Reloads the kiosk page and prints any uncaught exceptions / console errors during the first seconds.
const list = await (await fetch('http://127.0.0.1:19223/json/list')).json();
const pg = list.find((p) => p.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl.replace(/\/\/[^/]+/, '//127.0.0.1:19223'));
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === 'Runtime.exceptionThrown') { const e = d.params.exceptionDetails; console.log('EXCEPTION', e.exception?.description?.split('\n').slice(0, 3).join(' | '), 'at', e.url, e.lineNumber + 1); }
  if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) console.log('CONSOLE', d.params.type, d.params.args.map((a) => a.value ?? a.description).join(' '));
  if (d.method === 'Log.entryAdded') console.log('LOG', d.params.entry.level, d.params.entry.text, d.params.entry.url || '');
};
await new Promise((r) => (ws.onopen = r));
send('Runtime.enable'); send('Log.enable'); send('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, 9000));
send('Runtime.evaluate', { expression: "JSON.stringify({clock: document.getElementById('clock').textContent, conn: document.getElementById('conn').className, page})", returnByValue: true });
await new Promise((r) => setTimeout(r, 800));
process.exit(0);

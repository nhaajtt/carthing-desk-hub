// Runs a list of steps against the kiosk over DevTools (tunnelled to 127.0.0.1:19223) and prints every
// exception on the way. Steps (JSON): ["key","1"] ["eval","js"] ["evalfile","x.js"] ["wait",ms] ["shot","name"] ["reload"]
// usage: node steps.mjs /t/out '[["key","ArrowRight"],["wait",1500],["shot","cal"]]'   (or the path of a .json file)
import fs from 'node:fs';
const [OUT, json] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const list = await (await fetch('http://127.0.0.1:19223/json/list')).json();
const pg = list.find((p) => p.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl.replace(/\/\/[^/]+/, '//127.0.0.1:19223'));
let id = 0; const wait = {};
const call = (method, params = {}) => new Promise((r) => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (wait[d.id]) wait[d.id](d.result);
  if (d.method === 'Runtime.exceptionThrown') { const e = d.params.exceptionDetails; console.log('EXCEPTION', (e.exception?.description || e.text).split('\n').slice(0, 3).join(' | ')); }
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') console.log('CONSOLE', d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
};
await new Promise((r) => (ws.onopen = r));
await call('Runtime.enable');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let [op, arg] of JSON.parse(json.trim().startsWith('[') ? json : fs.readFileSync(json, 'utf8'))) {
  if (op === 'evalfile') { op = 'eval'; arg = fs.readFileSync(arg, 'utf8'); }
  if (op === 'key') await call('Runtime.evaluate', { expression: `dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(arg)}})), dispatchEvent(new KeyboardEvent('keyup', {key: ${JSON.stringify(arg)}})), 1` });
  if (op === 'eval') { const r = await call('Runtime.evaluate', { expression: arg, returnByValue: true, awaitPromise: true }); console.log('=>', JSON.stringify(r.result?.value ?? r.exceptionDetails?.text ?? null)); }
  if (op === 'wait') await sleep(arg);
  if (op === 'reload') { await call('Page.reload'); await sleep(arg || 8000); }
  if (op === 'shot') { const r = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${arg}.png`, Buffer.from(r.data, 'base64')); console.log('saved', arg); }
}
process.exit(0);

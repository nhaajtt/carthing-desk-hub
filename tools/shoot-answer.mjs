// Re-shows a real earlier answer from Mei in the speech bubble and captures it.
// Live updates would overwrite the answer within a second, so they are pinned to it until the page reloads.
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch('http://127.0.0.1:19223/json/list')).json();
const pg = list.find((p) => p.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl.replace(/\/\/[^/]+/, '//127.0.0.1:19223'));
let id = 0; const wait = {};
const call = (method, params = {}) => new Promise((r) => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait[d.id]) wait[d.id](d.result); };
await new Promise((r) => (ws.onopen = r));
const ev = (expression) => call('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r.result?.value);
for (let i = 0; i < 20 && !(await ev("typeof S !== 'undefined' && !!S")); i++) await sleep(500);
await ev(`(() => {
  const answer = { phase: 'answer', configured: true, transcript: 'Tìm cho tôi một GitHub repo hay hôm nay.', searches: [], sources: [],
    answer: 'Meow! Bạn thử xem qua repo ollama/ollama nha. Dự án này cực hay, giúp bạn dễ dàng tải và chạy các mô hình AI ngôn ngữ lớn ngay trên máy tính cá nhân chỉ với vài câu lệnh đơn giản thôi đó meow! 🐾' };
  const parse = JSON.parse;
  JSON.parse = (t) => { const o = parse(t); if (o && o.state) o.state.voice = Object.assign({}, o.state.voice, answer); return o; };
  S.voice = Object.assign({}, S.voice, answer);
  setPage(2); return 1; })()`);
await sleep(3500);
const r = await call('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('/t/shots/09-mei-answer.png', Buffer.from(r.data, 'base64'));
await ev('location.reload(), 1');
console.log('saved 09-mei-answer');
process.exit(0);

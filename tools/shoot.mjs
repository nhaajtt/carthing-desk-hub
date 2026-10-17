// Captures README screenshots from the Car Thing kiosk over DevTools (tunnelled to 127.0.0.1:19223).
import fs from 'node:fs';
const OUT = process.argv[2] || '/t/shots';
fs.mkdirSync(OUT, { recursive: true });
const list = await (await fetch('http://127.0.0.1:19223/json/list')).json();
const pg = list.find((p) => p.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl.replace(/\/\/[^/]+/, '//127.0.0.1:19223'));
let id = 0; const wait = {};
const call = (method, params = {}) => new Promise((r) => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait[d.id]) wait[d.id](d.result); };
await new Promise((r) => (ws.onopen = r));
const ev = (expression) => call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => r.result?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (k) => ev(`dispatchEvent(new KeyboardEvent('keydown', {key: '${k}'})), 1`);
const shot = async (name, clip) => {
  const r = await call('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 }, captureBeyondViewport: true } : {}) });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log('saved', name);
};
const go = async (p) => { await ev(`setPage(${p}), 1`); await sleep(1600); };

const before = await ev("localStorage.getItem('orient') || 'land'");
await ev("localStorage.setItem('orient', 'land'), location.reload(), 1"); await sleep(9000);
await go(0); await key('1'); await sleep(900); await shot('01-news');
await go(1); await sleep(1200); await shot('02-markets');
for (const [n, name] of [[1, '03-markets-btc'], [2, '04-markets-gold'], [3, '05-markets-fx'], [4, '06-markets-indices']]) { await key(String(n)); await sleep(900); await shot(name); await key(String(n)); await sleep(400); }
await go(2); await key('Escape'); await sleep(1500); await shot('07-mei'); // Back closes any answer bubble
// wait for Mei and Nhat to start a scene, then catch a few frames
for (let i = 0; i < 40 && !(await ev("document.getElementById('stage').dataset.busy === '1'")); i++) await sleep(1000);
for (let i = 1; i <= 4; i++) { await sleep(1700); await shot(`08-mei-nhat-${i}`); }
await go(3); await sleep(1500); await shot('10-weather');
await go(5); await sleep(1500); await shot('11-music');
await go(6); await sleep(1500); await shot('12-servers');
await go(7); await sleep(1200); await shot('13-focus');
// Calendar with sample events (the real one is private), then reload to get the live stream back
await go(4); await ev(fs.readFileSync('/t/demo-calendar.js', 'utf8')); await sleep(800); await shot('17-calendar');
await key('3'); await sleep(600); await shot('18-calendar-week'); await key('1');
await ev('location.reload(), 1'); await sleep(9000);
// Mei's briefing (button 1 on her page), written from the live dashboard data
await go(2); await key('1');
for (let i = 0; i < 40 && (await ev("S.voice.phase + S.voice.kind")) !== 'answerbriefing'; i++) await sleep(1000);
await sleep(1200); await shot('19-mei-briefing');
await go(1); await key('m'); await sleep(900); await shot('14-quick-menu'); await key('Escape'); await key('Escape');

// portrait: lay the app out at 480x800 without the rotation so the images come out upright
await call('Emulation.setDeviceMetricsOverride', { width: 480, height: 800, deviceScaleFactor: 1, mobile: false });
await ev(`(() => { const s = document.createElement('style'); s.id = 'shotfix';
  s.textContent = 'html,body{width:480px!important;height:800px!important} body.portrait #app{transform:none!important}';
  document.head.appendChild(s); document.body.dataset.orient = 'cw'; document.body.classList.add('portrait'); return 1; })()`);
await sleep(800);
const P = { x: 0, y: 0, width: 480, height: 800 };
await go(0); await ev('movePill(), 1'); await sleep(500); await shot('20-portrait-news', P);
await go(1); await ev('movePill(), 1'); await sleep(800); await shot('21-portrait-markets', P);
await go(2); await key('Escape'); await ev('movePill(), 1'); await sleep(1500); await shot('22-portrait-mei', P);
await go(3); await ev('movePill(), 1'); await sleep(800); await shot('23-portrait-weather', P);
await go(4); await ev(fs.readFileSync('/t/demo-calendar.js', 'utf8')); await ev('movePill(), 1'); await sleep(800); await shot('24-portrait-calendar', P);
await call('Emulation.clearDeviceMetricsOverride');
await ev(`localStorage.setItem('orient', '${before}'), location.reload(), 1`);
console.log('orientation restored to', before);
process.exit(0);

// Records a short tour of the kiosk as JPEG frames over the DevTools screencast (tunnelled to 127.0.0.1:19223),
// for the README GIF. Frames land in OUT with their timestamps in OUT/frames.txt (ffmpeg concat format).
// usage: node record.mjs /t/rec
import fs from 'node:fs';
const OUT = process.argv[2] || '/t/rec';
fs.mkdirSync(OUT, { recursive: true });
const list = await (await fetch('http://127.0.0.1:19223/json/list')).json();
const pg = list.find((p) => p.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl.replace(/\/\/[^/]+/, '//127.0.0.1:19223'));
let id = 0; const wait = {};
const call = (method, params = {}) => new Promise((r) => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
const frames = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (wait[d.id]) wait[d.id](d.result);
  if (d.method === 'Page.screencastFrame') {
    const name = `f${String(frames.length).padStart(4, '0')}.jpg`;
    fs.writeFileSync(`${OUT}/${name}`, Buffer.from(d.params.data, 'base64'));
    frames.push({ name, t: d.params.metadata.timestamp });
    call('Page.screencastFrameAck', { sessionId: d.params.sessionId });
  }
};
await new Promise((r) => (ws.onopen = r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (expression) => call('Runtime.evaluate', { expression, returnByValue: true });
const key = (k) => ev(`dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(k)}})), 1`);

// start from a calm News page
await ev('setPage(0), newsTopic(0), 1');
await sleep(1500);
await call('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
await sleep(1800);
await key('2'); await sleep(1800);             // button 2: Việt Nam
await key('Enter'); await sleep(700);          // knob press: pick a story
await key('ArrowDown'); await sleep(600);
await key('Enter'); await sleep(3800);         // open its summary
await key('Escape'); await sleep(300); await key('Escape'); await sleep(600);
await key('ArrowRight'); await sleep(2600);    // Markets
await key('1'); await sleep(2400);             // zoom BTC
await key('2'); await sleep(2200);             // zoom gold
await key('Escape'); await sleep(800);
await key('ArrowRight'); await sleep(4500);    // Mei and Nhat
await key('ArrowRight'); await sleep(2400);    // Weather
await key('ArrowRight'); await sleep(1800);    // Calendar
await key('ArrowRight'); await sleep(1800);    // Music
await key('ArrowRight'); await sleep(2200);    // Servers
await key('m'); await sleep(1800);             // quick menu
await key('Escape'); await sleep(900);
await call('Page.stopScreencast');
await sleep(300);
await ev('setPage(0), 1');

// ffmpeg concat list: each frame shown until the next one arrived
const lines = frames.map((f, i) => `file '${f.name}'\nduration ${Math.max(0.02, ((frames[i + 1]?.t ?? f.t + 0.1) - f.t)).toFixed(3)}`);
fs.writeFileSync(`${OUT}/frames.txt`, lines.join('\n') + `\nfile '${frames.at(-1).name}'\n`);
console.log(`${frames.length} frames over ${(frames.at(-1).t - frames[0].t).toFixed(1)} s`);
process.exit(0);

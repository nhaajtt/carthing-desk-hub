// usage: node cdp.mjs shot out.png | node cdp.mjs eval "<js>"   (CDP tunnelled to 127.0.0.1:19223)
import fs from "node:fs";
const [op, arg] = process.argv.slice(2);
const list = await (await fetch("http://127.0.0.1:19223/json/list")).json();
const pg = list.find((p) => p.type === "page");
const ws = new WebSocket(pg.webSocketDebuggerUrl.replace(/\/\/[^/]+/, "//127.0.0.1:19223"));
let id = 0; const wait = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait[d.id]) wait[d.id](d.result); };
const call = (method, params = {}) => new Promise((r) => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => (ws.onopen = r));
if (op === "shot") { const r = await call("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(arg, Buffer.from(r.data, "base64")); console.log("saved", arg, pg.url); }
if (op === "eval") { const r = await call("Runtime.evaluate", { expression: arg, returnByValue: true, awaitPromise: true }); console.log(JSON.stringify(r.result.value ?? r)); }
process.exit(0);

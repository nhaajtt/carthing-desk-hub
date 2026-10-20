// Car mode without pulling the cable (the USB link is the only way into the Car Thing): opens the car copy of the
// page with the hub blocked for that page only, stops it from switching back, then runs steps over DevTools.
//   node cartest.mjs '[["eval", "setPage(DRIVE)"], ["wait", 2000], ["shot", "/t/car.png"]]'
// Open the DevTools tunnel first (see SETUP, Development helpers), and stop kiosk-watch.sh on the Car Thing while
// testing, or it restarts the kiosk because the hub is still alive.
// steps: ["eval", js], ["shot", path], ["wait", ms]
import fs from "node:fs";
const steps = JSON.parse(process.argv[2] || "[]");
const list = await (await fetch("http://127.0.0.1:19223/json/list")).json();
const pg = list.find((p) => p.type === "page");
const ws = new WebSocket(pg.webSocketDebuggerUrl.replace(/\/\/[^/]+/, "//127.0.0.1:19223"));
let id = 0; const wait = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (wait[d.id]) wait[d.id](d.result); };
const call = (method, params = {}) => new Promise((r) => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => (ws.onopen = r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!pg.url.startsWith("http://127.0.0.1:5056")) {
  await call("Network.enable");
  await call("Network.setBlockedURLs", { urls: ["*10.42.1.6*"] });
  await call("Page.navigate", { url: "http://127.0.0.1:5056/" });
  await sleep(5000);
}
await call("Runtime.evaluate", { expression: "checkLink = () => {}; 1" });
for (const [op, arg] of steps) {
  if (op === "wait") await sleep(arg);
  if (op === "shot") { const r = await call("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(arg, Buffer.from(r.data, "base64")); console.log("saved", arg); }
  if (op === "eval") { const r = await call("Runtime.evaluate", { expression: arg, returnByValue: true, awaitPromise: true }); console.log(JSON.stringify(r.result.value ?? r)); }
}
process.exit(0);

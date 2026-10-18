// Frame-time meter for the kiosk, run through steps.mjs: ["evalfile", "/t/framemeter.js"]
// Turns the "knob" through every page (slow, then fast) while logging the gap between animation frames.
// 16.7 ms is a perfect 60 fps frame; anything over 33 ms is a visible stutter.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = (k) => { dispatchEvent(new KeyboardEvent('keydown', { key: k })); dispatchEvent(new KeyboardEvent('keyup', { key: k })); };
  const gaps = [];
  let last = 0, on = true;
  const tick = (t) => { if (last) gaps.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
  setPage(0);
  await sleep(1500);
  requestAnimationFrame(tick);
  for (const [k, gap] of [['ArrowRight', 400], ['ArrowLeft', 400], ['ArrowRight', 120], ['ArrowLeft', 120]]) {
    for (let i = 0; i < 7; i++) { key(k); await sleep(gap); }
  }
  await sleep(800);
  on = false;
  gaps.sort((a, b) => a - b);
  const q = (x) => +gaps[Math.floor(x * (gaps.length - 1))].toFixed(1);
  return JSON.stringify({
    orient: document.body.dataset.orient, frames: gaps.length,
    avg: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1), p50: q(0.5), p95: q(0.95), worst: q(1),
    over20: gaps.filter((g) => g > 20).length, over33: gaps.filter((g) => g > 33).length,
  });
})()

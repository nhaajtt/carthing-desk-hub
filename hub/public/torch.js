'use strict';
// Desk clock after 10 quiet minutes: a torch on a stone wall in the dark, drawn as ASCII art. Every cell of
// a terminal-like grid shows one character, chosen by how bright that spot is (" .,:;-=+*#" on the wall,
// " .,^*o%&#@" in the fire). The flame is the classic "fire" cellular automaton, its light flickers with how
// much fire there is, sparks rise, and the digits catch fire when the minute changes. Turning the knob feeds
// the fire or lets it die down. JS works out one value per cell 30 times a second; the GPU draws every
// character in one pass from a small texture and a glyph atlas.
(() => {
  const CW = 8, CH = 14;           // cell size in px, a terminal cell
  const FW = 15, FH = 26;          // fire grid, in cells
  const FPS = 30;
  // kinds of cell, stored in the texture's green channel; each has its own row of characters
  const WALL = 0, FIRE = 1, DIGIT = 2, WOOD = 3;
  const RAMPS = [' .,:;-=+*#', ' .,^*o%&#@', ' :+*%##@@@', ' .:|||##HH'];
  const N = 10;

  const VS = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
  const FS = `precision mediump float;
uniform sampler2D u_tex; uniform sampler2D u_atlas; uniform vec2 u_grid; uniform vec2 u_cell; uniform float u_h;
vec3 fire(float h) {
  vec3 c = mix(vec3(0.5, 0.06, 0.0), vec3(1.0, 0.42, 0.04), smoothstep(0.0, 0.45, h));
  c = mix(c, vec3(1.0, 0.82, 0.3), smoothstep(0.45, 0.8, h));
  return mix(c, vec3(1.0, 0.98, 0.85), smoothstep(0.8, 1.0, h));
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, u_h - gl_FragCoord.y);
  vec2 c = floor(px / u_cell);
  vec2 f = fract(px / u_cell);
  vec4 v = texture2D(u_tex, (c + 0.5) / u_grid);
  float lum = v.r, kind = floor(v.g * 255.0 + 0.5), heat = v.b;
  float level = kind == 1.0 ? heat : lum;
  float g = level < 0.06 ? 0.0 : clamp(floor(level * ${N}.0), 1.0, ${N - 1}.0);
  if (kind == 2.0) g = clamp(floor(3.0 + lum * 7.0), 3.0, ${N - 1}.0);
  float a = texture2D(u_atlas, vec2((g + f.x) / ${N}.0, (kind + f.y) / ${RAMPS.length}.0)).r;
  vec3 col = vec3(1.0, 0.66, 0.36) * (0.4 + 0.6 * lum);
  if (kind == 1.0) col = fire(heat);
  else if (kind == 2.0) col = heat > 0.0 ? fire(heat) : mix(vec3(0.6, 0.47, 0.34), vec3(1.0, 0.93, 0.8), lum);
  else if (kind == 3.0) col = vec3(0.66, 0.4, 0.2) * (0.35 + 0.9 * lum);
  gl_FragColor = vec4(mix(vec3(0.055, 0.045, 0.04), col, a), 1.0);
}`;

  let canvas, gl, prog, tex, ctx2d, raf = 0, last = 0, t0 = 0;
  let W = 0, H = 0, cols = 0, rows = 0;
  let px, wallTone, lightDist, fireGrid, mask, oldMask, colon, cutout, sparks = [];
  let fx = 0, fy = 0, burnAt = -10, burnFrom = 0, burnSpan = 1, text = { hm: '', ap: '' };
  let fuel = 1;
  try { fuel = Math.min(1.8, Math.max(0.3, Number(localStorage.getItem('torchFuel')) || 1)); } catch {}
  const frac = (v) => v - Math.floor(v);

  function setup() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W; canvas.height = H;
    cols = Math.ceil(W / CW); rows = Math.ceil(H / CH);
    px = new Uint8Array(cols * rows * 4);
    const portrait = H > W;
    // torch: left of the clock in landscape, under it in portrait (flame base, in cells)
    fx = Math.round(cols * (portrait ? 0.5 : 0.13));
    fy = Math.round(rows * (portrait ? 0.66 : 0.62));
    // stone wall: rows of bricks with mortar, each brick a slightly different tone (fixed per visit)
    wallTone = new Float32Array(cols * rows);
    const BW = 7, BH = 2;
    for (let y = 0; y < rows; y++) {
      const course = Math.floor(y / BH), off = course % 2 ? 3 : 0;
      for (let x = 0; x < cols; x++) {
        const brick = Math.floor((x + off) / BW);
        const mortar = y % BH === 0 || (x + off) % BW === 0;
        const tone = 0.6 + 0.4 * frac(Math.sin(brick * 12.9898 + course * 78.233) * 43758.5453);
        wallTone[y * cols + x] = mortar ? 0.35 : tone * (0.88 + 0.16 * Math.random());
      }
    }
    // distance from the flame, scaled so the light reaches about a quarter of the screen at normal fuel
    lightDist = new Float32Array(cols * rows);
    const lx = (fx + 0.5) * CW, ly = (fy - 4) * CH, R = Math.max(W, H) * 0.26;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const dx = (x + 0.5) * CW - lx, dy = (y + 0.5) * CH - ly;
      lightDist[y * cols + x] = (dx * dx + dy * dy) / (R * R) * 2.6;
    }
    fireGrid = new Float32Array(FW * FH);
    mask = new Uint8Array(cols * rows); oldMask = new Uint8Array(cols * rows); colon = new Uint8Array(cols * rows);
    cutout = new Uint8Array(cols * rows);
    sparks = [];
    if (text.hm) drawText(false);
    markInfo();
    if (gl) {
      gl.viewport(0, 0, W, H);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.uniform2f(gl.getUniformLocation(prog, 'u_grid'), cols, rows);
      gl.uniform2f(gl.getUniformLocation(prog, 'u_cell'), CW, CH);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_h'), H);
    }
  }

  // one row of characters per kind of cell, each character centred in a cell, drawn once
  function atlas() {
    const c = document.createElement('canvas');
    c.width = N * CW; c.height = RAMPS.length * CH;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${CH - 1}px "DejaVu Sans Mono", "Liberation Mono", monospace`;
    RAMPS.forEach((ramp, r) => [...ramp].forEach((ch, i) => g.fillText(ch, i * CW + CW / 2, r * CH + CH / 2 + 1)));
    return c;
  }

  // the clock's digits become a mask of cells: drawn once per minute with the page's display font
  function drawText(burn) {
    const portrait = H > W;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const size = Math.round(portrait ? W * 0.3 : H * 0.42);
    const cx = portrait ? W * 0.5 : W * 0.6, cy = portrait ? H * 0.28 : H * 0.38;
    const font = (s) => `800 ${s}px Bricolage, Inter, sans-serif`;
    g.font = font(size);
    const [hh, mm] = text.hm.split(/[:.h]/);
    const sep = text.hm.replace(/[^:.h]/g, '') || ':';
    const wH = g.measureText(hh).width, wC = g.measureText(sep).width, wM = g.measureText(mm || '').width;
    g.font = font(Math.round(size * 0.34));
    const wA = text.ap ? g.measureText(text.ap).width + size * 0.06 : 0;
    g.font = font(size);
    let x = cx - (wH + wC + wM + wA) / 2;
    g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText(hh, x, cy); x += wH;
    g.fillStyle = '#f00'; g.fillText(sep, x, cy); x += wC;
    g.fillStyle = '#fff'; g.fillText(mm || '', x, cy); x += wM;
    if (text.ap) { g.font = font(Math.round(size * 0.34)); g.fillText(text.ap, x + size * 0.06, cy - size * 0.17); }
    const d = g.getImageData(0, 0, W, H).data;
    oldMask.set(mask);
    let minX = cols, maxX = 0;
    for (let y = 0; y < rows; y++) for (let xx = 0; xx < cols; xx++) {
      const i = (Math.min(H - 1, Math.round((y + 0.5) * CH)) * W + Math.min(W - 1, Math.round((xx + 0.5) * CW))) * 4;
      const on = d[i + 3] > 110;
      mask[y * cols + xx] = on ? 1 : 0;
      colon[y * cols + xx] = on && d[i + 1] < 100 ? 1 : 0;
      if (on) { minX = Math.min(minX, xx); maxX = Math.max(maxX, xx); }
    }
    // the digits catch fire from the side nearest the torch
    burnAt = burn ? performance.now() / 1000 : -10;
    burnFrom = portrait ? 0 : minX; burnSpan = Math.max(1, maxX - burnFrom);
    if (!burn) oldMask.set(mask);
  }

  // the date and info lines sit on a darker patch so they stay readable
  function markInfo() {
    cutout.fill(0);
    const info = document.getElementById('amInfo');
    if (!info || !info.offsetWidth) return;
    const x0 = Math.floor(info.offsetLeft / CW) - 1, x1 = Math.ceil((info.offsetLeft + info.offsetWidth) / CW) + 1;
    const y0 = Math.floor(info.offsetTop / CH), y1 = Math.ceil((info.offsetTop + info.offsetHeight) / CH);
    for (let y = Math.max(0, y0); y < Math.min(rows, y1); y++) for (let x = Math.max(0, x0); x < Math.min(cols, x1); x++) cutout[y * cols + x] = 1;
  }

  function stepFire(t, ignite) {
    const wind = Math.sin(t * 0.7) * 0.35 + Math.sin(t * 2.3) * 0.15;
    const half = Math.round(1.5 + 2.5 * fuel), decay = 0.17 / fuel;
    for (let x = 0; x < FW; x++) {
      const inHead = Math.abs(x - (FW >> 1)) <= half;
      fireGrid[(FH - 1) * FW + x] = inHead ? ignite * (0.85 + 0.15 * Math.random()) : 0;
    }
    for (let y = 0; y < FH - 1; y++) for (let x = 0; x < FW; x++) {
      const r = Math.random();
      const src = fireGrid[(y + 1) * FW + x];
      const dx = Math.min(FW - 1, Math.max(0, x - Math.round(r * 2 - 1 + wind)));
      fireGrid[y * FW + dx] = Math.max(0, src - r * decay);
    }
    // sparks leave the top of the flame, more of them the bigger the fire
    if (Math.random() < 0.18 * fuel * ignite) sparks.push({ x: (fx + (Math.random() - 0.5) * 4) * CW, y: (fy - 6 * fuel) * CH, vx: (Math.random() - 0.5) * 30 + wind * 40, vy: -(70 + Math.random() * 90 * fuel), life: 1, fade: 0.45 + Math.random() * 0.5 });
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / FPS - 4) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) setup();
    const t = now / 1000, ignite = Math.min(1, (t - t0) / 1.6);
    stepFire(t, ignite);
    // the light follows the fire: the more burning cells in the lower half of the flame, the brighter,
    // and a bigger fire throws its light further
    let e = 0;
    const band = FW * Math.round(FH / 2);
    for (let i = FW * FH - band; i < FW * FH; i++) e += fireGrid[i];
    const light = ignite * (0.45 + Math.min(0.65, e / band * 1.4)) * (0.92 + 0.08 * Math.sin(t * 9.7) * Math.sin(t * 3.1));
    const reach = 1 / (0.45 + 0.55 * fuel);

    const n = cols * rows;
    for (let i = 0; i < n; i++) {
      const lum = light * wallTone[i] / (1 + lightDist[i] * reach) * (cutout[i] ? 0.15 : 1);
      px[i * 4] = Math.min(255, lum * 255); px[i * 4 + 1] = WALL; px[i * 4 + 2] = 0;
    }
    // digits: lit by the torch but never lost in the dark; a dark ring keeps them apart from the wall
    const age = t - burnAt;
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      const delay = Math.max(0, (x - burnFrom) / burnSpan) * 0.9;
      const lit = age > delay;
      const on = lit ? mask[i] : oldMask[i];
      if (on) {
        let heat = lit && age - delay < 1.4 ? 1 - (age - delay) / 1.4 : 0;
        if (colon[i] && lit) heat = Math.max(heat, 0.45 + 0.25 * Math.sin(t * 3.1) + 0.08 * Math.random());
        px[i * 4] = Math.min(255, (0.25 + light * 1.4 / (1 + lightDist[i] * reach)) * 255); px[i * 4 + 1] = DIGIT; px[i * 4 + 2] = heat * 255;
      } else if (lit && oldMask[i] && age - delay < 0.5) {
        // the old digit burns away
        px[i * 4 + 1] = FIRE; px[i * 4 + 2] = (0.5 - (age - delay)) * 400;
      } else if (mask[i - 1] || mask[i + 1] || mask[i - cols] || mask[i + cols]) px[i * 4] *= 0.15;
    }
    // the torch: an iron cup, a wooden handle and a bracket on the wall
    const put = (x, y, kind, lum, heat = 0) => { if (x >= 0 && y >= 0 && x < cols && y < rows) { const i = (y * cols + x) * 4; px[i] = Math.min(255, lum * 255); px[i + 1] = kind; px[i + 2] = Math.min(255, heat * 255); } };
    for (let y = fy + 1; y <= fy + 2; y++) for (let x = fx - 3 + (y - fy - 1); x <= fx + 3 - (y - fy - 1); x++) put(x, y, WOOD, 0.45 + light * 0.4);
    for (let y = fy + 3; y <= fy + 12; y++) for (let x = fx - 1; x <= fx + 1; x++) put(x, y, WOOD, light * (x === fx - 1 ? 0.95 : 0.6) * (1 - (y - fy) / 22));
    for (let x = fx - 3; x <= fx + 3; x++) put(x, fy + 6, WOOD, light * 0.55);
    // the flame on top
    const ox = fx - (FW >> 1), oy = fy - FH + 1;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const h = fireGrid[y * FW + x];
      if (h > 0.08) put(ox + x, oy + y, FIRE, h, h);
    }
    for (let k = sparks.length - 1; k >= 0; k--) {
      const s = sparks[k];
      s.x += s.vx * dt; s.y += s.vy * dt; s.vx += Math.sin(t * 4 + k) * 20 * dt; s.life -= s.fade * dt;
      if (s.life <= 0 || s.y < 0) { sparks.splice(k, 1); continue; }
      put(Math.floor(s.x / CW), Math.floor(s.y / CH), FIRE, s.life, s.life * 0.9);
    }
    draw();
  }

  function draw() {
    if (gl) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }
    // no WebGL: the same characters with the 2D canvas (slower)
    ctx2d.fillStyle = '#0e0b0a'; ctx2d.fillRect(0, 0, W, H);
    ctx2d.font = `bold ${CH - 1}px "DejaVu Sans Mono", monospace`; ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4, kind = px[i + 1], level = (kind === FIRE ? px[i + 2] : px[i]) / 255;
      const gi = kind === DIGIT ? Math.min(N - 1, Math.floor(3 + level * 7)) : level < 0.06 ? 0 : Math.min(N - 1, Math.max(1, Math.floor(level * N)));
      if (!gi) continue;
      ctx2d.fillStyle = kind === FIRE ? `rgb(255,${80 + px[i + 2] * 0.6 | 0},20)` : kind === DIGIT ? '#fbe9d0' : `rgba(255,170,95,${0.4 + 0.6 * level})`;
      ctx2d.fillText(RAMPS[kind][gi], x * CW + CW / 2, y * CH + CH / 2 + 1);
    }
  }

  function init() {
    canvas = document.getElementById('amCanvas');
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) { ctx2d = canvas.getContext('2d'); return; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const texture = (unit) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    texture(1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas());
    gl.uniform1i(gl.getUniformLocation(prog, 'u_atlas'), 1);
    tex = texture(0);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
  }

  window.deskTorch = {
    start() {
      if (!canvas) init();
      cancelAnimationFrame(raf);
      t0 = performance.now() / 1000; last = 0;
      setup();
      raf = requestAnimationFrame(frame);
    },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    // called when the minute changes (and once on start); the new digits catch fire
    time(hm, ap) {
      text = { hm, ap };
      if (!raf) return;
      drawText(true);
      burnAt = Math.max(burnAt, t0 + 0.9); // on the first draw, wait for the torch to catch
    },
    info() { if (W) markInfo(); },
    // the knob: feed the fire or let it die down
    fuel(step) {
      fuel = Math.min(1.8, Math.max(0.3, Math.round((fuel + step * 0.1) * 10) / 10));
      try { localStorage.setItem('torchFuel', String(fuel)); } catch {}
    },
  };
})();

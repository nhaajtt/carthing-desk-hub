'use strict';
// Mei's stage on the Ask page: Mei and her owner Nhat act out random little scenes while nobody is talking to Mei.
// Everything moves with translate3d on its own layer, so the Car Thing GPU does the work.
(() => {
  const NHAT_SVG = `
<svg viewBox="0 0 110 190" class="nhat-svg" aria-hidden="true">
  <g class="leg la">
    <rect x="36" y="122" width="14" height="54" rx="7" fill="#2e3a6b"/>
    <path d="M35 173 h13 q7 0 7 6 v2 h-21 v-4 q0-4 1-4z" fill="#f4f4f8"/>
    <path d="M36 179 h17" stroke="#ff6f9c" stroke-width="2"/>
  </g>
  <g class="leg lb">
    <rect x="61" y="122" width="14" height="54" rx="7" fill="#38477d"/>
    <path d="M60 173 h13 q7 0 7 6 v2 h-21 v-4 q0-4 1-4z" fill="#e6e6ee"/>
    <path d="M61 179 h17" stroke="#ff6f9c" stroke-width="2"/>
  </g>
  <rect x="35" y="118" width="42" height="12" rx="4" fill="#28335e"/>
  <g class="arm back">
    <rect x="30" y="76" width="15" height="34" rx="7" fill="#3a8be6"/>
    <rect x="32" y="104" width="11" height="18" rx="5" fill="#f2c49a"/>
    <circle cx="37.5" cy="124" r="6" fill="#f2c49a"/>
  </g>
  <path d="M36 82 q0-14 20-14 q22 0 22 14 v40 q0 6-6 6 h-30 q-6 0-6-6z" fill="#4fa3ff"/>
  <path d="M42 70 q14 12 30 0" fill="none" stroke="#3a8be6" stroke-width="5" stroke-linecap="round"/>
  <path d="M52 76 v14 M62 76 v14" stroke="#e8f2ff" stroke-width="2" stroke-linecap="round"/>
  <circle cx="52" cy="91" r="2" fill="#e8f2ff"/><circle cx="62" cy="91" r="2" fill="#e8f2ff"/>
  <rect x="44" y="104" width="28" height="14" rx="6" fill="#3a8be6"/>
  <g fill="#ffc23d"><circle cx="66" cy="86" r="4"/><circle cx="60.5" cy="80" r="2"/><circle cx="64.5" cy="78.5" r="2"/><circle cx="68.5" cy="78.5" r="2"/><circle cx="72" cy="80.5" r="2"/></g>
  <rect x="52" y="62" width="12" height="10" rx="4" fill="#f2c49a"/>
  <g class="head">
    <circle cx="45" cy="47" r="6" fill="#f2c49a"/>
    <circle cx="62" cy="44" r="24" fill="#ffd7b0"/>
    <g class="curls" fill="#2a1f3d">
      <circle cx="37" cy="50" r="7"/><circle cx="38" cy="38" r="9"/><circle cx="43" cy="26" r="9"/>
      <circle cx="52" cy="18" r="9.5"/><circle cx="63" cy="14" r="9.5"/><circle cx="74" cy="16" r="9"/>
      <circle cx="83" cy="23" r="8"/><circle cx="87" cy="32" r="6.5"/><circle cx="48" cy="33" r="8"/>
      <circle cx="59" cy="26" r="8"/><circle cx="70" cy="27" r="7.5"/><circle cx="79" cy="32" r="5.5"/>
    </g>
    <g fill="none" stroke="#5a4a8a" stroke-width="1.8" stroke-linecap="round">
      <path d="M38 33 a5 5 0 0 1 6 -3"/><path d="M48 14 a5 5 0 0 1 7 -2"/><path d="M60 9 a5 5 0 0 1 7 0"/>
      <path d="M72 11 a5 5 0 0 1 6 3"/><path d="M82 19 a4 4 0 0 1 4 4"/><path d="M55 23 a4 4 0 0 1 6 -1"/>
    </g>
    <path class="brow" d="M68 37 q6-3 12 0" stroke="#2a1f3d" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <ellipse cx="74" cy="45" rx="4.6" ry="5.4" fill="#fff"/>
    <ellipse class="eye" cx="75.5" cy="45.5" rx="2.8" ry="3.6" fill="#2a1f3d"/>
    <circle cx="76.5" cy="44" r="1" fill="#fff"/>
    <path d="M83 50 q3 2 0 4" stroke="#d9a07a" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <ellipse cx="70" cy="56" rx="4.5" ry="2.4" fill="#ff9bb0" opacity=".55"/>
    <path class="mouth" d="M74 60 q4 4 8 0" stroke="#7a4a12" stroke-width="2" fill="none" stroke-linecap="round"/>
    <g class="drops"><path d="M40 26 q-5 9 0 11 q5 -2 0 -11 z" fill="#7cc8ff"/><path d="M90 30 q-4 7 0 9 q4 -2 0 -9 z" fill="#7cc8ff"/></g>
  </g>
  <g class="arm front">
    <rect x="62" y="76" width="15" height="34" rx="7" fill="#5cb0ff"/>
    <rect x="64" y="104" width="11" height="18" rx="5" fill="#ffd7b0"/>
    <circle cx="69.5" cy="124" r="6" fill="#ffd7b0"/>
  </g>
</svg>`;

  const stage = $('stage');
  // scenes are written for an 800 px wide stage; positions past either edge stay off-screen
  const W = () => stage.clientWidth || 800;
  const mx = (x) => (x < 0 ? x : x > 800 ? W() + (x - 800) : (x * W()) / 800);
  const um = (x) => (x * 800) / W();
  const props = $('props');
  const mk = (name, svg, w) => {
    const el = $(name === 'mei' ? 'mit' : 'nhat');
    el.innerHTML = `<div class="flip">${svg}</div><div class="emo"></div><div class="held"></div>`;
    return { name, el, flip: el.querySelector('.flip'), emo: el.querySelector('.emo'), held: el.querySelector('.held'),
      w, x: 0, dir: 1, target: null, speed: 70, movePose: 'walk', restPose: 'sit', pose: 'sit', mood: '', done: null, cls: '', tf: '', ftf: '' };
  };
  const mei = mk('mei', MIT_SVG, 104);
  const nhat = mk('nhat', NHAT_SVG, 110);
  mei.x = 120; nhat.x = 900; nhat.dir = -1; nhat.restPose = nhat.pose = 'stand';
  const actors = [mei, nhat];

  function draw(a) {
    const tf = `translate3d(${a.x.toFixed(1)}px,0,0)`;
    if (tf !== a.tf) { a.el.style.transform = tf; a.tf = tf; }
    const ftf = `scaleX(${a.dir})`;
    if (ftf !== a.ftf) { a.flip.style.transform = ftf; a.ftf = ftf; }
    const cls = `actor ${a.name === 'mei' ? 'mit' : 'nhat'} ${a.pose} ${a.mood}`;
    if (cls !== a.cls) { a.el.className = cls; a.cls = cls; }
  }

  // ------------------------------------------------------------ scene toolkit (every step can be cancelled)
  let scene = null;
  const ABORT = Symbol('abort');
  function kit(tok) {
    const live = () => { if (tok.cancelled) throw ABORT; };
    const wait = (ms) => new Promise((res, rej) => { const t = setTimeout(() => (tok.cancelled ? rej(ABORT) : res()), ms); tok.timers.push(t); });
    const go = (a, x, pose = 'walk', speed = 80) => { live(); return new Promise((res, rej) => {
      a.target = mx(x); a.speed = (speed * W()) / 800; a.movePose = pose; a.restPose = a.name === 'mei' ? 'sit' : 'stand';
      a.done = () => (tok.cancelled ? rej(ABORT) : res()); tok.movers.push(a);
    }); };
    const say = (a, text, ms = 1500, block = true) => {
      live();
      a.emo.textContent = text;
      a.emo.classList.remove('on'); void a.emo.offsetWidth; a.emo.classList.add('on');
      clearTimeout(a.emoT); a.emoT = setTimeout(() => a.emo.classList.remove('on'), ms);
      return block ? wait(ms) : Promise.resolve();
    };
    const pose = (a, p) => { live(); a.pose = p; a.restPose = p; draw(a); };
    const mood = (a, m) => { live(); a.mood = m; draw(a); };
    const hold = (a, emoji) => { a.held.textContent = emoji || ''; };
    const tp = (a, x) => { a.x = mx(x); a.tf = ''; draw(a); };
    const face = (a, b) => { a.dir = (b.el ? b.x : mx(b.x)) > a.x ? 1 : -1; draw(a); };
    const hearts = (a, n = 3, ch = '❤') => { for (let k = 0; k < n; k++) setTimeout(() => {
      const h = document.createElement('span');
      h.className = 'heart'; h.textContent = ch;
      h.style.transform = `translate3d(${a.x + a.w / 2 - 8 + (Math.random() * 30 - 15)}px,0,0)`;
      props.appendChild(h); setTimeout(() => h.remove(), 1600);
    }, k * 220); };
    const prop = (name, x, on = true) => {
      let el = props.querySelector(`.prop-${name}`);
      if (!on) { if (el) el.remove(); return null; }
      if (!el) { el = document.createElement('div'); el.className = `prop prop-${name}`; props.appendChild(el); }
      el.style.transform = `translate3d(${mx(x)}px,0,0)`;
      return el;
    };
    return { wait, go, say, pose, mood, hold, tp, face, hearts, prop, um };
  }

  function clearStage() {
    props.innerHTML = '';
    for (const a of actors) { a.held.textContent = ''; a.mood = ''; a.emo.classList.remove('on'); a.target = null; a.done = null; }
  }

  const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

  // ------------------------------------------------------------ the scenes
  const SCENES = {
    async chase(c) {
      c.tp(nhat, 880); await c.go(nhat, 500, 'walk', 90); c.pose(nhat, 'stand'); c.face(nhat, mei);
      c.mood(mei, 'angry'); c.face(mei, nhat); await c.say(mei, '💢 MEOW!!', 1100);
      c.pose(nhat, 'jump'); c.say(nhat, 'Á á á!!', 900, false);
      await Promise.all([c.go(nhat, 900, 'run', 300), c.go(mei, 860, 'run', 285)]);
      c.tp(nhat, -110); c.tp(mei, -560);
      await c.go(nhat, 330, 'run', 260);
      c.pose(nhat, 'tired'); c.mood(nhat, 'sweat'); c.face(nhat, mei);
      await c.say(nhat, 'Phù… thoát rồi 😅', 1700);
      const chase2 = c.go(mei, 210, 'run', 320);
      await c.wait(700); c.mood(nhat, ''); c.pose(nhat, 'jump'); await c.say(nhat, '!!', 450);
      await Promise.all([chase2, c.go(nhat, 900, 'run', 310)]);
      await c.go(mei, 860, 'run', 300);
      c.tp(nhat, -110); c.tp(mei, -330);
      await Promise.all([c.go(nhat, 470, 'run', 190), c.go(mei, 300, 'run', 200)]);
      c.pose(nhat, 'kneel'); c.mood(nhat, 'sweat'); c.face(nhat, mei);
      await c.say(nhat, 'Hết nổi rồi… 🥵', 1400);
      c.hold(nhat, '🥫'); await c.say(nhat, 'Em ăn pate nha, tha anh!', 1600); c.hold(nhat, '');
      c.prop('pate', 400); c.face(mei, nhat); c.mood(mei, '');
      await c.go(mei, 345, 'walk', 110); c.pose(mei, 'eat'); await c.say(mei, 'nom nom nom', 2000);
      c.prop('pate', 0, false); c.pose(mei, 'sit'); c.hearts(mei, 3); await c.say(mei, 'purr~ ❤️', 1500);
      c.pose(nhat, 'sit'); await c.wait(2200); c.mood(nhat, '');
    },

    async laser(c) {
      c.tp(nhat, 880); await c.go(nhat, 650, 'walk', 90); c.pose(nhat, 'point'); c.face(nhat, mei);
      await c.say(nhat, 'Mei ơi, bắt nè! 🔴', 1300);
      for (let k = 0; k < 5; k++) {
        const x = rnd(30, 560);
        c.prop('laser', x);
        await c.go(mei, x - 70, 'run', 280); c.pose(mei, 'pounce'); await c.wait(550); c.pose(mei, 'sit');
      }
      c.prop('laser', c.um(nhat.x) + 20);
      await c.go(mei, c.um(nhat.x) - 95, 'run', 300); c.pose(mei, 'pounce'); c.prop('laser', 0, false);
      c.pose(nhat, 'jump'); await c.say(nhat, 'Á! Anh đâu phải chấm đỏ!', 1600);
      c.pose(nhat, 'stand'); c.pose(mei, 'sit'); await c.say(mei, '😼', 1000);
    },

    async fish(c) {
      c.tp(nhat, 880); c.hold(nhat, '🐟'); await c.go(nhat, 520, 'walk', 70); c.pose(nhat, 'stand');
      await c.say(nhat, 'Bánh mì cá ngon quá~', 1500);
      c.face(mei, nhat); await c.go(mei, 410, 'tiptoe', 55); await c.say(mei, '👀', 800);
      c.hold(nhat, ''); c.hold(mei, '🐟'); c.say(mei, 'Meow! 🐟', 800, false);
      c.face(nhat, mei);
      const run = c.go(mei, -170, 'run', 330);
      await c.wait(400); await c.say(nhat, 'Ê! Trả đây!!', 800);
      await Promise.all([run, c.go(nhat, -120, 'run', 300)]);
      c.tp(mei, 880); c.tp(nhat, 1050);
      await c.go(mei, 480, 'walk', 90); c.hold(mei, ''); c.pose(mei, 'sit'); await c.say(mei, '*liếm mép* 😋', 1500);
      await c.go(nhat, 640, 'walk', 90); c.mood(nhat, 'sweat'); c.face(nhat, mei); await c.say(nhat, 'Thôi… cho em luôn 😩', 1600); c.mood(nhat, '');
    },

    async box(c) {
      c.prop('box', 335); c.face(mei, { x: 335 }); await c.say(mei, '❓', 700);
      await c.go(mei, 320, 'run', 230); c.pose(mei, 'hide');
      c.tp(nhat, 880); await c.go(nhat, 590, 'walk', 85); c.pose(nhat, 'stand');
      await c.say(nhat, 'Mei đâu rồi ta? 🤔', 1500);
      await c.go(nhat, 470, 'walk', 70); c.pose(nhat, 'stand'); await c.say(nhat, '?', 900);
      c.pose(mei, 'jump'); await c.say(mei, 'MEOW!', 600);
      c.pose(nhat, 'jump'); await c.say(nhat, 'Hú hồn!! 😱', 1200);
      c.prop('box', 0, false); c.pose(mei, 'sit'); c.pose(nhat, 'stand'); c.hearts(mei, 2); await c.say(mei, 'hehe', 1000);
    },

    async yarn(c) {
      let x = 720;
      const ball = c.prop('yarn', x);
      for (let k = 0; k < 4; k++) {
        const to = k % 2 ? rnd(560, 700) : rnd(60, 220);
        ball.style.transform = `translate3d(${mx(to)}px,0,0) rotate(${(to - x) * 2}deg)`;
        x = to;
        await c.wait(300);
        await c.go(mei, to + (k % 2 ? -100 : 30), 'run', 240); c.pose(mei, 'pounce'); await c.wait(450); c.pose(mei, 'sit');
      }
      await c.say(mei, '😸', 900); c.prop('yarn', 0, false);
    },

    async nap(c) {
      await c.go(mei, 120, 'walk', 70); c.pose(mei, 'sleep'); c.say(mei, 'Zzz…', 6500, false);
      c.tp(nhat, 880); c.mood(nhat, 'shh'); await c.go(nhat, -140, 'tiptoe', 50);
      c.mood(nhat, ''); await c.wait(800); c.pose(mei, 'sit'); await c.say(mei, '*ngáp* 🥱', 1300);
    },

    async pet(c) {
      c.tp(nhat, 880);
      await c.go(nhat, Math.min(660, c.um(mei.x) + 140), 'walk', 85); c.pose(nhat, 'stand'); c.face(nhat, mei); c.face(mei, nhat);
      await c.say(nhat, 'Mei ngoan quá~', 1300);
      c.pose(nhat, 'pet'); c.hearts(mei, 4); await c.say(mei, 'purr purr~', 1800); c.pose(nhat, 'stand');
      await c.wait(600); await c.go(nhat, 900, 'walk', 85);
    },
  };

  let lastScene = '';
  let nextAt = performance.now() + 7000;
  async function play() {
    const names = Object.keys(SCENES).filter((n) => n !== lastScene);
    const name = names[Math.floor(Math.random() * names.length)];
    lastScene = name;
    const tok = { cancelled: false, timers: [], movers: [] };
    scene = tok;
    try { await SCENES[name](kit(tok)); } catch (e) { if (e !== ABORT) console.error(e); }
    if (scene === tok) {
      scene = null;
      clearStage();
      if (mei.pose === 'hide' || mei.pose === 'sleep' || mei.pose === 'eat' || mei.pose === 'pounce') mei.pose = 'sit';
      nextAt = performance.now() + rnd(10000, 22000);
    }
  }
  function cancel() {
    if (!scene) return;
    scene.cancelled = true;
    scene.timers.forEach(clearTimeout);
    for (const a of scene.movers) { const d = a.done; a.done = null; a.target = null; if (d) d(); }
    scene = null;
    clearStage();
  }

  // ------------------------------------------------------------ frame loop
  let raf = 0, last = 0, wanderAt = 0;
  function spotFor(phase) {
    if (phase === 'starting' || phase === 'listening' || phase === 'thinking') return (W() - mei.w) / 2;
    if (phase === 'answer' || phase === 'error') return 24;
    return null;
  }
  function frame(t) {
    raf = 0;
    if (page !== ASK) return;
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    const phase = (S && S.voice && S.voice.phase) || 'idle';
    const spot = spotFor(phase);
    stage.dataset.busy = scene ? '1' : '';

    if (spot != null) {
      cancel();
      if (Math.abs(mei.x - spot) > 2) { mei.target = spot; mei.speed = 340; mei.movePose = 'run'; } else if (mei.pose !== 'sit') mei.pose = 'sit';
      if (nhat.x < W() + 80) { nhat.target = W() + 100; nhat.speed = 160; nhat.movePose = 'walk'; }
    } else if (!scene && t > nextAt) {
      play();
    } else if (!scene && t > wanderAt && mei.target == null) {
      mei.target = rnd(20, W() - mei.w - 20); mei.speed = 70; mei.movePose = 'walk'; mei.restPose = 'sit';
      wanderAt = t + rnd(4000, 9000);
    }

    for (const a of actors) {
      if (a.target != null) {
        const dx = a.target - a.x;
        if (Math.abs(dx) < 2) {
          a.x = a.target; a.target = null; a.pose = a.restPose;
          const d = a.done; a.done = null; if (d) d();
        } else {
          a.dir = dx > 0 ? 1 : -1;
          a.x += Math.sign(dx) * Math.min(Math.abs(dx), a.speed * dt);
          a.pose = a.movePose;
        }
      }
      draw(a);
    }
    raf = requestAnimationFrame(frame);
  }

  window.meiStage = { start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } } };
  if (page === ASK) window.meiStage.start();
})();

// Voice assistant: the Car Thing records, the hub asks Gemini, the answer is shown on screen.
// The API key stays on the hub; the Car Thing only ever talks to the hub.
// Short commands ("next song", "hẹn giờ 10 phút") are recognised on server 2 first (commands.mjs, whisper.cpp)
// and carried out without Gemini.
import { transcribe, match } from './commands.mjs';
const MAX_SECONDS = 15;
const COMMAND_SECONDS = 3.5; // speech longer than this is a question for Mei, not a command

const SYSTEM = `You are Mei, a friendly little yellow cat who lives on the user's desk display. Your replies are shown as text in a speech bubble on a small 800x480 screen (no speaker).
Be warm and a little playful (an occasional "meow" or 🐾 is fine), but put the useful answer first.
The user lives in San Jose, California, and speaks English or Vietnamese.
Reply in the same language the user spoke. Be concise: at most 70 words, no markdown, no lists longer than 4 items.
You are given live dashboard data (markets, weather, servers, today's headlines). Use it when the question is about those; never invent prices or numbers.
For questions about today's news, research or business, answer from the headlines in the dashboard data and name the outlet. You cannot browse the web: if the answer is not in the data and may have changed recently, say so instead of guessing.
Answer only what the user actually said in the audio; never invent a question from the dashboard data.
When the user says "this", "this story", "tin này" or similar, they mean what is on the screen right now (given below the dashboard data).
If the user asks to be reminded of something or to set a timer, say in A when you will remind them, and add one last line:
R: <minutes from now until then, a whole number; work it out from the local time in the dashboard data for a clock time> | <what to remind them of, short, in their language>
Always reply in exactly this format, with nothing before or after (the R line only for a reminder):
Q: <what the user said, word for word, in their language; leave empty if there was no clear speech>
A: <your answer>
R: <minutes> | <reminder>`;

// The Car Thing's four microphones arrive as 4-channel, 32-bit PCM (hw:0,0).
// Mix them to one channel, downsample to 16 kHz, remove the DC offset, normalise, and decide whether
// anyone spoke by comparing the loudest 50 ms windows with the clip's own background noise.
// (The chip has no hardware mic gain, so all gain is digital.)
const SPEECH_OVER_NOISE = 4;   // loud windows must be this many times the noise floor (quiet room: noise ~4)
const SPEECH_MIN_RMS = 20;     // 16-bit scale after DC removal, before gain; these mics are very quiet
const MAX_GAIN = 40;

function readWav(buf) {
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') { data = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size)); break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('not a WAV recording');
  return { ...fmt, data };
}

export function toSpeechWav(buf) {
  const { channels, rate, bits, data } = readWav(buf);
  const bytes = bits / 8, frame = bytes * channels;
  const frames = Math.floor(data.length / frame);
  const step = Math.max(1, Math.round(rate / 16000));
  const out = new Float32Array(Math.floor(frames / step));
  let mean = 0;
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let f = 0; f < step; f++) {
      const base = (i * step + f) * frame;
      for (let ch = 0; ch < channels; ch++) {
        sum += bytes === 4 ? data.readInt32LE(base + ch * 4) / 65536 : data.readInt16LE(base + ch * 2);
      }
    }
    out[i] = sum / (step * channels);
    mean += out[i];
  }
  mean /= out.length || 1;
  // drop the first 150 ms (the mic settling after it opens) and the DC offset
  const skip = Math.min(out.length, 2400);
  let peak = 0;
  const win = 800, rms = [];
  for (let i = skip; i < out.length; i++) { out[i] -= mean; peak = Math.max(peak, Math.abs(out[i])); }
  for (let w = skip; w + win <= out.length; w += win) {
    let s = 0;
    for (let i = w; i < w + win; i++) s += out[i] * out[i];
    rms.push(Math.sqrt(s / win));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const speech = loud >= SPEECH_MIN_RMS && loud >= noise * SPEECH_OVER_NOISE;
  const gain = peak > 0 ? Math.min(MAX_GAIN, 26000 / peak) : 1;
  const n = out.length - skip;
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[skip + i] * gain))), i * 2);
  // where the speech is: the first and last window clearly over the noise. A short span may be a command
  // (commands.mjs); that part alone, with 0.3 s either side, is what whisper hears.
  const over = Math.max(SPEECH_MIN_RMS, noise * SPEECH_OVER_NOISE) * 0.5;
  const first = rms.findIndex((r) => r >= over), last = rms.length - 1 - [...rms].reverse().findIndex((r) => r >= over);
  const span = first < 0 ? 0 : ((last - first + 1) * win) / 16000;
  const pad = 4800;
  const cut = first < 0 ? pcm : pcm.subarray(Math.max(0, first * win - pad) * 2, Math.min(n, (last + 1) * win + pad) * 2);
  return { wav: wavOf(pcm), speechWav: wavOf(cut), span, peak: Math.round(peak), noise: Math.round(noise), loud: Math.round(loud), speech, gain, seconds: n / 16000 };
}

function wavOf(pcm) {
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(16000, 24); hdr.writeUInt32LE(32000, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([hdr, pcm]);
}

const BOOT_ID = Date.now().toString(36);

export function createAssistant({ state, changed, snapshot, describe, onReminder }) {
  const KEY = process.env.GEMINI_API_KEY || '';
  // Google Search grounding needs a paid plan for current models (2.5 Flash is closed to new keys),
  // so fresh news comes from the headline feeds in the dashboard data instead.
  const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const FALLBACK = process.env.GEMINI_SUMMARY_MODEL || 'gemini-flash-lite-latest';
  const SEARCH = process.env.GEMINI_SEARCH === '1';
  state.voice = { configured: !!KEY, phase: 'idle', transcript: '', answer: '', error: '', at: 0, maxSeconds: MAX_SECONDS };

  // whisper's first clip is slow (the model is read from disk): give it a second of silence after a start
  setTimeout(() => transcribe(wavOf(Buffer.alloc(32000))).catch(() => {}), 20000);

  let seq = 0;
  let active = null;          // id of the recording in progress
  let waiter = null;          // long-poll response held for the Car Thing recorder
  const queue = [];           // commands waiting for the recorder
  const history = [];         // last few exchanges, so follow-up questions work ("and ETH?")
  const HISTORY_MS = 10 * 60000;
  let context = null;         // what the screen showed when the knob was pressed
  let stopTimer = null;

  // answers and errors fade back to idle so Mei and Nhat can play again; a briefing stays up longer
  let idleTimer = null;
  function set(patch) {
    Object.assign(state.voice, { kind: '' }, patch, { at: Date.now() });
    clearTimeout(idleTimer);
    const linger = state.voice.kind === 'briefing' && state.voice.phase === 'answer' ? 15 * 60000
      : state.voice.kind === 'command' && state.voice.phase === 'answer' ? 6000 : { answer: 45000, error: 10000 }[state.voice.phase];
    if (linger) idleTimer = setTimeout(() => set({ phase: 'idle' }), linger);
    changed();
  }

  function send(cmd) {
    if (waiter) { const w = waiter; waiter = null; clearTimeout(w.timer); w.res.end(cmd); }
    else queue.push(cmd);
  }

  // GET /api/voice/cmd  (Car Thing recorder long-poll)
  function waitCommand(res) {
    if (queue.length) return res.end(queue.shift());
    if (waiter) { clearTimeout(waiter.timer); waiter.res.end('idle'); }
    waiter = { res, timer: setTimeout(() => { if (waiter && waiter.res === res) { waiter = null; res.end('idle'); } }, 25000) };
    res.on('close', () => { if (waiter && waiter.res === res) { clearTimeout(waiter.timer); waiter = null; } });
  }

  // 'starting' until the Car Thing reports the microphone is really open, then 'listening'
  function start(ctx) {
    if (['starting', 'listening', 'thinking'].includes(state.voice.phase)) return;
    context = ctx || null;
    active = ++seq;
    queue.length = 0;
    send(`record ${active} ${MAX_SECONDS}`);
    set({ phase: 'starting', transcript: '', answer: '', error: '', searches: [], sources: [], startedAt: null, action: null });
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => { if (state.voice.phase === 'starting') set({ phase: 'error', error: 'The microphone did not open. Press the knob to try again.' }); }, 8000);
  }

  function started(id) {
    if (Number(id) !== active || state.voice.phase !== 'starting') return;
    set({ phase: 'listening', startedAt: Date.now() });
    clearTimeout(stopTimer);
    stopTimer = setTimeout(stop, (MAX_SECONDS + 1) * 1000);
  }

  function stop() {
    clearTimeout(stopTimer);
    if (state.voice.phase !== 'listening' && state.voice.phase !== 'starting') return;
    send(`stop ${active}`);
    set({ phase: 'thinking' });
    // if the recorder never uploads, do not stay stuck
    stopTimer = setTimeout(() => { if (state.voice.phase === 'thinking') set({ phase: 'error', error: 'No audio arrived from the Car Thing.' }); }, 20000);
  }

  async function audio(id, wav) {
    if (Number(id) !== active) return;
    clearTimeout(stopTimer);
    set({ phase: 'thinking' });
    try {
      const clip = toSpeechWav(wav);
      console.log(`[voice] ${clip.seconds.toFixed(1)}s (speech ${clip.span.toFixed(1)}s), peak ${clip.peak}, noise ${clip.noise}, loud ${clip.loud}, gain x${clip.gain.toFixed(1)}, speech ${clip.speech}`);
      if (!clip.speech) {
        return set({ phase: 'error', transcript: '', error: "Meow? I didn't hear anything. Hold the Car Thing closer and speak up, then press the knob again." });
      }
      // a short command is done here and now; anything else (or no whisper) goes to Gemini. Only short speech
      // is tried: whisper takes a few seconds on server 2, which a question for Mei should not wait for.
      let heard = '';
      if (clip.span <= COMMAND_SECONDS) {
        const t0 = Date.now();
        try { heard = await transcribe(clip.speechWav); } catch (e) { console.log('[voice] whisper:', e.message); }
        console.log(`[voice] whisper ${Date.now() - t0} ms`);
      }
      const cmd = heard && match(heard);
      if (cmd) return spoken(heard, cmd);
      if (!KEY) return set({ phase: 'error', error: 'GEMINI_API_KEY is not set on the hub.' });
      const { transcript, answer, searches, sources, reminder } = await ask(clip.wav);
      if (reminder && onReminder) onReminder(reminder.minutes, reminder.text);
      remember(transcript, answer);
      set({ phase: 'answer', transcript, answer, searches, sources });
    } catch (e) {
      set({ phase: 'error', error: String(e.message).slice(0, 200) });
    }
  }

  // what the screen says back, in the language the command was spoken in
  const SAY = {
    next: ['Next song.', 'Bài tiếp theo.'], prev: ['Previous song.', 'Bài trước.'], pause: ['Paused.', 'Đã dừng nhạc.'],
    play: ['Playing.', 'Đang phát.'], volup: ['Louder.', 'To hơn.'], voldown: ['Quieter.', 'Nhỏ hơn.'],
    clock: ['Here is the clock.', 'Đồng hồ đây.'], screenoff: ['Screen off. Touch it to wake it.', 'Đã tắt màn hình, chạm để bật lại.'],
    focus: ['Focus timer started.', 'Bắt đầu tập trung.'],
  };
  let actionSeq = 0;
  function spoken(heard, cmd) {
    const vi = /[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(heard) ? 1 : 0;
    console.log(`[voice] command: ${cmd.act}${cmd.minutes ? ` ${cmd.minutes} min` : ''}`);
    let answer = (SAY[cmd.act] || ['', ''])[vi];
    if (cmd.act === 'timer') {
      if (onReminder) onReminder(cmd.minutes, vi ? 'Hết giờ hẹn' : 'Timer is up');
      answer = vi ? `Đã hẹn giờ ${cmd.minutes} phút.` : `Timer set for ${cmd.minutes} min.`;
    }
    remember(heard, answer);
    // the page carries out everything but the timer (the iPhone's music is only reachable from the Car Thing)
    set({ phase: 'answer', kind: 'command', transcript: heard, answer, searches: [], sources: [],
      action: cmd.act === 'timer' ? null : { ...cmd, id: `${BOOT_ID}.${++actionSeq}` } });
  }

  function remember(q, a) {
    history.push({ q, a, at: Date.now() });
    if (history.length > 4) history.shift();
  }

  // The free tier allows only about 20 requests a day for the main Flash model but far more for Flash-Lite,
  // so when the main model says 429 (quota used up), the same request goes to the lite model instead.
  async function gemini(body, model = MODEL) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429 && model !== FALLBACK) {
      console.log(`[voice] ${model} is over its free quota, using ${FALLBACK}`);
      return gemini(body, FALLBACK);
    }
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${j.error?.message || 'request failed'}`);
    return j.candidates?.[0] || {};
  }

  async function ask(wav) {
    const recent = history.filter((h) => Date.now() - h.at < HISTORY_MS);
    const prior = recent.map((h) => `User: ${h.q}\nAssistant: ${h.a}`).join('\n');
    const screen = describe ? describe(context) : '';
    const cand = await gemini({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{
        role: 'user',
        parts: [
          { text: `Live dashboard data:\n${snapshot()}\n${screen ? `\nOn the screen right now:\n${screen}\n` : ''}${prior ? `\nEarlier in this conversation (the user may follow up on it):\n${prior}\n` : ''}\nThe user's spoken question is in the attached audio.` },
          { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } },
        ],
      }],
      ...(SEARCH ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: { maxOutputTokens: 1200 },
    });
    const full = (cand.content?.parts || []).map((p) => p.text || '').join('').trim();
    const r = full.match(/^\s*R:\s*(\d+)\s*\|\s*(.+)$/m);
    const text = full.replace(/^\s*R:.*$/m, '').trim();
    const q = text.match(/^\s*Q:\s*(.*)$/m);
    const a = text.match(/^\s*A:\s*([\s\S]*)$/m);
    // shown under the answer: what Mei searched on Google and where the facts came from
    const g = cand.groundingMetadata || {};
    const searches = (g.webSearchQueries || []).slice(0, 2);
    const sources = [...new Set((g.groundingChunks || []).map((c) => c.web?.title).filter(Boolean))].slice(0, 3);
    if (searches.length) console.log('[voice] searched:', searches.join(' | '));
    return {
      transcript: q ? q[1].trim() : '',
      answer: (a ? a[1] : text).replace(/\*\*/g, '').trim() || 'No answer.',
      searches, sources,
      reminder: r ? { minutes: Number(r[1]), text: r[2].trim() } : null,
    };
  }

  // the same channel carries device commands (reboot / poweroff) to the Car Thing agent
  const command = (cmd) => send(cmd);

  // Morning briefing: a short spoken-style summary of the day, shown in Mei's bubble.
  // Runs on a schedule from the hub, or from button 1 on Mei's page.
  async function briefing(lang = 'English') {
    if (!KEY) return set({ phase: 'error', error: 'GEMINI_API_KEY is not set on the hub.' });
    if (['starting', 'listening', 'thinking'].includes(state.voice.phase)) return;
    set({ phase: 'thinking', kind: 'briefing', transcript: '', answer: '', error: '', searches: [], sources: [] });
    try {
      const cand = await gemini({
        systemInstruction: { parts: [{ text: SYSTEM.split('If the user asks to be reminded')[0] }] },
        contents: [{ role: 'user', parts: [{ text: `Live dashboard data:\n${snapshot()}\n\n`
          + `Write the user's briefing for today in ${lang}, at most 65 words, as one short paragraph of plain text with whole numbers where possible. `
          + "Cover, in this order: today's weather (range and rain chance), the calendar for today if there is one (times and titles), "
          + 'how BTC and gold moved, the USD/VND rate, the two most important headlines, and, if a Phone line is in the data, '
          + 'how many notifications and missed calls came in overnight and the phone battery. Use only the data above. '
          + 'Start with a one-word cat greeting.' }] }],
        generationConfig: { maxOutputTokens: 1200 },
      });
      const answer = (cand.content?.parts || []).map((p) => p.text || '').join('').replace(/\*\*/g, '').trim();
      if (!answer) throw new Error('Gemini returned an empty briefing.');
      remember('Give me my briefing for today.', answer);
      set({ phase: 'answer', kind: 'briefing', transcript: '', answer });
      return answer;
    } catch (e) {
      set({ phase: 'error', error: String(e.message).slice(0, 200) });
    }
  }

  // Back on Mei's page closes the bubble so Mei and Nhat can play again
  function dismiss() {
    if (state.voice.phase === 'answer' || state.voice.phase === 'error') set({ phase: 'idle' });
  }

  return { start, started, stop, audio, waitCommand, command, briefing, dismiss };
}

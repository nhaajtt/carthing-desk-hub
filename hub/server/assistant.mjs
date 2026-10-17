// Voice assistant: the Car Thing records, the hub asks Gemini, the answer is shown on screen.
// The API key stays on the hub; the Car Thing only ever talks to the hub.
const MAX_SECONDS = 15;

const SYSTEM = `You are Mei, a friendly little yellow cat who lives on the user's desk display. Your replies are shown as text in a speech bubble on a small 800x480 screen (no speaker).
Be warm and a little playful (an occasional "meow" or 🐾 is fine), but put the useful answer first.
The user lives in San Jose, California, and speaks English or Vietnamese.
Reply in the same language the user spoke. Be concise: at most 70 words, no markdown, no lists longer than 4 items.
You are given live dashboard data (markets, weather, servers, today's headlines). Use it when the question is about those; never invent prices or numbers.
For questions about today's news, research or business, answer from the headlines in the dashboard data and name the outlet. You cannot browse the web: if the answer is not in the data and may have changed recently, say so instead of guessing.
Answer only what the user actually said in the audio; never invent a question from the dashboard data.
Always reply in exactly this format, with nothing before or after:
Q: <what the user said, word for word, in their language; leave empty if there was no clear speech>
A: <your answer>`;

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

function toSpeechWav(buf) {
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
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(16000, 24); hdr.writeUInt32LE(32000, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
  return { wav: Buffer.concat([hdr, pcm]), peak: Math.round(peak), noise: Math.round(noise), loud: Math.round(loud), speech, gain, seconds: n / 16000 };
}

export function createAssistant({ state, changed, snapshot }) {
  const KEY = process.env.GEMINI_API_KEY || '';
  // Google Search grounding needs a paid plan for current models (2.5 Flash is closed to new keys),
  // so fresh news comes from the headline feeds in the dashboard data instead.
  const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const SEARCH = process.env.GEMINI_SEARCH === '1';
  state.voice = { configured: !!KEY, phase: 'idle', transcript: '', answer: '', error: '', at: 0, maxSeconds: MAX_SECONDS };

  let seq = 0;
  let active = null;          // id of the recording in progress
  let waiter = null;          // long-poll response held for the Car Thing recorder
  const queue = [];           // commands waiting for the recorder
  const history = [];         // last few exchanges, as text
  let stopTimer = null;

  // answers and errors fade back to idle so Mei and Nhat can play again
  let idleTimer = null;
  function set(patch) {
    Object.assign(state.voice, patch, { at: Date.now() });
    clearTimeout(idleTimer);
    const linger = { answer: 45000, error: 10000 }[state.voice.phase];
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
  function start() {
    if (!KEY) return set({ phase: 'error', error: 'GEMINI_API_KEY is not set on the hub.' });
    if (['starting', 'listening', 'thinking'].includes(state.voice.phase)) return;
    active = ++seq;
    queue.length = 0;
    send(`record ${active} ${MAX_SECONDS}`);
    set({ phase: 'starting', transcript: '', answer: '', error: '', searches: [], sources: [], startedAt: null });
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
      console.log(`[voice] ${clip.seconds.toFixed(1)}s, peak ${clip.peak}, noise ${clip.noise}, loud ${clip.loud}, gain x${clip.gain.toFixed(1)}, speech ${clip.speech}`);
      if (!clip.speech) {
        return set({ phase: 'error', transcript: '', error: "Meow? I didn't hear anything. Hold the Car Thing closer and speak up, then press the knob again." });
      }
      const { transcript, answer, searches, sources } = await ask(clip.wav);
      history.push({ q: transcript, a: answer });
      if (history.length > 3) history.shift();
      set({ phase: 'answer', transcript, answer, searches, sources });
    } catch (e) {
      set({ phase: 'error', error: String(e.message).slice(0, 200) });
    }
  }

  async function ask(wav) {
    const prior = history.map((h) => `User: ${h.q}\nAssistant: ${h.a}`).join('\n');
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{
        role: 'user',
        parts: [
          { text: `Live dashboard data:\n${snapshot()}\n${prior ? `\nEarlier in this conversation:\n${prior}\n` : ''}\nThe user's spoken question is in the attached audio.` },
          { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } },
        ],
      }],
      ...(SEARCH ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: { maxOutputTokens: 1200 },
    };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${j.error?.message || 'request failed'}`);
    const cand = j.candidates?.[0] || {};
    const text = (cand.content?.parts || []).map((p) => p.text || '').join('').trim();
    const q = text.match(/^s*Q:s*(.*)$/m);
    const a = text.match(/^s*A:s*([sS]*)$/m);
    // shown under the answer: what Mei searched on Google and where the facts came from
    const g = cand.groundingMetadata || {};
    const searches = (g.webSearchQueries || []).slice(0, 2);
    const sources = [...new Set((g.groundingChunks || []).map((c) => c.web?.title).filter(Boolean))].slice(0, 3);
    if (searches.length) console.log('[voice] searched:', searches.join(' | '));
    return {
      transcript: q ? q[1].trim() : '',
      answer: (a ? a[1] : text).replace(/**/g, '').trim() || 'No answer.',
      searches, sources,
    };
  }

  // the same channel carries device commands (reboot / poweroff) to the Car Thing agent
  const command = (cmd) => send(cmd);

  return { start, started, stop, audio, waitCommand, command };
}

// Short spoken commands ("next song", "bài tiếp", "hẹn giờ 10 phút") are understood on server 2 itself: the
// clip goes to whisper.cpp in its own container (no internet, no account) and, when the words are one of the
// commands below, the hub acts at once without asking Gemini. Anything else goes on to Mei as before.
const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper:8080/inference';
const MAX_WORDS = 7; // a command is short; a longer sentence is a question for Mei even if it says "next"

export async function transcribe(wav) {
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'clip.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const r = await fetch(WHISPER_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`whisper ${r.status}`);
  const j = await r.json();
  // whisper marks non-speech as [BLANK_AUDIO], (music) and the like
  return String(j.text || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

const NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, 'a minute': 1, 'an hour': 60, 'half an hour': 30,
  'một': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'năm': 5, 'sáu': 6, 'bảy': 7, 'tám': 8, 'chín': 9, 'mười': 10,
  'mười lăm': 15, 'hai mươi': 20, 'hai lăm': 25, 'ba mươi': 30, 'bốn mươi': 40, 'bốn lăm': 45, 'nửa tiếng': 30, 'một tiếng': 60,
};
const number = (s) => {
  const d = s.match(/\d+/);
  if (d) return Number(d[0]);
  // the longest spelled-out number in the sentence ("hai mươi" before "hai")
  const k = Object.keys(NUM).sort((a, b) => b.length - a.length).find((w) => new RegExp(`(^|\\s)${w}(\\s|$)`).test(s));
  return k ? NUM[k] : null;
};

// [pattern, action]; tried in order, on the lower-cased sentence without punctuation
const RULES = [
  [/\b(timer|countdown)\b|hẹn giờ|bấm giờ|đếm ngược/, 'timer'],
  [/\b(focus|pomodoro)\b|tập trung/, 'focus'],
  [/\b(next|skip)\b|bài (tiếp|sau|kế|khác)|chuyển bài|qua bài|bỏ qua/, 'next'],
  [/\b(previous|last song|go back)\b|bài trước|quay lại/, 'prev'],
  [/\b(louder|volume up|turn it up)\b|to (lên|hơn|ra)|tăng (âm lượng|tiếng)|lớn (lên|hơn)/, 'volup'],
  [/\b(quieter|softer|volume down|turn it down)\b|nhỏ (lại|xuống|hơn|đi)|giảm (âm lượng|tiếng)|bé (lại|đi)/, 'voldown'],
  [/\b(pause|stop)\b|dừng|tạm dừng|tắt nhạc|ngừng/, 'pause'],
  [/\b(play|resume)\b|phát|mở nhạc|bật nhạc|tiếp tục/, 'play'],
  [/\b(clock|torch)\b|đồng hồ|ngọn đuốc/, 'clock'],
  [/\b(screen off|turn off the screen)\b|tắt màn hình/, 'screenoff'],
];

// what was said → { act, minutes? } or null
export function match(text) {
  const s = text.toLowerCase().normalize('NFC').replace(/[.,!?;:"“”]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.split(' ').length > MAX_WORDS) return null;
  for (const [re, act] of RULES) {
    if (!re.test(s)) continue;
    if (act === 'timer') {
      let n = number(s);
      // "2 hours", "hai tiếng" (but "an hour", "một tiếng", "nửa tiếng" are already in minutes)
      if (n && n <= 12 && /\bhours?\b|tiếng/.test(s) && !/an hour|half an hour|một tiếng|nửa tiếng/.test(s)) n *= 60;
      return n >= 1 && n <= 600 ? { act, minutes: n } : null;
    }
    if (act === 'focus') return { act, minutes: number(s) };
    return { act };
  }
  return null;
}

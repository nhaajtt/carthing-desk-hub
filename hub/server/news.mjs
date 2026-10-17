// Free headline feeds (Google News RSS sections and searches, Hacker News API) and one-paragraph
// summaries of a story: resolve Google's redirect link, read the article, ask Gemini to summarise it.
import crypto from 'node:crypto';

const GN = 'https://news.google.com/rss';
const US = 'hl=en-US&gl=US&ceid=US:en';
const VN = 'hl=vi&gl=VN&ceid=VN:vi';
export const NEWS_FEEDS = [
  { key: 'top', name: 'Top stories', url: `${GN}?${US}` },
  { key: 'vn', name: 'Việt Nam', url: `${GN}?${VN}` },
  { key: 'vnbiz', name: 'Kinh doanh VN', url: `${GN}/headlines/section/topic/BUSINESS?${VN}` },
  { key: 'tech', name: 'Tech', url: `${GN}/headlines/section/topic/TECHNOLOGY?${US}` },
  { key: 'hn', name: 'Hacker News', hn: true },
];
const PER_FEED = 8;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0 Safari/537.36';
const idOf = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&nbsp;/g, ' ')
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };
const text = (html) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, PER_FEED).map(([, it]) => {
    const source = tag(it, 'source');
    let title = tag(it, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)); // Google appends " - Source"
    const link = tag(it, 'link');
    // the description is a list of other outlets covering the same story; useful when the article is paywalled
    const related = [...decode(tag(it, 'description')).matchAll(/<a [^>]*>([^<]+)<\/a>(?:\s*<font[^>]*>([^<]+)<\/font>)?/g)]
      .map((m) => (m[2] ? `${m[1]} (${m[2]})` : m[1])).slice(0, 6);
    return { id: idOf(link || title), title, source, link, related, at: Date.parse(tag(it, 'pubDate')) || null };
  }).filter((x) => x.title);
}

export async function fetchFeed(feed, getText, getJSON) {
  if (feed.hn) {
    const ids = (await getJSON('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, PER_FEED);
    const items = await Promise.all(ids.map((id) => getJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)));
    return items.filter(Boolean).map((i) => ({
      id: idOf(`hn${i.id}`), title: i.title, url: i.url || `https://news.ycombinator.com/item?id=${i.id}`,
      source: i.url ? new URL(i.url).hostname.replace(/^www\./, '') : 'news.ycombinator.com', at: i.time * 1000, score: i.score, related: [],
    }));
  }
  return parseRss(await getText(feed.url));
}

// ------------------------------------------------------------------ story summaries

// Google News RSS links point at news.google.com; the publisher URL comes back from the same
// batchexecute call the Google News web page makes when you open a story.
async function publisherUrl(link) {
  const id = new URL(link).pathname.split('/').pop();
  const page = await (await fetch(`${GN}/articles/${id}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })).text();
  const sg = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) return null;
  const inner = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
  const r = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]])),
    signal: AbortSignal.timeout(10000),
  });
  const body = await r.text();
  return (body.slice(body.indexOf('garturlres')).match(/https?:[^"\\]+/) || [])[0] || null;
}

async function articleText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8,vi;q=0.6' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  if (!r.ok) return '';
  const html = (await r.text()).slice(0, 600000);
  const meta = html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)/i)?.[1] || '';
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => text(m[1])).filter((t) => t.length > 60);
  return [decode(meta), ...paras].join('\n').slice(0, 6000);
}

const cache = new Map();
// a summary already made for the screen, so Mei can talk about the story that is open
export const cachedSummary = (id) => cache.get(id) || null;

export async function summarize(item, { key, model }) {
  if (cache.has(item.id)) return cache.get(item.id);
  const t0 = Date.now();
  let url = item.url || null, body = '';
  try {
    if (!url && item.link) url = await publisherUrl(item.link);
    if (url) body = await articleText(url);
  } catch (e) {
    console.error('[news] article', e.message);
  }
  const tRead = Date.now() - t0;
  const fromArticle = body.length > 400;
  const material = fromArticle
    ? `Article text:\n${body}`
    : `The article could not be read (paywall or blocked). Other outlets' headlines on the same story:\n${(item.related || []).join('\n') || '(none)'}`;
  let summary;
  if (!key) {
    summary = fromArticle ? body.split('\n')[0].slice(0, 500) : 'Add a Gemini API key to the hub to get summaries.';
  } else {
    // decide the language here: asked to "match the headline", the model sometimes followed the page instead
    const vietnamese = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(item.title);
    const prompt = `Headline: ${item.title}\nSource: ${item.source}\n\n${material}\n\n`
      + 'Write one paragraph of 3 to 5 sentences summarising this news story for a small screen. '
      + `Write the summary in ${vietnamese ? 'Vietnamese' : 'English'}. `
      + 'Use only the material above; do not add facts. '
      + (fromArticle ? '' : 'Say briefly that full details were not available. ')
      + 'Plain text only, no markdown.';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1200 } }),
      signal: AbortSignal.timeout(25000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${j.error?.message || 'request failed'}`);
    summary = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').replace(/\*\*/g, '').trim();
  }
  console.log(`[news] summary ${item.id}: read ${tRead} ms (${fromArticle ? 'article' : 'headlines only'}), total ${Date.now() - t0} ms`);
  const out = { id: item.id, title: item.title, source: item.source, at: item.at, summary, fromArticle, host: url ? new URL(url).hostname.replace(/^www\./, '') : null };
  cache.set(item.id, out);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return out;
}

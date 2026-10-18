// GitHub at a glance: the latest Actions run of your most recently pushed repositories, and open issues / pull
// requests. Public repositories need no token (60 requests an hour, so it polls every 10 minutes). A read-only
// fine-grained token in GITHUB_TOKEN adds private repositories and polls every 5 minutes.
// Conditional requests (ETag) keep unchanged answers cheap.
const API = 'https://api.github.com';
const WATCH = 4;

export function createGitHub({ state, changed, notify, every }) {
  const user = (process.env.GITHUB_USER || '').trim();
  const token = (process.env.GITHUB_TOKEN || '').trim();
  const fixed = (process.env.GITHUB_REPOS || '').split(/[\s,]+/).filter(Boolean);
  state.github = { configured: !!user, user, repos: [], open: null, at: 0 };
  if (!user) return;

  const etags = new Map(); // url -> { etag, body }
  async function gh(path) {
    const url = API + path;
    const c = etags.get(url);
    const r = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json', 'User-Agent': 'carthing-desk-hub', 'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(c ? { 'If-None-Match': c.etag } : {}),
      },
      signal: AbortSignal.timeout(12000),
    });
    if (r.status === 304 && c) return c.body;
    if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`);
    const body = await r.json();
    if (r.headers.get('etag')) etags.set(url, { etag: r.headers.get('etag'), body });
    return body;
  }

  const lastRun = new Map(); // repo -> id of the newest completed run seen

  every(token ? 5 * 60000 : 10 * 60000, 'github', async () => {
    let names = fixed;
    const info = new Map();
    if (!names.length) {
      const list = await gh(token ? '/user/repos?sort=pushed&per_page=15&affiliation=owner' : `/users/${encodeURIComponent(user)}/repos?sort=pushed&per_page=15&type=owner`);
      const live = list.filter((r) => !r.archived && !r.fork).slice(0, WATCH);
      live.forEach((r) => info.set(r.full_name, r));
      names = live.map((r) => r.full_name);
    }
    const repos = [];
    for (const name of names.slice(0, 6)) {
      const runs = await gh(`/repos/${name}/actions/runs?per_page=1`);
      const run = runs.workflow_runs && runs.workflow_runs[0];
      const r = info.get(name);
      repos.push({
        name: name.split('/')[1], private: !!(r && r.private), pushedAt: r ? Date.parse(r.pushed_at) : null,
        ci: run ? { status: run.status, conclusion: run.conclusion, workflow: String(run.name || '').slice(0, 30), branch: String(run.head_branch || '').slice(0, 30), title: String(run.display_title || '').slice(0, 80), at: Date.parse(run.updated_at) } : null,
      });
      if (run && run.status === 'completed') {
        const prev = lastRun.get(name);
        lastRun.set(name, run.id);
        if (prev && prev !== run.id && run.conclusion === 'failure') notify('ci', `${name.split('/')[1]}: ${run.name} ${state.display?.lang === 'vi' ? 'thất bại trên' : 'failed on'} ${run.head_branch}`);
      }
    }
    const q = encodeURIComponent(`user:${user} is:open archived:false`);
    const s = await gh(`/search/issues?q=${q}&sort=created&order=desc&per_page=5`);
    const p = await gh(`/search/issues?q=${q}+is:pr&per_page=1`);
    const items = (s.items || []).map((i) => ({
      repo: (i.repository_url || '').split('/').pop().slice(0, 40), n: i.number, title: String(i.title).slice(0, 90),
      pr: !!i.pull_request, at: Date.parse(i.created_at),
    }));
    state.github = {
      configured: true, user, repos,
      open: { prs: p.total_count || 0, issues: Math.max(0, (s.total_count || 0) - (p.total_count || 0)), items },
      at: Date.now(),
    };
  });
}

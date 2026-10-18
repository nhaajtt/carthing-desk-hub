// Checks whether a newer image exists for each running container: compares the digest the image was pulled by
// with what the registry serves for the same tag now. Anonymous HEAD requests only (Docker Hub does not count
// them against the pull limit), every 6 hours. Private images just show as unknown.
const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export function parseRef(ref) {
  let rest = ref.split('@')[0];
  let registry = 'registry-1.docker.io';
  const first = rest.split('/')[0];
  if (rest.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost')) {
    registry = first === 'docker.io' ? registry : first;
    rest = rest.slice(first.length + 1);
  }
  const m = rest.match(/^(.*?)(?::([^/:]+))?$/);
  let repo = m[1];
  if (registry === 'registry-1.docker.io' && !repo.includes('/')) repo = `library/${repo}`;
  return { registry, repo, tag: m[2] || 'latest' };
}

async function remoteDigest(ref) {
  const { registry, repo, tag } = parseRef(ref);
  const url = `https://${registry}/v2/${repo}/manifests/${tag}`;
  const head = (auth) => fetch(url, { method: 'HEAD', headers: { Accept: ACCEPT, ...(auth ? { Authorization: auth } : {}) }, signal: AbortSignal.timeout(10000) });
  let r = await head();
  if (r.status === 401) {
    // anonymous token for pull access, from the realm the registry names
    const wa = r.headers.get('www-authenticate') || '';
    const p = Object.fromEntries([...wa.matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    if (!/^bearer/i.test(wa) || !p.realm) throw new Error('auth');
    const q = new URLSearchParams({ ...(p.service ? { service: p.service } : {}), scope: p.scope || `repository:${repo}:pull` });
    const t = await fetch(`${p.realm}?${q}`, { signal: AbortSignal.timeout(10000) });
    if (!t.ok) throw new Error(`token ${t.status}`);
    const j = await t.json();
    r = await head(`Bearer ${j.token || j.access_token}`);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.headers.get('docker-content-digest');
}

export function createRegistry({ state, changed, every }) {
  state.updates = state.updates || {};
  state.updates.images = [];
  const cache = new Map(); // ref -> { digest, at }

  every(6 * 3600000, 'registry', async () => {
    // wait for the container lists on the first run
    if (!state.servers.server2?.containers) await new Promise((r) => setTimeout(r, 60000));
    const lists = [
      ['server 2', state.servers.server2?.containers?.list],
      ['server 1', state.servers.server1?.stats?.containers?.list],
    ];
    const out = [];
    for (const [server, list] of lists) {
      for (const c of list || []) {
        if (!c.image || !c.digest) continue;
        let remote = cache.get(c.image);
        if (!remote || Date.now() - remote.at > 5 * 3600000) {
          try { remote = { digest: await remoteDigest(c.image), at: Date.now() }; }
          catch { remote = { digest: null, at: Date.now() }; }
          cache.set(c.image, remote);
        }
        out.push({ server, name: c.name, image: c.image, update: remote.digest ? remote.digest !== c.digest : null });
      }
    }
    state.updates.images = out;
    state.updates.imagesAt = Date.now();
    changed();
  });
}

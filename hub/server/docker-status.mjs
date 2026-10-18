// Read-only container summary. The only Docker API calls made are GET /containers/json and GET /images/json,
// and only name/state/health, the image name and digest, and ports published on every interface leave this
// process. Not published on any host port.
import http from 'node:http';

function dockerGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: '/var/run/docker.sock', path, method: 'GET', timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('docker timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function listContainers() {
  const [containers, images] = await Promise.all([dockerGet('/containers/json?all=1'), dockerGet('/images/json')]);
  const digests = new Map(images.map((i) => [i.Id, i.RepoDigests || []]));
  return containers.map((c) => {
    // the digest the image was pulled by, so the hub can ask the registry whether a newer one exists
    const repo = c.Image.split('@')[0].replace(/:[^/:]+$/, '');
    const digest = (digests.get(c.ImageID) || []).find((d) => d.split('@')[0] === repo || d.split('@')[0].endsWith('/' + repo));
    return {
      name: (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, ''),
      state: c.State,
      health: /\(unhealthy\)/.test(c.Status) ? 'unhealthy' : /\(healthy\)/.test(c.Status) ? 'healthy' : /\(health: starting\)/.test(c.Status) ? 'starting' : null,
      status: c.Status,
      image: c.Image.startsWith('sha256:') ? null : c.Image,
      digest: digest ? digest.split('@')[1] : null,
      // published on 0.0.0.0 / [::]: reachable on every interface, and Docker bypasses UFW for these
      open: [...new Set((c.Ports || []).filter((p) => p.PublicPort && (p.IP === '0.0.0.0' || p.IP === '::')).map((p) => `${p.Type}/${p.PublicPort}`))],
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

http.createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/') { res.writeHead(404); return res.end(); }
  listContainers()
    .then((list) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(list)); })
    .catch((e) => { res.writeHead(502); res.end(String(e.message)); });
}).listen(8080, () => console.log('docker-status on :8080'));

// Read-only container summary. The only Docker API call made is GET /containers/json,
// and only name/state/health leave this process. Not published on any host port.
import http from 'node:http';

function listContainers() {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: '/var/run/docker.sock', path: '/containers/json?all=1', method: 'GET', timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).map((c) => ({
            name: (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, ''),
            state: c.State,
            health: /\(unhealthy\)/.test(c.Status) ? 'unhealthy' : /\(healthy\)/.test(c.Status) ? 'healthy' : /\(health: starting\)/.test(c.Status) ? 'starting' : null,
            status: c.Status,
          })).sort((a, b) => a.name.localeCompare(b.name)));
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('docker timeout')));
    req.on('error', reject);
    req.end();
  });
}

http.createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/') { res.writeHead(404); return res.end(); }
  listContainers()
    .then((list) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(list)); })
    .catch((e) => { res.writeHead(502); res.end(String(e.message)); });
}).listen(8080, () => console.log('docker-status on :8080'));

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRef } from '../server/registry.mjs';
import { cleanReport } from '../server/security.mjs';

test('image references map to registry, repository and tag', () => {
  assert.deepEqual(parseRef('node:22-bookworm-slim'), { registry: 'registry-1.docker.io', repo: 'library/node', tag: '22-bookworm-slim' });
  assert.deepEqual(parseRef('portainer/agent:2.45.2'), { registry: 'registry-1.docker.io', repo: 'portainer/agent', tag: '2.45.2' });
  assert.deepEqual(parseRef('ghcr.io/lavalink-devs/lavalink:4'), { registry: 'ghcr.io', repo: 'lavalink-devs/lavalink', tag: '4' });
  assert.deepEqual(parseRef('docker.io/library/python'), { registry: 'registry-1.docker.io', repo: 'library/python', tag: 'latest' });
  assert.deepEqual(parseRef('localhost:5000/app:dev'), { registry: 'localhost:5000', repo: 'app', tag: 'dev' });
});

test('host reports keep only the expected shape', () => {
  const r = cleanReport({
    at: 1000, extra: 'dropped',
    ssh: { fail1h: 2, fail24h: '9', top: [{ ip: '10.0.0.9', n: 2, more: 1 }, {}, {}, {}] },
    ufw: { block1h: 1, block24h: 5, top: [{ what: 'x'.repeat(200), via: 'eth0', n: 5 }] },
    listen: ['tcp/22', 'udp/123'],
    apt: { upgradable: 3, security: 1, reboot: 'yes' },
  });
  assert.equal(r.extra, undefined);
  assert.equal(r.ssh.fail24h, 0); // not a number: ignored
  assert.equal(r.ssh.top.length, 3);
  assert.deepEqual(r.ssh.top[0], { ip: '10.0.0.9', n: 2 });
  assert.equal(r.ufw.top[0].what.length, 60);
  assert.deepEqual(r.listen, ['tcp/22', 'udp/123']);
  assert.equal(r.apt.reboot, false); // only true counts
  assert.equal(cleanReport('nope'), null);
});

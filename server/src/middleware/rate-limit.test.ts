import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'net';
import { userMutationRateLimit } from './rate-limit.js';

test('mutation limit is per user, not shared', async () => {
  const app = express();
  app.use((req, _res, next) => { (req as any).user = { email: String(req.headers['x-user']) }; next(); });
  app.use(userMutationRateLimit);
  app.post('/x', (_req, res) => { res.json({ ok: true }); });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const post = (user: string) => fetch(`http://127.0.0.1:${port}/x`, { method: 'POST', headers: { 'x-user': user } });
  try {
    for (let i = 0; i < 60; i++) assert.equal((await post('a@ionos.com')).status, 200);
    assert.equal((await post('a@ionos.com')).status, 429);
    assert.equal((await post('b@ionos.com')).status, 200);
  } finally {
    server.closeAllConnections(); // Node 18: keep-alive sockets would otherwise hold the process ~5s
    server.close();
  }
});

// A1: "Chirp keeps working even if Relay is not running; activity simply goes unnotified."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db/db.js';
import { createRelayClient } from '../src/relayClient.js';

const quietLog = { warn() {} };

async function unusedPort() {
  const srv = createServer().listen(0);
  await new Promise((r) => srv.once('listening', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

test('with Relay stopped, every action still succeeds and is saved', async () => {
  const relay = createRelayClient({ baseUrl: `http://127.0.0.1:${await unusedPort()}`, log: quietLog });
  const api = request(createApp(openDb(':memory:'), relay));

  const post = await api.post('/api/posts').send({ actorId: 'asha', text: 'Hello @rahul' }).expect(201);
  assert.equal(post.body.relay.reported, false);
  assert.match(post.body.relay.error, /went unnotified/);

  await api.post(`/api/posts/${post.body.post.id}/comments`).send({ actorId: 'rahul', text: 'Hi!' }).expect(201);
  await api.post(`/api/posts/${post.body.post.id}/likes`).send({ actorId: 'meera' }).expect(201);
  await api.post('/api/users/asha/followers').send({ actorId: 'dev' }).expect(201);

  const { posts } = (await api.get('/api/posts')).body;
  assert.equal(posts[0].comments.length, 1);
  assert.deepEqual(posts[0].likedBy, ['meera']);
});

test('a Relay that hangs does not hang Chirp', async (t) => {
  const hanging = createServer(() => { /* never responds */ }).listen(0);
  await new Promise((r) => hanging.once('listening', r));
  t.after(() => { hanging.closeAllConnections(); hanging.close(); });

  const relay = createRelayClient({ baseUrl: `http://127.0.0.1:${hanging.address().port}`, timeoutMs: 200, log: quietLog });
  const api = request(createApp(openDb(':memory:'), relay));

  const started = Date.now();
  const res = await api.post('/api/posts').send({ actorId: 'asha', text: 'still here' }).expect(201);
  assert.equal(res.body.relay.reported, false);
  assert.ok(Date.now() - started < 2000, 'gave up on Relay quickly');
});

// The brief's section 5 story, through the real Chirp and real Relay over HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp as createChirp } from '../src/app.js';
import { openDb as openChirpDb } from '../src/db/db.js';
import { createRelayClient } from '../src/relayClient.js';
import { createApp as createRelay } from '../../relay-service/src/app.js';
import { openDb as openRelayDb } from '../../relay-service/src/db/db.js';

test('Chirp → Relay → Asha\'s inbox, exactly as in the brief', async (t) => {
  const relayServer = createRelay(openRelayDb(':memory:')).listen(0);
  await new Promise((r) => relayServer.once('listening', r));
  t.after(() => relayServer.close());
  const relayUrl = `http://127.0.0.1:${relayServer.address().port}`;

  const chirpDb = openChirpDb(':memory:');
  const relayClient = createRelayClient({ baseUrl: relayUrl });
  await relayClient.registerUsers(chirpDb.prepare('SELECT id, name FROM users').all());
  const chirp = request(createChirp(chirpDb, relayClient));
  const relay = request(relayUrl);

  // Asha has turned off likes. Her starter post is in the feed.
  await relay.put('/api/users/asha/preferences').send({ new_like: false }).expect(200);
  const postId = (await chirp.get('/api/posts')).body.posts[0].id;

  // 1. Rahul comments "Great photo!" on Asha's post.
  const comment = await chirp.post(`/api/posts/${postId}/comments`).send({ actorId: 'rahul', text: 'Great photo!' }).expect(201);
  assert.equal(comment.body.relay.reported, true);
  assert.equal(comment.body.relay.summary, 'Notified 1, skipped 0.');

  // 2–5. Asha has one unread notification with the right words.
  let inbox = (await relay.get('/api/users/asha/inbox')).body;
  assert.equal(inbox.unreadCount, 1);
  assert.equal(inbox.items[0].body, "Rahul commented on your post: 'Great photo!'");
  assert.equal((await relay.get('/api/users/rahul/inbox')).body.unreadCount, 0, 'Rahul is not told about his own comment');

  // 6. Meera likes the post: Asha is skipped, and the record says why.
  const like = await chirp.post(`/api/posts/${postId}/likes`).send({ actorId: 'meera' }).expect(201);
  assert.equal(like.body.relay.summary, 'Notified 0, skipped 1.');
  const record = (await relay.get(`/api/events/${like.body.relay.eventId}`)).body;
  assert.equal(record.results[0].reason, 'Asha has turned off "New like" notifications.');
  assert.equal((await relay.get('/api/users/asha/inbox')).body.items.length, 1);

  // 7. Asha opens the notification; it is marked read.
  await relay.post(`/api/users/asha/notifications/${inbox.items[0].id}/read`).expect(200);
  inbox = (await relay.get('/api/users/asha/inbox')).body;
  assert.equal(inbox.unreadCount, 0);
  assert.equal(inbox.items[0].read, true);
});

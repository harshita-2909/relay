// Section 5 of the brief, start to finish, through the public API only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASHA, MEERA, RAHUL, commentEvent, likeEvent, makeRelay } from './helpers.js';

test('the brief\'s example story works end to end', async () => {
  const { api } = makeRelay();

  // Asha exists and has turned off likes.
  await api.put('/api/users/asha').send({ name: 'Asha' }).expect(200);
  await api.put('/api/users/asha/preferences').send({ new_like: false }).expect(200);

  // 1–5. Rahul comments "Great photo!" on Asha's post.
  const comment = await api.post('/api/events').send(commentEvent(RAHUL)).expect(201);
  assert.equal(comment.body.description, "Rahul commented on Asha's post");
  assert.equal(comment.body.results.length, 1, 'only Asha is considered; Rahul is the actor');
  assert.equal(comment.body.results[0].recipient.id, 'asha');
  assert.equal(comment.body.results[0].outcome, 'delivered');
  assert.equal(comment.body.results[0].body, "Rahul commented on your post: 'Great photo!'");

  let inbox = (await api.get('/api/users/asha/inbox').expect(200)).body;
  assert.equal(inbox.unreadCount, 1);
  assert.equal(inbox.items[0].read, false);

  // 6. Meera likes the post: Asha is skipped, and the record says why.
  const like = await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  assert.equal(like.body.results[0].outcome, 'skipped');
  assert.equal(like.body.results[0].reasonCode, 'preference_off');
  assert.equal(like.body.results[0].reason, 'Asha has turned off "New like" notifications.');

  inbox = (await api.get('/api/users/asha/inbox').expect(200)).body;
  assert.equal(inbox.items.length, 1, 'nothing new appears');
  assert.equal(inbox.unreadCount, 1);

  const record = (await api.get(`/api/events/${like.body.eventId}`).expect(200)).body;
  assert.equal(record.description, "Meera liked Asha's post");
  assert.equal(record.summary, 'Notified 0, skipped 1.');
  assert.match(record.results[0].reason, /Asha has turned off/);

  // 7. Asha opens her inbox and reads the comment notification.
  const read = await api.post(`/api/users/asha/notifications/${inbox.items[0].id}/read`).expect(200);
  assert.equal(read.body.notification.read, true);
  assert.equal(read.body.unreadCount, 0);
});

test('the story still works if Relay first hears of Asha from the event itself', async () => {
  const { api } = makeRelay();
  await api.post('/api/events').send(commentEvent(RAHUL)).expect(201);
  const { body } = await api.get('/api/users/asha').expect(200);
  assert.deepEqual({ id: body.id, name: body.name }, ASHA);
});

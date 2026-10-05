// B5: mute notifications about one post.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASHA, MEERA, POST, RAHUL, commentEvent, likeEvent, makeRelay } from './helpers.js';

async function setup() {
  const relay = makeRelay();
  await relay.api.put('/api/users/asha').send({ name: 'Asha' });
  return relay;
}

test('a muted post produces no likes or comments for that person, with the reason recorded', async () => {
  const { api } = await setup();
  const mute = await api.put('/api/users/asha/mutes/post:p1').expect(200);
  assert.deepEqual(mute.body.mutes.map((m) => m.subject), ['post:p1']);

  const like = await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  assert.equal(like.body.results[0].outcome, 'skipped');
  assert.equal(like.body.results[0].reasonCode, 'muted');
  assert.equal(like.body.results[0].reason, 'Asha muted notifications about this post.');

  const comment = await api.post('/api/events').send(commentEvent(RAHUL)).expect(201);
  assert.equal(comment.body.results[0].reasonCode, 'muted');
  assert.equal((await api.get('/api/users/asha/inbox')).body.items.length, 0);
});

test('other posts are unaffected', async () => {
  const { api } = await setup();
  await api.put('/api/users/asha/mutes/post:p1').expect(200);
  const { body } = await api.post('/api/events').send(likeEvent(MEERA, { ...POST, id: 'p2' })).expect(201);
  assert.equal(body.results[0].outcome, 'delivered');
});

test('a direct @mention still gets through a mute', async () => {
  const { api } = await setup();
  await api.put('/api/users/asha/mutes/post:p1').expect(200);
  const { body } = await api.post('/api/events')
    .send(commentEvent(RAHUL, { text: '@Asha you need to see this', mentions: [ASHA] })).expect(201);
  assert.equal(body.results[0].outcome, 'delivered');
  assert.equal(body.results[0].type, 'mention');
});

test('when mentions are off and the post is muted, the record gives both reasons', async () => {
  const { api } = await setup();
  await api.put('/api/users/asha/preferences').send({ mention: false });
  await api.put('/api/users/asha/mutes/post:p1').expect(200);
  const { body } = await api.post('/api/events')
    .send(commentEvent(RAHUL, { text: '@Asha hi', mentions: [ASHA] })).expect(201);
  assert.equal(body.results[0].reasonCode, 'muted');
  assert.equal(body.results[0].reason,
    'Asha has turned off "Mention" notifications, and Asha muted notifications about this post.');
});

test('unmuting brings notifications back; muting is idempotent', async () => {
  const { api } = await setup();
  await api.put('/api/users/asha/mutes/post:p1').expect(200);
  await api.put('/api/users/asha/mutes/post:p1').expect(200);
  const off = await api.delete('/api/users/asha/mutes/post:p1').expect(200);
  assert.deepEqual(off.body.mutes, []);
  const { body } = await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  assert.equal(body.results[0].outcome, 'delivered');
});

test('notifications carry their subject so the inbox can offer "mute this post"', async () => {
  const { api } = await setup();
  await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  assert.equal((await api.get('/api/users/asha/inbox')).body.items[0].subject, 'post:p1');
});

test('bad subjects and unknown people are refused clearly', async () => {
  const { api } = await setup();
  const bad = await api.put('/api/users/asha/mutes/not-a-subject').expect(400);
  assert.equal(bad.body.error.code, 'invalid_subject');
  await api.put('/api/users/ghost/mutes/post:p1').expect(404);
});

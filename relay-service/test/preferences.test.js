// A3: each person chooses which kinds of notification they get.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEERA, likeEvent, makeRelay } from './helpers.js';

const prefsOf = (body) => Object.fromEntries(body.preferences.map((p) => [p.type, p.enabled]));

test('new people start with every type switched on', async () => {
  const { api } = makeRelay();
  await api.put('/api/users/dev').send({ name: 'Dev' }).expect(200);
  const { body } = await api.get('/api/users/dev/preferences').expect(200);
  assert.deepEqual(prefsOf(body), { mention: true, new_comment: true, new_follower: true, new_like: true, new_post: true });
  assert.ok(body.preferences.every((p) => p.isDefault));
});

test('a type can be switched off and back on, and delivery follows', async () => {
  const { api } = makeRelay();
  await api.put('/api/users/asha').send({ name: 'Asha' });

  const off = await api.put('/api/users/asha/preferences').send({ new_like: false }).expect(200);
  assert.equal(prefsOf(off.body).new_like, false);
  assert.equal(off.body.preferences.find((p) => p.type === 'new_like').isDefault, false);
  let res = await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  assert.equal(res.body.results[0].outcome, 'skipped');

  await api.put('/api/users/asha/preferences').send({ new_like: true }).expect(200);
  res = await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  assert.equal(res.body.results[0].outcome, 'delivered');
});

test('one person\'s choices do not affect anyone else', async () => {
  const { api } = makeRelay();
  await api.put('/api/users/asha').send({ name: 'Asha' });
  await api.put('/api/users/meera').send({ name: 'Meera' });
  await api.put('/api/users/asha/preferences').send({ new_like: false }).expect(200);
  const { body } = await api.get('/api/users/meera/preferences').expect(200);
  assert.equal(prefsOf(body).new_like, true);
});

test('invalid preference changes are rejected with reasons and change nothing', async () => {
  const { api } = makeRelay();
  await api.put('/api/users/asha').send({ name: 'Asha' });
  const res = await api.put('/api/users/asha/preferences').send({ new_like: false, new_share: false, mention: 'no' }).expect(400);
  assert.match(res.body.error.message, /"new_share" is not a notification type/);
  assert.match(res.body.error.message, /"mention" must be true or false/);
  const { body } = await api.get('/api/users/asha/preferences');
  assert.equal(prefsOf(body).new_like, true, 'the valid part was not applied either');
  await api.put('/api/users/asha/preferences').send({}).expect(400);
});

test('changing preferences for someone Relay has never heard of is a clear 404', async () => {
  const { api } = makeRelay();
  const res = await api.put('/api/users/ghost/preferences').send({ new_like: false }).expect(404);
  assert.equal(res.body.error.code, 'user_not_found');
});

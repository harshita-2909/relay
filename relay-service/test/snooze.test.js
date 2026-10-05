// B5: snooze everything for a while. Activity during a snooze is held, not lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASHA, MEERA, RAHUL, commentEvent, fakeClock, followEvent, likeEvent, makeRelay } from './helpers.js';

const inboxOf = async (api, id) => (await api.get(`/api/users/${id}/inbox`).expect(200)).body;

async function setup(t) {
  const relay = makeRelay();
  relay.clock = fakeClock(t);
  await relay.api.put('/api/users/asha').send({ name: 'Asha' });
  return relay;
}

test('during a snooze, notifications are held out of the inbox and the unread count', async (t) => {
  const { api } = await setup(t);
  const snooze = await api.put('/api/users/asha/snooze').send({ minutes: 30 }).expect(200);
  assert.equal(snooze.body.active, true);
  assert.equal(snooze.body.until, '2026-10-05T10:30:00.000Z');

  const { body } = await api.post('/api/events').send(commentEvent(RAHUL)).expect(201);
  assert.equal(body.results[0].outcome, 'held');
  assert.equal(body.results[0].reasonCode, 'snoozed');
  assert.match(body.results[0].reason, /^Held: Asha is snoozing until .+, so this "New comment" notification will appear in their inbox then\.$/);
  assert.equal(body.summary, 'Notified 0, held 1, skipped 0.');

  const inbox = await inboxOf(api, 'asha');
  assert.equal(inbox.items.length, 0);
  assert.equal(inbox.unreadCount, 0);
  assert.deepEqual(inbox.snooze, { active: true, until: '2026-10-05T10:30:00.000Z', heldCount: 1 });
});

test('when the snooze runs out, held notifications appear unread on their own', async (t) => {
  const { api, clock } = await setup(t);
  await api.put('/api/users/asha/snooze').send({ minutes: 30 }).expect(200);
  await api.post('/api/events').send(commentEvent(RAHUL)).expect(201);
  await api.post('/api/events').send(followEvent(MEERA, ASHA)).expect(201);

  clock.advance(31);
  const inbox = await inboxOf(api, 'asha');
  assert.equal(inbox.unreadCount, 2);
  assert.equal(inbox.items.length, 2);
  assert.equal(inbox.snooze.active, false);
});

test('ending a snooze early releases everything straight away', async (t) => {
  const { api } = await setup(t);
  await api.put('/api/users/asha/snooze').send({ minutes: 60 }).expect(200);
  await api.post('/api/events').send(commentEvent(RAHUL)).expect(201);
  const end = await api.delete('/api/users/asha/snooze').expect(200);
  assert.equal(end.body.released, 1);
  assert.equal(end.body.unreadCount, 1);
  assert.equal((await inboxOf(api, 'asha')).items[0].body, "Rahul commented on your post: 'Great photo!'");
});

test('extending a snooze also holds what is already waiting until the new end', async (t) => {
  const { api, clock } = await setup(t);
  await api.put('/api/users/asha/snooze').send({ minutes: 10 }).expect(200);
  await api.post('/api/events').send(commentEvent(RAHUL)).expect(201);
  clock.advance(5);
  await api.put('/api/users/asha/snooze').send({ minutes: 60 }).expect(200);
  clock.advance(10); // past the original end
  assert.equal((await inboxOf(api, 'asha')).items.length, 0);
  clock.advance(60);
  assert.equal((await inboxOf(api, 'asha')).items.length, 1);
});

test('activity during a snooze is grouped among itself, never hiding what was already visible', async (t) => {
  const { api, clock } = await setup(t);
  await api.post('/api/events').send(likeEvent(MEERA)).expect(201); // visible before the snooze
  await api.put('/api/users/asha/snooze').send({ minutes: 30 }).expect(200);
  await api.post('/api/events').send(likeEvent(RAHUL)).expect(201);
  await api.post('/api/events').send(likeEvent({ id: 'dev', name: 'Dev' })).expect(201);

  let inbox = await inboxOf(api, 'asha');
  assert.deepEqual(inbox.items.map((n) => n.body), ["Meera liked your post: 'Sunset at the beach'"]);
  assert.equal(inbox.snooze.heldCount, 1, 'the two held likes are one notification');

  clock.advance(31);
  inbox = await inboxOf(api, 'asha');
  assert.deepEqual(inbox.items.map((n) => n.body), [
    "Dev and Rahul liked your post: 'Sunset at the beach'",
    "Meera liked your post: 'Sunset at the beach'",
  ]);
});

test('held notifications cannot be marked read, and mark-all leaves them alone', async (t) => {
  const { api, db } = await setup(t);
  await api.put('/api/users/asha/snooze').send({ minutes: 30 }).expect(200);
  await api.post('/api/events').send(commentEvent(RAHUL)).expect(201);
  const { id } = db.prepare('SELECT id FROM notifications').get();
  await api.post(`/api/users/asha/notifications/${id}/read`).expect(404);
  const all = await api.post('/api/users/asha/inbox/read-all').expect(200);
  assert.equal(all.body.markedRead, 0);
});

test('snooze input is validated', async (t) => {
  const { api } = await setup(t);
  for (const minutes of [0, -5, 1.5, 'ten', 20000]) {
    const res = await api.put('/api/users/asha/snooze').send({ minutes }).expect(400);
    assert.equal(res.body.error.code, 'invalid_snooze');
  }
  await api.put('/api/users/ghost/snooze').send({ minutes: 5 }).expect(404);
});

test('a snooze only affects the person snoozing', async (t) => {
  const { api } = await setup(t);
  await api.put('/api/users/asha/snooze').send({ minutes: 30 }).expect(200);
  const { body } = await api.post('/api/events').send(followEvent(ASHA, RAHUL)).expect(201);
  assert.equal(body.results[0].outcome, 'delivered');
});

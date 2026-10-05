// B3: similar notifications about the same thing combine, update, and become unread again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASHA, MEERA, POST, RAHUL, commentEvent, fakeClock, followEvent, likeEvent, makeRelay, person, postEvent,
} from './helpers.js';

const inboxOf = async (api, id) => (await api.get(`/api/users/${id}/inbox`).expect(200)).body;

test('five likes on the same post become one notification: "Rahul and 4 others liked your post"', async (t) => {
  const { api } = makeRelay();
  const clock = fakeClock(t);
  const likers = ['Kiran', 'Zoya', 'Dev', 'Meera', 'Rahul'].map(person);
  const results = [];
  for (const liker of likers) {
    results.push((await api.post('/api/events').send(likeEvent(liker)).expect(201)).body.results[0]);
    clock.advance(1);
  }

  const inbox = await inboxOf(api, 'asha');
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.unreadCount, 1);
  const [n] = inbox.items;
  assert.equal(n.body, "Rahul and 4 others liked your post: 'Sunset at the beach'");
  assert.deepEqual(n.actorIds, ['rahul', 'meera', 'dev', 'zoya', 'kiran']);
  assert.equal(n.activityCount, 5);

  assert.equal(results[0].reasonCode, 'delivered');
  assert.equal(results[1].reasonCode, 'grouped');
  assert.match(results[4].reason, /Combined into Asha's existing "New like" notification \(now 5 people\)/);
  assert.ok(results.every((r) => r.notificationId === n.id), 'every record points at the one notification');
});

test('two people read naturally: "Rahul and Meera"', async () => {
  const { api } = makeRelay();
  await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  await api.post('/api/events').send(likeEvent(RAHUL)).expect(201);
  assert.equal((await inboxOf(api, 'asha')).items[0].body, "Rahul and Meera liked your post: 'Sunset at the beach'");
});

test('a read group becomes unread again, and moves back to the top, when more activity arrives', async (t) => {
  const { api } = makeRelay();
  const clock = fakeClock(t);
  await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  clock.advance(1);
  await api.post('/api/events').send(followEvent(RAHUL, ASHA)).expect(201);

  let inbox = await inboxOf(api, 'asha');
  assert.deepEqual(inbox.items.map((n) => n.type), ['new_follower', 'new_like']);
  await api.post('/api/users/asha/inbox/read-all').expect(200);

  clock.advance(5);
  await api.post('/api/events').send(likeEvent(person('Dev'))).expect(201);
  inbox = await inboxOf(api, 'asha');
  assert.equal(inbox.unreadCount, 1);
  assert.equal(inbox.items[0].type, 'new_like');
  assert.equal(inbox.items[0].read, false);
  assert.equal(inbox.items[0].body, "Dev and Meera liked your post: 'Sunset at the beach'");
  assert.equal(inbox.items.length, 2);
});

test('activity after the grouping window starts a fresh notification', async (t) => {
  const { api } = makeRelay();
  const clock = fakeClock(t);
  await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  clock.advance(59);
  await api.post('/api/events').send(likeEvent(RAHUL)).expect(201); // within 60 min of the last like
  clock.advance(61);
  await api.post('/api/events').send(likeEvent(person('Dev'))).expect(201);

  const bodies = (await inboxOf(api, 'asha')).items.map((n) => n.body);
  assert.deepEqual(bodies, [
    "Dev liked your post: 'Sunset at the beach'",
    "Rahul and Meera liked your post: 'Sunset at the beach'",
  ]);
});

test('likes on different posts are not combined', async () => {
  const { api } = makeRelay();
  await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  await api.post('/api/events').send(likeEvent(RAHUL, { ...POST, id: 'p2', text: 'Another one' })).expect(201);
  assert.equal((await inboxOf(api, 'asha')).items.length, 2);
});

test('comments group too, showing the latest comment', async () => {
  const { api } = makeRelay();
  await api.post('/api/events').send(commentEvent(RAHUL, { text: 'Wow' })).expect(201);
  await api.post('/api/events').send(commentEvent(MEERA, { text: 'Stunning!' })).expect(201);
  await api.post('/api/events').send(commentEvent(RAHUL, { text: 'Again!' })).expect(201);
  const [n, ...rest] = (await inboxOf(api, 'asha')).items;
  assert.equal(rest.length, 0);
  assert.equal(n.body, "Rahul and Meera commented on your post: 'Again!'");
  assert.equal(n.activityCount, 3, 'three comments, two distinct people');
});

test('new followers group: "Rahul and 2 others started following you"', async () => {
  const { api } = makeRelay();
  for (const p of [person('Dev'), MEERA, RAHUL]) await api.post('/api/events').send(followEvent(p, ASHA)).expect(201);
  assert.equal((await inboxOf(api, 'asha')).items[0].body, 'Rahul and 2 others started following you');
});

test('mentions are never combined — each one is addressed to you personally', async () => {
  const { api } = makeRelay();
  await api.post('/api/events').send(postEvent(RAHUL, { text: '@Asha one', mentions: [ASHA] })).expect(201);
  await api.post('/api/events').send(postEvent(MEERA, { text: '@Asha two', mentions: [ASHA] })).expect(201);
  assert.equal((await inboxOf(api, 'asha')).items.length, 2);
});

test('the content owner can switch grouping off (0) or change the window', async () => {
  const { api } = makeRelay();
  const off = await api.put('/api/templates/new_like').send({ groupWindowMinutes: 0 }).expect(200);
  assert.equal(off.body.groupWindowMinutes, null);
  assert.equal(off.body.groupedPreview, null);
  await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  await api.post('/api/events').send(likeEvent(RAHUL)).expect(201);
  assert.equal((await inboxOf(api, 'asha')).items.length, 2);

  const on = await api.put('/api/templates/new_like').send({ groupWindowMinutes: 15 }).expect(200);
  assert.equal(on.body.groupedPreview, "Rahul and 4 others liked your post: 'Sunset at the beach'");
  await api.put('/api/templates/new_like').send({ groupWindowMinutes: 5000 }).expect(400);
  await api.put('/api/templates/new_like').send({ groupWindowMinutes: 'soon' }).expect(400);
});

// A4: each person's inbox — ordering, unread count, mark read, mark all read, privacy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASHA, DEV, MEERA, RAHUL, commentEvent, followEvent, likeEvent, makeRelay } from './helpers.js';

async function seedInbox(api) {
  await api.post('/api/events').send(commentEvent(RAHUL, { text: 'one' })).expect(201);
  await api.post('/api/events').send(likeEvent(MEERA)).expect(201);
  await api.post('/api/events').send(followEvent(DEV, ASHA)).expect(201);
  await api.post('/api/events').send(followEvent(ASHA, RAHUL)).expect(201); // for Rahul
}

test('inbox is newest first with unread ones marked and counted', async () => {
  const { api } = makeRelay();
  await seedInbox(api);
  const { body } = await api.get('/api/users/asha/inbox').expect(200);
  assert.deepEqual(body.items.map((n) => n.body), [
    'Dev started following you',
    "Meera liked your post: 'Sunset at the beach'",
    "Rahul commented on your post: 'one'",
  ]);
  assert.equal(body.unreadCount, 3);
  assert.ok(body.items.every((n) => n.read === false && n.readAt === null));
});

test('opening a notification marks it read and updates the count; repeating is harmless', async () => {
  const { api } = makeRelay();
  await seedInbox(api);
  const [first] = (await api.get('/api/users/asha/inbox')).body.items;

  const res = await api.post(`/api/users/asha/notifications/${first.id}/read`).expect(200);
  assert.equal(res.body.unreadCount, 2);
  assert.equal(res.body.notification.read, true);

  const again = await api.post(`/api/users/asha/notifications/${first.id}/read`).expect(200);
  assert.equal(again.body.unreadCount, 2);
  assert.equal(again.body.notification.readAt, res.body.notification.readAt, 'original read time is kept');
});

test('mark all as read clears only that person\'s unread count', async () => {
  const { api } = makeRelay();
  await seedInbox(api);
  const res = await api.post('/api/users/asha/inbox/read-all').expect(200);
  assert.equal(res.body.markedRead, 3);
  assert.equal(res.body.unreadCount, 0);
  assert.equal((await api.get('/api/users/rahul/inbox')).body.unreadCount, 1);
});

test('a person only ever sees their own inbox and cannot touch anyone else\'s', async () => {
  const { api } = makeRelay();
  await seedInbox(api);
  const rahul = (await api.get('/api/users/rahul/inbox')).body;
  assert.deepEqual(rahul.items.map((n) => n.body), ['Asha started following you']);

  const ashaItem = (await api.get('/api/users/asha/inbox')).body.items[0];
  const res = await api.post(`/api/users/rahul/notifications/${ashaItem.id}/read`).expect(404);
  assert.equal(res.body.error.code, 'notification_not_found');
  assert.equal((await api.get('/api/users/asha/inbox')).body.unreadCount, 3, "Asha's item is untouched");
});

test('someone with no notifications has an empty inbox', async () => {
  const { api } = makeRelay();
  const { body } = await api.get('/api/users/nobody/inbox').expect(200);
  assert.deepEqual(body, { userId: 'nobody', unreadCount: 0, items: [] });
});

test('unknown endpoints return a JSON 404', async () => {
  const { api } = makeRelay();
  const res = await api.get('/api/nope').expect(404);
  assert.equal(res.body.error.code, 'not_found');
});

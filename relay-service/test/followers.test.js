// B4: followers hear about new posts; following creates a notification; unfollowing is recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASHA, DEV, MEERA, RAHUL, followEvent, makeRelay, person, postEvent, unfollowEvent } from './helpers.js';

const byId = (results) => Object.fromEntries(results.map((r) => [r.recipient.id, r]));
const postWithFollowers = (actor, followers, extra = {}) => {
  const e = postEvent(actor, { text: 'Fresh bread today', ...extra });
  e.data.followers = followers;
  return e;
};

test('each follower is told about a new post', async () => {
  const { api } = makeRelay();
  const { body } = await api.post('/api/events').send(postWithFollowers(ASHA, [RAHUL, MEERA])).expect(201);
  const r = byId(body.results);
  assert.equal(r.rahul.type, 'new_post');
  assert.equal(r.rahul.body, "Asha shared a new post: 'Fresh bread today'");
  assert.equal(r.meera.outcome, 'delivered');
});

test('a follower who is also mentioned gets one notification, as a mention', async () => {
  const { api } = makeRelay();
  const { body } = await api.post('/api/events')
    .send(postWithFollowers(ASHA, [RAHUL, MEERA], { text: 'Bread for @Rahul', mentions: [RAHUL] })).expect(201);
  const r = byId(body.results);
  assert.equal(body.results.length, 2);
  assert.equal(r.rahul.type, 'mention');
  assert.match(r.rahul.reason, /also qualified for "New post"/);
  assert.equal(r.meera.type, 'new_post');
});

test('followers who switched off "New post" are skipped with the reason', async () => {
  const { api } = makeRelay();
  await api.put('/api/users/meera').send({ name: 'Meera' });
  await api.put('/api/users/meera/preferences').send({ new_post: false }).expect(200);
  const { body } = await api.post('/api/events').send(postWithFollowers(ASHA, [MEERA])).expect(201);
  assert.equal(body.results[0].reason, 'Meera has turned off "New post" notifications.');
});

test('a post with no followers and no mentions notifies nobody', async () => {
  const { api } = makeRelay();
  const { body } = await api.post('/api/events').send(postWithFollowers(ASHA, [])).expect(201);
  assert.equal(body.summary, 'Nobody needed to hear about this.');
});

test('unfollowing is accepted and recorded, and notifies nobody', async () => {
  const { api } = makeRelay();
  await api.post('/api/events').send(followEvent(DEV, ASHA)).expect(201);
  const { body } = await api.post('/api/events').send(unfollowEvent(DEV, ASHA)).expect(201);
  assert.equal(body.description, 'Dev unfollowed Asha');
  assert.deepEqual(body.results, []);
  assert.equal((await api.get('/api/users/asha/inbox')).body.items.length, 1, 'only the original follow');
});

test('fan-out to many followers: 5,000 followers are each notified in one event', async () => {
  const { api, db } = makeRelay();
  const followers = Array.from({ length: 5000 }, (_, i) => person(`Fan${i}`));
  const started = Date.now();
  const { body } = await api.post('/api/events').send(postWithFollowers(ASHA, followers)).expect(201);
  const ms = Date.now() - started;
  assert.equal(body.summary, 'Notified 5000, skipped 0.');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'new_post'").get().n, 5000);
  assert.ok(ms < 15_000, `took ${ms}ms`);
  console.log(`    (5,000-follower fan-out took ${ms}ms)`);
});

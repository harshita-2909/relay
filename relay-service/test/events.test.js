// A2: turning activity into notifications — recipients, wording, rejection of unknown activity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASHA, DEV, MEERA, RAHUL, commentEvent, followEvent, likeEvent, makeRelay, postEvent,
} from './helpers.js';

const byId = (results) => Object.fromEntries(results.map((r) => [r.recipient.id, r]));

test('people are never notified about their own actions', async () => {
  const { api, db } = makeRelay();
  const { body } = await api.post('/api/events').send(commentEvent(ASHA)).expect(201);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].outcome, 'skipped');
  assert.equal(body.results[0].reasonCode, 'self_action');
  assert.match(body.results[0].reason, /Asha did this themselves/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 0);
});

test('liking your own post notifies nobody', async () => {
  const { api } = makeRelay();
  const { body } = await api.post('/api/events').send(likeEvent(ASHA)).expect(201);
  assert.equal(body.results[0].reasonCode, 'self_action');
});

test('a post notifies each mentioned person, but not the author', async () => {
  const { api } = makeRelay();
  const { body } = await api.post('/api/events')
    .send(postEvent(RAHUL, { text: 'Lunch with @Asha and @Meera @Rahul', mentions: [ASHA, MEERA, RAHUL, ASHA] }))
    .expect(201);
  const r = byId(body.results);
  assert.deepEqual(Object.keys(r).sort(), ['asha', 'meera', 'rahul'], 'duplicate mentions collapse');
  assert.equal(r.asha.outcome, 'delivered');
  assert.equal(r.asha.body, "Rahul mentioned you in a post: 'Lunch with @Asha and @Meera @Rahul'");
  assert.equal(r.meera.outcome, 'delivered');
  assert.equal(r.rahul.reasonCode, 'self_action');
});

test('a post with no mentions is processed and notifies nobody', async () => {
  const { api } = makeRelay();
  const { body } = await api.post('/api/events').send(postEvent(RAHUL)).expect(201);
  assert.equal(body.status, 'processed');
  assert.deepEqual(body.results, []);
  assert.equal(body.summary, 'Nobody needed to hear about this.');
});

test('a comment notifies the post author and anyone mentioned', async () => {
  const { api } = makeRelay();
  const { body } = await api.post('/api/events')
    .send(commentEvent(RAHUL, { text: '@Dev you have to see this', mentions: [DEV] })).expect(201);
  const r = byId(body.results);
  assert.equal(r.asha.type, 'new_comment');
  assert.equal(r.asha.body, "Rahul commented on your post: '@Dev you have to see this'");
  assert.equal(r.dev.type, 'mention');
  assert.equal(r.dev.body, "Rahul mentioned you in a comment: '@Dev you have to see this'");
});

test('a mentioned post author gets ONE notification, as a mention', async () => {
  const { api, db } = makeRelay();
  const { body } = await api.post('/api/events')
    .send(commentEvent(RAHUL, { text: '@Asha nice!', mentions: [ASHA] })).expect(201);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].type, 'mention');
  assert.match(body.results[0].reason, /also qualified for "New comment".*only one notification/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = 'asha'").get().n, 1);
});

test('if mentions are off, a mentioned post author still gets the comment notification', async () => {
  const { api } = makeRelay();
  await api.put('/api/users/asha').send({ name: 'Asha' });
  await api.put('/api/users/asha/preferences').send({ mention: false }).expect(200);
  const { body } = await api.post('/api/events')
    .send(commentEvent(RAHUL, { text: '@Asha nice!', mentions: [ASHA] })).expect(201);
  assert.equal(body.results[0].outcome, 'delivered');
  assert.equal(body.results[0].type, 'new_comment');
  assert.match(body.results[0].reason, /turned off "Mention"/);
});

test('if both are off, the record names both', async () => {
  const { api } = makeRelay();
  await api.put('/api/users/asha').send({ name: 'Asha' });
  await api.put('/api/users/asha/preferences').send({ mention: false, new_comment: false }).expect(200);
  const { body } = await api.post('/api/events')
    .send(commentEvent(RAHUL, { text: '@Asha nice!', mentions: [ASHA] })).expect(201);
  assert.equal(body.results[0].outcome, 'skipped');
  assert.equal(body.results[0].reason, 'Asha has turned off "Mention" and "New comment" notifications.');
});

test('a follow notifies the person followed', async () => {
  const { api } = makeRelay();
  const { body } = await api.post('/api/events').send(followEvent(MEERA, DEV)).expect(201);
  assert.equal(body.description, 'Meera followed Dev');
  assert.equal(body.results[0].body, 'Meera started following you');
});

test('numeric ids from the app are accepted and treated as strings', async () => {
  const { api } = makeRelay();
  const { body } = await api.post('/api/events')
    .send(likeEvent({ id: 7, name: 'Rahul' }, { id: 1, author: { id: 3, name: 'Asha' }, text: 'x' })).expect(201);
  assert.equal(body.results[0].recipient.id, '3');
  const inbox = await api.get('/api/users/3/inbox').expect(200);
  assert.equal(inbox.body.unreadCount, 1);
});

test('unknown activity is rejected with a clear explanation, and recorded', async () => {
  const { api } = makeRelay();
  const res = await api.post('/api/events').send({ type: 'post.shared', actor: RAHUL, data: {} }).expect(422);
  assert.equal(res.body.status, 'rejected');
  assert.equal(res.body.error.code, 'unknown_event_type');
  assert.match(res.body.error.message, /doesn't recognise the event type "post.shared"/);
  assert.match(res.body.error.message, /comment\.created, post\.created, post\.liked, user\.followed/);

  const { body } = await api.get('/api/events?status=rejected').expect(200);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].id, res.body.eventId);
  assert.equal(body.events[0].error.code, 'unknown_event_type');
});

test('events missing required information are rejected, listing every problem', async () => {
  const { api } = makeRelay();
  const res = await api.post('/api/events')
    .send({ type: 'comment.created', actor: { id: 'rahul' }, data: { post: { id: 'p1' } } }).expect(422);
  assert.equal(res.body.error.code, 'invalid_event');
  const details = res.body.error.details.join('\n');
  assert.match(details, /"actor" must be a person/);
  assert.match(details, /"data.post.author" is required/);
  assert.match(details, /"data.comment.text" is required/);
});

test('events without a type, or that are not objects, are rejected', async () => {
  const { api } = makeRelay();
  const noType = await api.post('/api/events').send({ actor: RAHUL }).expect(422);
  assert.match(noType.body.error.message, /needs a "type"/);
  const notObject = await api.post('/api/events').send([1, 2]).expect(422);
  assert.equal(notObject.body.error.code, 'invalid_event');
});

test('malformed JSON gets a 400 with a JSON error body', async () => {
  const { api } = makeRelay();
  const res = await api.post('/api/events').set('Content-Type', 'application/json').send('{"type":').expect(400);
  assert.equal(res.body.error.code, 'invalid_json');
});

test('a failure mid-event rolls back everything for that event', async (t) => {
  t.mock.method(console, 'error', () => {}); // the 500 is expected; keep test output clean
  const { api, db } = makeRelay();
  // Break delivery for one type to force an error inside the transaction.
  db.exec("CREATE TRIGGER boom BEFORE INSERT ON notifications WHEN NEW.type = 'new_comment' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  const before = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  const res = await api.post('/api/events').send(commentEvent(RAHUL, { mentions: [DEV] }));
  assert.equal(res.status, 500);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 0, "Dev's mention was rolled back too");
});

test('event types are discoverable', async () => {
  const { api } = makeRelay();
  const { body } = await api.get('/api/event-types').expect(200);
  const comment = body.eventTypes.find((t) => t.type === 'comment.created');
  assert.deepEqual(comment.notificationTypes, ['mention', 'new_comment']);
});

test('records can be filtered to one recipient ("why didn\'t Asha get notified?")', async () => {
  const { api } = makeRelay();
  await api.post('/api/events').send(likeEvent(RAHUL)).expect(201);
  await api.post('/api/events').send(followEvent(MEERA, DEV)).expect(201);
  const { body } = await api.get('/api/events?recipientId=asha').expect(200);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].description, "Rahul liked Asha's post");
  assert.equal(body.events[0].results[0].recipient.name, 'Asha');
});

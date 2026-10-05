// A2: the content owner changes wording without any change to the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAHUL, commentEvent, makeRelay } from './helpers.js';

test('every notification type has default wording with a preview', async () => {
  const { api } = makeRelay();
  const { body } = await api.get('/api/templates').expect(200);
  assert.deepEqual(body.templates.map((t) => t.type).sort(), ['mention', 'new_comment', 'new_follower', 'new_like']);
  const comment = body.templates.find((t) => t.type === 'new_comment');
  assert.equal(comment.template, "{actor} commented on your post: '{comment}'");
  assert.equal(comment.preview, "Rahul commented on your post: 'Great photo!'");
});

test('edited wording is used for new notifications; old ones keep their words', async () => {
  const { api } = makeRelay();
  await api.post('/api/events').send(commentEvent(RAHUL, { text: 'first' })).expect(201);

  const put = await api.put('/api/templates/new_comment')
    .send({ template: '💬 {actor} replied on "{post}": {comment}' }).expect(200);
  assert.equal(put.body.preview, '💬 Rahul replied on "Sunset at the beach": Great photo!');

  const { body } = await api.post('/api/events').send(commentEvent(RAHUL, { text: 'second' })).expect(201);
  assert.equal(body.results[0].body, '💬 Rahul replied on "Sunset at the beach": second');

  const inbox = (await api.get('/api/users/asha/inbox')).body.items.map((n) => n.body);
  assert.deepEqual(inbox, [
    '💬 Rahul replied on "Sunset at the beach": second',
    "Rahul commented on your post: 'first'",
  ]);
});

test('wording that uses a blank the type cannot fill is rejected', async () => {
  const { api } = makeRelay();
  const res = await api.put('/api/templates/new_follower').send({ template: '{actor} followed you: {comment}' }).expect(400);
  assert.equal(res.body.error.code, 'unknown_placeholder');
  assert.match(res.body.error.message, /can't use \{comment\}/);
  assert.match(res.body.error.message, /Available blanks: \{actor\}, \{recipient\}/);
  const still = await api.get('/api/templates/new_follower').expect(200);
  assert.equal(still.body.template, '{actor} started following you');
});

test('empty or oversized wording is rejected', async () => {
  const { api } = makeRelay();
  await api.put('/api/templates/new_like').send({ template: '   ' }).expect(400);
  await api.put('/api/templates/new_like').send({}).expect(400);
  await api.put('/api/templates/new_like').send({ template: 'x'.repeat(281) }).expect(400);
});

test('unknown notification types give a 404 that lists the real ones', async () => {
  const { api } = makeRelay();
  const res = await api.get('/api/templates/new_share').expect(404);
  assert.match(res.body.error.message, /Known types: .*new_comment/);
  await api.put('/api/templates/new_share').send({ template: 'x' }).expect(404);
});

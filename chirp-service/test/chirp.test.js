// Chirp actions are saved and reported to Relay as facts — and nothing more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db/db.js';

function makeChirp() {
  const db = openDb(':memory:');
  const reported = [];
  const relay = {
    baseUrl: 'fake',
    async report(event) { reported.push(event); return { reported: true, eventId: reported.length, summary: 'ok' }; },
  };
  return { db, api: request(createApp(db, relay)), reported };
}
const firstPostId = async (api) => (await api.get('/api/posts')).body.posts.at(-1).id;

test('seeded people and a starter post by Asha exist', async () => {
  const { api } = makeChirp();
  const users = (await api.get('/api/users').expect(200)).body.users.map((u) => u.name);
  assert.deepEqual(users, ['Asha', 'Dev', 'Meera', 'Rahul']);
  const { posts } = (await api.get('/api/posts').expect(200)).body;
  assert.equal(posts.length, 1);
  assert.equal(posts[0].authorId, 'asha');
});

test('writing a post reports post.created with resolved @mentions', async () => {
  const { api, reported } = makeChirp();
  const res = await api.post('/api/posts')
    .send({ actorId: 'rahul', text: 'Lunch with @meera and @Dev and @nobody @MEERA' }).expect(201);
  assert.equal(res.body.relay.reported, true);
  assert.equal(reported.length, 1);
  const [event] = reported;
  assert.equal(event.type, 'post.created');
  assert.deepEqual(event.actor, { id: 'rahul', name: 'Rahul' });
  assert.equal(event.data.post.id, res.body.post.id);
  assert.deepEqual(event.data.mentions, [{ id: 'meera', name: 'Meera' }, { id: 'dev', name: 'Dev' }]);
  assert.ok(!('recipients' in event) && !('body' in event), 'Chirp never decides recipients or wording');
});

test('commenting reports comment.created with the post author and mentions', async () => {
  const { api, reported } = makeChirp();
  const postId = await firstPostId(api);
  await api.post(`/api/posts/${postId}/comments`).send({ actorId: 'rahul', text: 'Great photo! @asha' }).expect(201);
  const [event] = reported;
  assert.equal(event.type, 'comment.created');
  assert.deepEqual(event.data.post.author, { id: 'asha', name: 'Asha' });
  assert.equal(event.data.comment.text, 'Great photo! @asha');
  assert.deepEqual(event.data.mentions, [{ id: 'asha', name: 'Asha' }]);

  const { posts } = (await api.get('/api/posts')).body;
  assert.equal(posts[0].comments[0].text, 'Great photo! @asha');
});

test('liking reports post.liked once; liking again changes nothing and reports nothing', async () => {
  const { api, reported } = makeChirp();
  const postId = await firstPostId(api);
  const first = await api.post(`/api/posts/${postId}/likes`).send({ actorId: 'meera' }).expect(201);
  assert.equal(first.body.alreadyLiked, false);
  const again = await api.post(`/api/posts/${postId}/likes`).send({ actorId: 'meera' }).expect(200);
  assert.equal(again.body.alreadyLiked, true);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].type, 'post.liked');
  assert.deepEqual((await api.get('/api/posts')).body.posts[0].likedBy, ['meera']);
});

test('following reports user.followed once; following yourself is refused', async () => {
  const { api, reported } = makeChirp();
  await api.post('/api/users/asha/followers').send({ actorId: 'dev' }).expect(201);
  await api.post('/api/users/asha/followers').send({ actorId: 'dev' }).expect(200);
  await api.post('/api/users/dev/followers').send({ actorId: 'dev' }).expect(400);
  assert.deepEqual(reported.map((e) => e.type), ['user.followed']);
  assert.deepEqual(reported[0].data.followee, { id: 'asha', name: 'Asha' });
  const dev = (await api.get('/api/users')).body.users.find((u) => u.id === 'dev');
  assert.deepEqual(dev.following, ['asha']);
});

test('bad requests are refused clearly and report nothing', async () => {
  const { api, reported } = makeChirp();
  assert.equal((await api.post('/api/posts').send({ text: 'hi' }).expect(400)).body.error.code, 'unknown_actor');
  assert.equal((await api.post('/api/posts').send({ actorId: 'asha', text: '  ' }).expect(400)).body.error.code, 'invalid_text');
  await api.post('/api/posts').send({ actorId: 'asha', text: 'x'.repeat(501) }).expect(400);
  await api.post('/api/posts/999/comments').send({ actorId: 'asha', text: 'hi' }).expect(404);
  await api.post('/api/posts/999/likes').send({ actorId: 'asha' }).expect(404);
  assert.equal(reported.length, 0);
});

test("a post lists the author's current followers for Relay", async () => {
  const { api, reported } = makeChirp();
  await api.post('/api/users/asha/followers').send({ actorId: 'rahul' }).expect(201);
  await api.post('/api/users/asha/followers').send({ actorId: 'meera' }).expect(201);
  await api.delete('/api/users/asha/followers/meera').expect(200);
  await api.post('/api/posts').send({ actorId: 'asha', text: 'New photos up!' }).expect(201);

  const post = reported.find((e) => e.type === 'post.created');
  assert.deepEqual(post.data.followers, [{ id: 'rahul', name: 'Rahul' }]);
});

test('unfollowing reports user.unfollowed once; unfollowing when not following reports nothing', async () => {
  const { api, reported } = makeChirp();
  await api.post('/api/users/asha/followers').send({ actorId: 'dev' }).expect(201);
  const res = await api.delete('/api/users/asha/followers/dev').expect(200);
  assert.equal(res.body.wasFollowing, true);
  const again = await api.delete('/api/users/asha/followers/dev').expect(200);
  assert.equal(again.body.wasFollowing, false);

  assert.deepEqual(reported.map((e) => e.type), ['user.followed', 'user.unfollowed']);
  assert.deepEqual(reported[1].data.followee, { id: 'asha', name: 'Asha' });
  const dev = (await api.get('/api/users')).body.users.find((u) => u.id === 'dev');
  assert.deepEqual(dev.following, []);
  await api.delete('/api/users/asha/followers/ghost').expect(400);
});

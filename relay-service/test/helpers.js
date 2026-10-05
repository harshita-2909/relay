import request from 'supertest';
import { createApp } from '../src/app.js';
import { clock, openDb } from '../src/db/db.js';

export const ASHA = { id: 'asha', name: 'Asha' };
export const RAHUL = { id: 'rahul', name: 'Rahul' };
export const MEERA = { id: 'meera', name: 'Meera' };
export const DEV = { id: 'dev', name: 'Dev' };

export const POST = { id: 'p1', author: ASHA, text: 'Sunset at the beach' };

/** A fresh in-memory Relay for each test. */
export function makeRelay() {
  const db = openDb(':memory:');
  const api = request(createApp(db));
  return { db, api };
}

export const commentEvent = (actor, { post = POST, text = 'Great photo!', mentions } = {}) => ({
  type: 'comment.created',
  actor,
  data: { post, comment: { id: `c-${Math.random()}`, text }, ...(mentions ? { mentions } : {}) },
});

export const likeEvent = (actor, post = POST) => ({ type: 'post.liked', actor, data: { post } });

export const postEvent = (actor, { text = 'Hello world', mentions } = {}) => ({
  type: 'post.created',
  actor,
  data: { post: { id: `p-${Math.random()}`, text }, ...(mentions ? { mentions } : {}) },
});

export const followEvent = (actor, followee) => ({ type: 'user.followed', actor, data: { followee } });

export const person = (name) => ({ id: name.toLowerCase(), name });

export const unfollowEvent = (actor, followee) => ({ type: 'user.unfollowed', actor, data: { followee } });

/** Take control of Relay's clock for one test. */
export function fakeClock(t, start = '2026-10-05T10:00:00.000Z') {
  let now = new Date(start);
  t.mock.method(clock, 'now', () => new Date(now));
  return {
    advance(minutes) { now = new Date(now.getTime() + minutes * 60_000); },
    get iso() { return now.toISOString(); },
  };
}

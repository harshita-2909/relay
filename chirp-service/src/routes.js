import { Router } from 'express';
import { commentCreated, postCreated, postLiked, userFollowed } from './activity.js';
import { nowIso } from './db/db.js';

const MAX_TEXT = 500;

const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });

export function chirpRouter(db, relay) {
  const router = Router();

  const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(String(id ?? '')) ?? null;
  const getPost = (id) => {
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(id));
    return row ? { id: row.id, authorId: row.author_id, text: row.text, createdAt: row.created_at } : null;
  };

  /** "@meera" / "@Meera" → Meera. Unknown names are just text. Each person once. */
  const findMentions = (text) => {
    const found = new Map();
    for (const [, handle] of text.matchAll(/@([A-Za-z0-9_]+)/g)) {
      const u = db.prepare('SELECT * FROM users WHERE lower(id) = lower(?) OR lower(name) = lower(?)').get(handle, handle);
      if (u) found.set(u.id, u);
    }
    return [...found.values()];
  };

  // Every write says who is acting. There are no logins: whoever uses Chirp picks a person.
  const requireActor = (req, res) => {
    const actor = getUser(req.body?.actorId);
    if (!actor) {
      sendError(res, 400, 'unknown_actor', 'Send "actorId" with the id of the person you are acting as.');
      return null;
    }
    return actor;
  };
  const requireText = (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) { sendError(res, 400, 'invalid_text', 'Write something first.'); return null; }
    if (text.length > MAX_TEXT) { sendError(res, 400, 'invalid_text', `Keep it under ${MAX_TEXT} characters.`); return null; }
    return text;
  };

  // ---- reads ---------------------------------------------------------------------------

  router.get('/users', (_req, res) => {
    const users = db.prepare('SELECT * FROM users ORDER BY name').all();
    const follows = db.prepare('SELECT follower_id, followee_id FROM follows').all();
    res.json({
      users: users.map((u) => ({
        ...u,
        following: follows.filter((f) => f.follower_id === u.id).map((f) => f.followee_id),
        followerCount: follows.filter((f) => f.followee_id === u.id).length,
      })),
    });
  });

  router.get('/posts', (_req, res) => {
    const posts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC, id DESC LIMIT 100').all();
    const comments = db.prepare('SELECT * FROM comments ORDER BY id').all();
    const likes = db.prepare('SELECT * FROM likes ORDER BY created_at').all();
    res.json({
      posts: posts.map((p) => ({
        id: p.id,
        authorId: p.author_id,
        text: p.text,
        createdAt: p.created_at,
        likedBy: likes.filter((l) => l.post_id === p.id).map((l) => l.user_id),
        comments: comments.filter((c) => c.post_id === p.id)
          .map((c) => ({ id: c.id, authorId: c.author_id, text: c.text, createdAt: c.created_at })),
      })),
    });
  });

  // ---- actions: save in Chirp first, then tell Relay what happened -----------------------

  router.post('/posts', async (req, res) => {
    const actor = requireActor(req, res); if (!actor) return;
    const text = requireText(req, res); if (!text) return;

    const createdAt = nowIso();
    const id = Number(db.prepare('INSERT INTO posts (author_id, text, created_at) VALUES (?, ?, ?)')
      .run(actor.id, text, createdAt).lastInsertRowid);
    const post = getPost(id);

    const relayResult = await relay.report(postCreated(actor, post, findMentions(text)));
    res.status(201).json({ post, relay: relayResult });
  });

  router.post('/posts/:postId/comments', async (req, res) => {
    const actor = requireActor(req, res); if (!actor) return;
    const post = getPost(req.params.postId);
    if (!post) return sendError(res, 404, 'post_not_found', 'That post does not exist.');
    const text = requireText(req, res); if (!text) return;

    const createdAt = nowIso();
    const id = Number(db.prepare('INSERT INTO comments (post_id, author_id, text, created_at) VALUES (?, ?, ?, ?)')
      .run(post.id, actor.id, text, createdAt).lastInsertRowid);
    const comment = { id, postId: post.id, authorId: actor.id, text, createdAt };

    const relayResult = await relay.report(
      commentCreated(actor, post, getUser(post.authorId), comment, findMentions(text)),
    );
    return res.status(201).json({ comment, relay: relayResult });
  });

  router.post('/posts/:postId/likes', async (req, res) => {
    const actor = requireActor(req, res); if (!actor) return;
    const post = getPost(req.params.postId);
    if (!post) return sendError(res, 404, 'post_not_found', 'That post does not exist.');

    const likedAt = nowIso();
    const { changes } = db.prepare('INSERT OR IGNORE INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(post.id, actor.id, likedAt);
    // Liking twice is a no-op, and nothing new happened, so there is nothing to report.
    if (changes === 0) return res.json({ liked: true, alreadyLiked: true, relay: null });

    const relayResult = await relay.report(postLiked(actor, post, getUser(post.authorId), likedAt));
    return res.status(201).json({ liked: true, alreadyLiked: false, relay: relayResult });
  });

  router.post('/users/:userId/followers', async (req, res) => {
    const actor = requireActor(req, res); if (!actor) return;
    const followee = getUser(req.params.userId);
    if (!followee) return sendError(res, 404, 'user_not_found', 'That person does not exist.');
    if (followee.id === actor.id) return sendError(res, 400, 'cannot_follow_self', "You can't follow yourself.");

    const followedAt = nowIso();
    const { changes } = db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)')
      .run(actor.id, followee.id, followedAt);
    if (changes === 0) return res.json({ following: true, alreadyFollowing: true, relay: null });

    const relayResult = await relay.report(userFollowed(actor, followee, followedAt));
    return res.status(201).json({ following: true, alreadyFollowing: false, relay: relayResult });
  });

  return router;
}

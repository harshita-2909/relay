import { useCallback, useEffect, useRef, useState } from 'react';
import { chirp } from '../api.js';
import { Avatar, MentionText, timeAgo } from '../util.jsx';

// The Chirp app itself. Everything here talks only to Chirp; Chirp reports to Relay.
export default function Feed({ me, users, onOutcome, onError }) {
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));

  const load = useCallback(async () => {
    try {
      setPosts((await chirp.posts()).posts);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Run a Chirp action, then refresh the feed and show what Relay did. */
  const act = async (verb, fn) => {
    try {
      const res = await fn();
      await load();
      onOutcome(verb, res.relay);
      return true;
    } catch (err) {
      onError(err.message);
      return false;
    }
  };

  return (
    <div className="feed">
      <Composer me={me} users={users} onPost={(text) => act('Posted', () => chirp.createPost(me.id, text))} />
      {error && <div className="notice error">{error}</div>}
      {posts === null && !error && <p className="muted">Loading posts…</p>}
      {posts?.length === 0 && <p className="muted">No posts yet. Write the first one!</p>}
      {posts?.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          me={me}
          byId={byId}
          onLike={() => act('Liked', () => chirp.like(post.id, me.id))}
          onComment={(text) => act('Commented', () => chirp.comment(post.id, me.id, text))}
          onFollow={(userId) => act(`Followed ${byId[userId]?.name}`, () => chirp.follow(userId, me.id))}
        />
      ))}
    </div>
  );
}

function Composer({ me, users, onPost }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    if (await onPost(text)) setText('');
    setBusy(false);
  };
  const insertMention = (name) => {
    setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${name} `);
    ref.current?.focus();
  };

  return (
    <form className="card composer" onSubmit={submit}>
      <div className="row">
        <Avatar user={me} />
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`What's happening, ${me.name}? Mention someone with @name`}
          rows={2}
          maxLength={500}
        />
      </div>
      <div className="row spread">
        <div className="mention-chips">
          <span className="muted small">Mention:</span>
          {users.filter((u) => u.id !== me.id).map((u) => (
            <button type="button" key={u.id} className="chip" onClick={() => insertMention(u.name)}>@{u.name}</button>
          ))}
        </div>
        <button className="btn primary" disabled={busy || !text.trim()}>Post as {me.name}</button>
      </div>
    </form>
  );
}

function PostCard({ post, me, byId, onLike, onComment, onFollow }) {
  const author = byId[post.authorId];
  const liked = post.likedBy.includes(me.id);
  const isMine = post.authorId === me.id;
  const following = me.following?.includes(post.authorId);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const submitComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    if (await onComment(comment)) setComment('');
    setBusy(false);
  };

  return (
    <article className="card post">
      <header className="row">
        <Avatar user={author} />
        <div className="grow">
          <strong>{author?.name ?? post.authorId}</strong>
          <span className="muted small"> · {timeAgo(post.createdAt)}</span>
        </div>
        {!isMine && (
          following
            ? <span className="muted small">Following</span>
            : <button className="btn small" onClick={() => onFollow(post.authorId)}>Follow</button>
        )}
      </header>

      <p className="post-text"><MentionText text={post.text} /></p>

      <div className="post-actions">
        <button
          className={`like ${liked ? 'liked' : ''}`}
          onClick={onLike}
          disabled={liked}
          title={liked ? `You liked this as ${me.name}` : `Like as ${me.name}`}
        >
          {liked ? '♥' : '♡'} {post.likedBy.length || ''}
        </button>
        {post.likedBy.length > 0 && (
          <span className="muted small">Liked by {post.likedBy.map((id) => byId[id]?.name ?? id).join(', ')}</span>
        )}
      </div>

      {post.comments.length > 0 && (
        <ul className="comments">
          {post.comments.map((c) => (
            <li key={c.id} className="row">
              <Avatar user={byId[c.authorId]} size={24} />
              <div>
                <strong>{byId[c.authorId]?.name ?? c.authorId}</strong>{' '}
                <MentionText text={c.text} />
                <span className="muted small"> · {timeAgo(c.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="row comment-form" onSubmit={submitComment}>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={`Comment as ${me.name}…`}
          maxLength={500}
        />
        <button className="btn" disabled={busy || !comment.trim()}>Comment</button>
      </form>
    </article>
  );
}

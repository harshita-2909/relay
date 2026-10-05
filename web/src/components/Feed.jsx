import { useCallback, useEffect, useRef, useState } from 'react';
import { chirp, relay } from '../api.js';
import { Avatar, MentionText, postSubject, timeAgo } from '../util.jsx';

// The Chirp app itself. Posting, commenting, liking and following talk only to Chirp, which
// reports to Relay. Muting a post is a notification setting, so that one is stored in Relay.
export default function Feed({ me, users, onOutcome, onError, onUsersChanged }) {
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const [mutes, setMutes] = useState(null); // Set of subjects, or null if Relay is unavailable
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

  useEffect(() => {
    relay.mutes(me.id)
      .then((data) => setMutes(new Set(data.mutes.map((m) => m.subject))))
      .catch(() => setMutes(null));
  }, [me.id]);

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

  const toggleMute = async (postId) => {
    const subject = postSubject(postId);
    try {
      const data = mutes.has(subject) ? await relay.unmute(me.id, subject) : await relay.mute(me.id, subject);
      setMutes(new Set(data.mutes.map((m) => m.subject)));
    } catch (err) {
      onError(err.message);
    }
  };

  const follow = (userId) => act(`Followed ${byId[userId]?.name}`, () => chirp.follow(userId, me.id))
    .then((ok) => { onUsersChanged(); return ok; });
  const unfollow = (userId) => act(`Unfollowed ${byId[userId]?.name}`, () => chirp.unfollow(userId, me.id))
    .then((ok) => { onUsersChanged(); return ok; });

  return (
    <div className="feed">
      <People me={me} users={users} onFollow={follow} onUnfollow={unfollow} />
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
          muted={mutes ? mutes.has(postSubject(post.id)) : null}
          onLike={() => act('Liked', () => chirp.like(post.id, me.id))}
          onComment={(text) => act('Commented', () => chirp.comment(post.id, me.id, text))}
          onFollow={follow}
          onUnfollow={unfollow}
          onToggleMute={() => toggleMute(post.id)}
        />
      ))}
    </div>
  );
}

function FollowButton({ following, onFollow, onUnfollow, name }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); await fn(); setBusy(false); };
  return following
    ? (
      <button className="btn small following" disabled={busy} onClick={() => run(onUnfollow)} title={`Stop following ${name}`}>
        <span className="when-idle">Following</span><span className="when-hover">Unfollow</span>
      </button>
    )
    : <button className="btn small" disabled={busy} onClick={() => run(onFollow)}>Follow</button>;
}

function People({ me, users, onFollow, onUnfollow }) {
  const others = users.filter((u) => u.id !== me.id);
  return (
    <section className="card people" aria-label="People">
      <div className="row spread">
        <strong className="small">People</strong>
        <span className="muted small">
          {me.name} follows {me.following.length} · {me.followerCount} follower{me.followerCount === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="people-list">
        {others.map((u) => (
          <li key={u.id} className="row">
            <Avatar user={u} size={28} />
            <div className="grow">
              <strong>{u.name}</strong>
              <div className="muted small">{u.followerCount} follower{u.followerCount === 1 ? '' : 's'}</div>
            </div>
            <FollowButton
              name={u.name}
              following={me.following.includes(u.id)}
              onFollow={() => onFollow(u.id)}
              onUnfollow={() => onUnfollow(u.id)}
            />
          </li>
        ))}
      </ul>
    </section>
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

function PostCard({ post, me, byId, muted, onLike, onComment, onFollow, onUnfollow, onToggleMute }) {
  const author = byId[post.authorId];
  const liked = post.likedBy.includes(me.id);
  const isMine = post.authorId === me.id;
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
    <article className={`card post ${muted ? 'is-muted' : ''}`}>
      <header className="row">
        <Avatar user={author} />
        <div className="grow">
          <strong>{author?.name ?? post.authorId}</strong>
          <span className="muted small"> · {timeAgo(post.createdAt)}</span>
        </div>
        {muted !== null && (
          <button
            className={`icon-btn ${muted ? 'active' : ''}`}
            onClick={onToggleMute}
            aria-pressed={muted}
            title={muted
              ? `Muted for ${me.name}: no likes or comments about this post (mentions still come through). Click to unmute.`
              : `Mute notifications about this post for ${me.name}`}
          >
            {muted ? '🔕 Muted' : '🔔 Mute'}
          </button>
        )}
        {!isMine && (
          <FollowButton
            name={author?.name}
            following={me.following.includes(post.authorId)}
            onFollow={() => onFollow(post.authorId)}
            onUnfollow={() => onUnfollow(post.authorId)}
          />
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

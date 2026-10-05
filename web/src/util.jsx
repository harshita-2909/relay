import { Fragment } from 'react';

export function timeAgo(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function Avatar({ user, size = 36 }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: user?.color ?? '#94a3b8', fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {user?.name?.[0] ?? '?'}
    </span>
  );
}

/** Text with @mentions highlighted. */
export function MentionText({ text }) {
  return text.split(/(@[A-Za-z0-9_]+)/g).map((part, i) => (
    part.startsWith('@') ? <span key={i} className="mention">{part}</span> : <Fragment key={i}>{part}</Fragment>
  ));
}

// Mirrors Relay's labels; used only for icons and short tags in the UI.
export const TYPE_ICONS = { new_comment: '💬', new_like: '♥', mention: '@', new_follower: '＋', new_post: '📝' };

/** The Relay subject for a Chirp post — what mutes and grouping are keyed on. */
export const postSubject = (postId) => `post:${postId}`;

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* private mode etc. */ }
}

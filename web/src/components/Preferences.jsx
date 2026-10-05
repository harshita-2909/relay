import { useEffect, useState } from 'react';
import { chirp, relay } from '../api.js';
import { TYPE_ICONS, timeAgo } from '../util.jsx';

// The acting person's choices, stored in Relay.
export default function Preferences({ me, users }) {
  const [prefs, setPrefs] = useState(null);
  const [mutes, setMutes] = useState(null);
  const [posts, setPosts] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    relay.preferences(me.id)
      .then((data) => { setPrefs(data.preferences); setError(null); })
      .catch((err) => setError(err.message));
    relay.mutes(me.id).then((data) => setMutes(data.mutes)).catch(() => setMutes(null));
  }, [me.id]);

  // Label muted posts with their text (Relay only knows "post:12"; the words live in Chirp).
  useEffect(() => {
    chirp.posts()
      .then((data) => setPosts(Object.fromEntries(data.posts.map((p) => [`post:${p.id}`, p]))))
      .catch(() => {});
  }, []);

  const unmute = async (subject) => {
    try {
      setMutes((await relay.unmute(me.id, subject)).mutes);
    } catch (err) {
      setError(err.message);
    }
  };
  const nameOf = (id) => users.find((u) => u.id === id)?.name ?? id;

  const toggle = async (type, enabled) => {
    setSaving(type);
    try {
      setPrefs((await relay.setPreferences(me.id, { [type]: enabled })).preferences);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>{me.name}&apos;s notification settings</h2>
          <p className="muted small">Switch off any kind of notification. Relay will skip it and note why in the records.</p>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <ul className="card pref-list">
        {prefs?.map((p) => (
          <li key={p.type} className="row spread">
            <div className="row">
              <span className="type-badge" aria-hidden="true">{TYPE_ICONS[p.type] ?? '•'}</span>
              <div>
                <strong>{p.label}</strong>
                <p className="muted small">{p.description}{p.isDefault ? ' (default)' : ''}</p>
              </div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={p.enabled}
                disabled={saving === p.type}
                onChange={(e) => toggle(p.type, e.target.checked)}
                aria-label={`${p.label} notifications`}
              />
              <span className="slider" />
              <span className="switch-label">{p.enabled ? 'On' : 'Off'}</span>
            </label>
          </li>
        ))}
      </ul>

      <h3 className="subhead">Muted posts</h3>
      <p className="muted small">
        No likes, comments or new-post notifications about these posts. A direct @mention still comes through.
        Mute a post from the feed or from a notification.
      </p>
      <ul className="card pref-list">
        {mutes?.length === 0 && <li className="muted small">Nothing muted.</li>}
        {mutes?.map((m) => {
          const post = posts[m.subject];
          return (
            <li key={m.subject} className="row spread">
              <div className="grow">
                <strong>{post ? `“${post.text}”` : m.subject}</strong>
                <p className="muted small">{post ? `by ${nameOf(post.authorId)} · ` : ''}muted {timeAgo(m.createdAt)}</p>
              </div>
              <button className="btn small" onClick={() => unmute(m.subject)}>Unmute</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

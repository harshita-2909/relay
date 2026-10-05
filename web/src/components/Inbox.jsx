import { useCallback, useEffect, useState } from 'react';
import { relay } from '../api.js';
import { Avatar, TYPE_ICONS, timeAgo } from '../util.jsx';

// The acting person's inbox, served by Relay. It only ever asks for this one person's notifications.
export default function Inbox({ me, users, onUnreadChange, onOpenRecord }) {
  const [inbox, setInbox] = useState(null);
  const [error, setError] = useState(null);
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));

  const load = useCallback(async () => {
    try {
      const data = await relay.inbox(me.id);
      setInbox(data);
      setError(null);
      onUnreadChange(data.unreadCount);
    } catch (err) {
      setError(err.message);
      onUnreadChange(null);
    }
  }, [me.id, onUnreadChange]);
  useEffect(() => { load(); }, [load]);

  const open = async (n) => {
    if (n.read) return;
    try {
      const { notification, unreadCount } = await relay.markRead(me.id, n.id);
      setInbox((cur) => ({ ...cur, unreadCount, items: cur.items.map((x) => (x.id === n.id ? notification : x)) }));
      onUnreadChange(unreadCount);
    } catch (err) {
      setError(err.message);
    }
  };

  const markAll = async () => {
    try {
      await relay.markAllRead(me.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>{me.name}&apos;s inbox</h2>
          <p className="muted small">
            {inbox ? `${inbox.unreadCount} unread · ${inbox.items.length} total` : ' '}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={load}>Refresh</button>
          <button className="btn" onClick={markAll} disabled={!inbox?.unreadCount}>Mark all as read</button>
        </div>
      </div>

      {error && <div className="notice error">{error} Notifications are served by Relay.</div>}
      {inbox?.items.length === 0 && (
        <div className="empty card">
          <p>No notifications yet.</p>
          <p className="muted small">Switch to someone else and comment on, like or mention {me.name}.</p>
        </div>
      )}

      <ul className="inbox-list">
        {inbox?.items.map((n) => (
          <li key={n.id}>
            <div
              className={`card notification ${n.read ? 'read' : 'unread'}`}
              role="button"
              tabIndex={0}
              onClick={() => open(n)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(n); } }}
              aria-label={`${n.read ? '' : 'Unread: '}${n.body}`}
            >
              <span className="unread-dot" aria-hidden="true" />
              <span className="notif-avatar">
                <Avatar user={byId[n.actorId]} size={36} />
                <span className="type-icon" aria-hidden="true">{TYPE_ICONS[n.type] ?? '•'}</span>
              </span>
              <div className="grow">
                <p className="notif-body">{n.body}</p>
                <p className="muted small">
                  {timeAgo(n.createdAt)}
                  {!n.read && <> · <span className="new-tag">New</span></>}
                </p>
              </div>
              <div className="notif-actions">
                {!n.read && (
                  <button className="link" onClick={(e) => { e.stopPropagation(); open(n); }}>Mark as read</button>
                )}
                <button className="link muted" onClick={(e) => { e.stopPropagation(); onOpenRecord(n.eventId); }}>
                  Why?
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

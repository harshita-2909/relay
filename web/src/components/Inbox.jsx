import { useCallback, useEffect, useState } from 'react';
import { relay } from '../api.js';
import { Avatar, TYPE_ICONS, formatTime, timeAgo } from '../util.jsx';

const SNOOZE_OPTIONS = [
  { minutes: 1, label: '1 minute' },
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 8 * 60, label: '8 hours' },
];

// The acting person's inbox, served by Relay. It only ever asks for this one person's notifications.
export default function Inbox({ me, users, onUnreadChange, onOpenRecord }) {
  const [inbox, setInbox] = useState(null);
  const [mutes, setMutes] = useState(new Set());
  const [error, setError] = useState(null);
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));

  const load = useCallback(async () => {
    try {
      const [data, muteData] = await Promise.all([relay.inbox(me.id), relay.mutes(me.id)]);
      setInbox(data);
      setMutes(new Set(muteData.mutes.map((m) => m.subject)));
      setError(null);
      onUnreadChange(data.unreadCount);
    } catch (err) {
      setError(err.message);
      onUnreadChange(null);
    }
  }, [me.id, onUnreadChange]);
  useEffect(() => { load(); }, [load]);

  // Held notifications appear when the snooze ends; refresh then so they show up on their own.
  const snoozeUntil = inbox?.snooze?.until;
  useEffect(() => {
    if (!snoozeUntil) return undefined;
    const ms = Math.max(0, Date.parse(snoozeUntil) - Date.now()) + 500;
    const timer = setTimeout(load, Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [snoozeUntil, load]);

  const run = async (fn) => {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

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

  const toggleMute = (subject) => run(() => (mutes.has(subject) ? relay.unmute(me.id, subject) : relay.mute(me.id, subject)));

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>{me.name}&apos;s inbox</h2>
          <p className="muted small">
            {inbox ? `${inbox.unreadCount} unread · ${inbox.items.length} total` : ' '}
          </p>
        </div>
        <div className="row wrap">
          {!inbox?.snooze?.active && (
            <label className="small snooze-picker">
              <span aria-hidden="true">😴</span>
              <select
                value=""
                onChange={(e) => { const m = Number(e.target.value); if (m) run(() => relay.snooze(me.id, m)); }}
                aria-label="Snooze all notifications"
              >
                <option value="">Snooze…</option>
                {SNOOZE_OPTIONS.map((o) => <option key={o.minutes} value={o.minutes}>for {o.label}</option>)}
              </select>
            </label>
          )}
          <button className="btn" onClick={load}>Refresh</button>
          <button className="btn" onClick={() => run(() => relay.markAllRead(me.id))} disabled={!inbox?.unreadCount}>
            Mark all as read
          </button>
        </div>
      </div>

      {inbox?.snooze?.active && (
        <div className="notice snooze">
          <span>
            😴 <strong>Snoozed until {formatTime(inbox.snooze.until)}.</strong>{' '}
            {inbox.snooze.heldCount
              ? `${inbox.snooze.heldCount} notification${inbox.snooze.heldCount === 1 ? ' is' : 's are'} waiting and will appear then.`
              : 'New notifications will wait until then.'}
          </span>
          <button className="btn small" onClick={() => run(() => relay.endSnooze(me.id))}>End snooze</button>
        </div>
      )}

      {error && <div className="notice error">{error} Notifications are served by Relay.</div>}
      {inbox?.items.length === 0 && (
        <div className="empty card">
          <p>No notifications yet.</p>
          <p className="muted small">Switch to someone else and comment on, like or mention {me.name}.</p>
        </div>
      )}

      <ul className="inbox-list">
        {inbox?.items.map((n) => {
          const isPost = n.subject?.startsWith('post:');
          const muted = isPost && mutes.has(n.subject);
          return (
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
                  {n.actorIds.length > 1 ? (
                    <span className="avatar-stack" aria-hidden="true">
                      {n.actorIds.slice(0, 3).map((id) => <Avatar key={id} user={byId[id]} size={26} />)}
                    </span>
                  ) : <Avatar user={byId[n.actorId]} size={36} />}
                  <span className="type-icon" aria-hidden="true">{TYPE_ICONS[n.type] ?? '•'}</span>
                </span>
                <div className="grow">
                  <p className="notif-body">{n.body}</p>
                  <p className="muted small">
                    {timeAgo(n.time)}
                    {n.activityCount > 1 && <> · {n.activityCount} updates</>}
                    {!n.read && <> · <span className="new-tag">New</span></>}
                    {muted && <> · 🔕 post muted</>}
                  </p>
                </div>
                <div className="notif-actions">
                  {!n.read && (
                    <button className="link" onClick={(e) => { e.stopPropagation(); open(n); }}>Mark as read</button>
                  )}
                  {isPost && (
                    <button className="link muted" onClick={(e) => { e.stopPropagation(); toggleMute(n.subject); }}>
                      {muted ? 'Unmute post' : 'Mute post'}
                    </button>
                  )}
                  <button className="link muted" onClick={(e) => { e.stopPropagation(); onOpenRecord(n.eventId); }}>
                    Why?
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

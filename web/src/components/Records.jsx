import { useCallback, useEffect, useRef, useState } from 'react';
import { relay } from '../api.js';
import { timeAgo } from '../util.jsx';

const OUTCOME = {
  delivered: { icon: '✓', label: 'Notified', pill: 'pill-ok' },
  held: { icon: '⏸', label: 'Held (snoozed)', pill: 'pill-held' },
  skipped: { icon: '⊘', label: 'Skipped', pill: 'pill-skip' },
};

// "What happened, and why?" — every activity Relay received, who it notified, who it skipped.
export default function Records({ users, focusEventId }) {
  const [recipientId, setRecipientId] = useState('');
  const [status, setStatus] = useState('');
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setEvents((await relay.events({ recipientId, status })).events);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [recipientId, status]);
  useEffect(() => { load(); }, [load]);

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Notification records</h2>
          <p className="muted small">Every activity Relay received, who was notified, and who was skipped and why.</p>
        </div>
        <div className="row wrap">
          <label className="small">
            Person{' '}
            <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
              <option value="">Everyone</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="small">
            Status{' '}
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="processed">Processed</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <button className="btn" onClick={load}>Refresh</button>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {events?.length === 0 && <div className="empty card"><p className="muted">No activity recorded yet.</p></div>}
      <ul className="records">
        {events?.map((e) => <RecordCard key={e.id} event={e} focused={e.id === focusEventId} />)}
      </ul>
    </section>
  );
}

function RecordCard({ event, focused }) {
  const ref = useRef(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focused]);

  const rejected = event.status === 'rejected';
  return (
    <li ref={ref} className={`card record ${focused ? 'focused' : ''} ${rejected ? 'rejected' : ''}`}>
      <div className="row spread">
        <div>
          <strong>{rejected ? `Rejected: ${event.type ?? '(no type)'}` : event.description}</strong>
          <div className="muted small">
            #{event.id} · <code>{event.type ?? '—'}</code> · {timeAgo(event.receivedAt)}
          </div>
        </div>
        <span className={`pill ${rejected ? 'pill-bad' : 'pill-ok'}`}>{rejected ? 'Rejected' : event.summary}</span>
      </div>

      {rejected && <p className="reason error-text">{event.error.message}</p>}

      {event.results.length > 0 && (
        <ul className="outcomes">
          {event.results.map((r) => (
            <li key={r.recipient.id} className={`outcome ${r.outcome}`}>
              <span className="outcome-icon" aria-hidden="true">{OUTCOME[r.outcome].icon}</span>
              <div>
                <strong>{r.recipient.name}</strong>{' '}
                <span className={`pill small ${OUTCOME[r.outcome].pill}`}>
                  {OUTCOME[r.outcome].label}{r.reasonCode === 'grouped' ? ' (combined)' : ''} · {r.typeLabel}
                </span>
                <p className="reason">{r.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <details>
        <summary className="muted small">What the app reported</summary>
        <pre>{JSON.stringify(event.payload, null, 2)}</pre>
      </details>
    </li>
  );
}

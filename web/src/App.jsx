import { useCallback, useEffect, useState } from 'react';
import { chirp, relay } from './api.js';
import Feed from './components/Feed.jsx';
import Inbox from './components/Inbox.jsx';
import Preferences from './components/Preferences.jsx';
import Records from './components/Records.jsx';
import Templates from './components/Templates.jsx';
import Toasts, { useToasts } from './components/Toasts.jsx';
import { Avatar, storageGet, storageSet } from './util.jsx';

const APP_TABS = [
  { id: 'feed', label: 'Feed' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'preferences', label: 'Notification settings' },
];
const CONSOLE_TABS = [
  { id: 'templates', label: 'Templates' },
  { id: 'records', label: 'Records' },
];
const TAB_IDS = [...APP_TABS, ...CONSOLE_TABS].map((t) => t.id);
const tabFromHash = () => {
  const id = window.location.hash.slice(1);
  return TAB_IDS.includes(id) ? id : 'feed';
};

export default function App() {
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState(null);
  const [actingAs, setActingAs] = useState(() => storageGet('chirp.actingAs') ?? 'asha');
  const [tab, setTab] = useState(tabFromHash);
  const [unread, setUnread] = useState(null); // null = unknown (Relay offline)
  const [focusEventId, setFocusEventId] = useState(null);
  const { toasts, push: toast, dismiss } = useToasts();

  const me = users.find((u) => u.id === actingAs);

  const loadUsers = useCallback(async () => {
    try {
      const { users: list } = await chirp.users();
      setUsers(list);
      setUsersError(null);
    } catch (err) {
      setUsersError(err.message);
    }
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      setUnread((await relay.inbox(actingAs)).unreadCount);
    } catch {
      setUnread(null);
    }
  }, [actingAs]);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { refreshUnread(); }, [refreshUnread, tab]);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    window.addEventListener('focus', refreshUnread);
    return () => window.removeEventListener('focus', refreshUnread);
  }, [refreshUnread]);

  const switchUser = (id) => { setActingAs(id); storageSet('chirp.actingAs', id); };
  const go = (id) => { setTab(id); window.location.hash = id; };
  const openRecord = (eventId) => { setFocusEventId(eventId); go('records'); };

  /** Show what Relay did with an action Chirp reported. */
  const reportOutcome = (verb, relayResult) => {
    if (!relayResult) return;
    if (relayResult.reported) {
      toast({
        tone: 'ok',
        title: `${verb} — reported to Relay`,
        body: relayResult.summary,
        action: { label: 'View record', onClick: () => openRecord(relayResult.eventId) },
      });
    } else {
      toast({ tone: 'warn', title: `${verb} — saved in Chirp`, body: relayResult.error });
    }
    loadUsers();
  };

  if (usersError) {
    return (
      <div className="boot-error">
        <h1>Chirp isn&apos;t reachable</h1>
        <p>{usersError} Start everything with <code>npm start</code> from the project root.</p>
        <button className="btn" onClick={loadUsers}>Try again</button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo">🐦</span> Chirp</div>
        <div className="acting-as" role="radiogroup" aria-label="Acting as">
          <span className="muted small">Acting as</span>
          {users.map((u) => (
            <button
              key={u.id}
              role="radio"
              aria-checked={u.id === actingAs}
              className={`person-chip ${u.id === actingAs ? 'active' : ''}`}
              onClick={() => switchUser(u.id)}
              title={`Act as ${u.name}`}
            >
              <Avatar user={u} size={24} /> {u.name}
            </button>
          ))}
        </div>
        <button className="bell" onClick={() => go('inbox')} aria-label={`Inbox, ${unread ?? 0} unread`}>
          🔔
          {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </header>

      <nav className="tabs">
        <div className="tab-group">
          <span className="tab-group-label">Chirp{me ? ` · ${me.name}` : ''}</span>
          {APP_TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => go(t.id)}>
              {t.label}
              {t.id === 'inbox' && unread > 0 && <span className="tab-count">{unread}</span>}
            </button>
          ))}
        </div>
        <div className="tab-group console">
          <span className="tab-group-label">Relay console</span>
          {CONSOLE_TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="content">
        {!me ? <p className="muted">Loading…</p> : (
          <>
            {tab === 'feed' && <Feed me={me} users={users} onOutcome={reportOutcome} onUsersChanged={loadUsers} onError={(m) => toast({ tone: 'error', title: m })} />}
            {tab === 'inbox' && <Inbox key={me.id} me={me} users={users} onUnreadChange={setUnread} onOpenRecord={openRecord} />}
            {tab === 'preferences' && <Preferences key={me.id} me={me} users={users} />}
            {tab === 'templates' && <Templates />}
            {tab === 'records' && <Records users={users} focusEventId={focusEventId} />}
          </>
        )}
      </main>

      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

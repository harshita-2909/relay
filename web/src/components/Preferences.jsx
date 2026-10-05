import { useEffect, useState } from 'react';
import { relay } from '../api.js';
import { TYPE_ICONS } from '../util.jsx';

// The acting person's choices, stored in Relay.
export default function Preferences({ me }) {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    relay.preferences(me.id)
      .then((data) => { setPrefs(data.preferences); setError(null); })
      .catch((err) => setError(err.message));
  }, [me.id]);

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
    </section>
  );
}

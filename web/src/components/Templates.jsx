import { useEffect, useState } from 'react';
import { relay } from '../api.js';
import { TYPE_ICONS } from '../util.jsx';

// Content owner's view: change the wording of each notification type. No change to Chirp needed.

// Same sample values Relay uses for its previews.
const SAMPLE = {
  actor: 'Rahul', recipient: 'Asha', comment: 'Great photo!', post: 'Sunset at the beach',
  context: 'comment', text: 'Hey @Asha, look at this',
};
const preview = (template) => template.replace(/\{(\w+)\}/g, (m, name) => SAMPLE[name] ?? m);

export default function Templates() {
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    relay.templates()
      .then((data) => setTemplates(data.templates))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Notification wording</h2>
          <p className="muted small">
            Edit what each notification says. Fill-in blanks look like <code>{'{actor}'}</code>.
            Changes apply to new notifications straight away; ones already sent keep their words.
          </p>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      {templates?.map((t) => <TemplateEditor key={t.type} initial={t} />)}
    </section>
  );
}

function TemplateEditor({ initial }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial.template);
  const [status, setStatus] = useState(null); // { tone, text }
  const [busy, setBusy] = useState(false);
  const dirty = draft !== saved.template;

  const save = async () => {
    setBusy(true);
    try {
      const updated = await relay.saveTemplate(saved.type, draft);
      setSaved(updated);
      setDraft(updated.template);
      setStatus({ tone: 'ok', text: 'Saved. New notifications will use this wording.' });
    } catch (err) {
      setStatus({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const insert = (name) => { setDraft((d) => `${d}{${name}}`); setStatus(null); };

  return (
    <div className="card template">
      <div className="row spread">
        <div className="row">
          <span className="type-badge" aria-hidden="true">{TYPE_ICONS[saved.type] ?? '•'}</span>
          <div>
            <strong>{saved.label}</strong> <code className="muted small">{saved.type}</code>
            <p className="muted small">{saved.description}</p>
          </div>
        </div>
        <span className="muted small">Updated {new Date(saved.updatedAt).toLocaleString()}</span>
      </div>

      <textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setStatus(null); }}
        rows={2}
        maxLength={280}
        aria-label={`${saved.label} wording`}
      />
      <div className="row wrap">
        <span className="muted small">Blanks:</span>
        {saved.variables.map((v) => (
          <button key={v} type="button" className="chip" onClick={() => insert(v)}>{`{${v}}`}</button>
        ))}
      </div>
      <p className="preview"><span className="muted small">Preview</span> {preview(draft) || <em className="muted">empty</em>}</p>

      <div className="row spread">
        <span className={`small ${status?.tone === 'error' ? 'error-text' : 'ok-text'}`}>{status?.text}</span>
        <div className="row">
          <button className="btn" disabled={!dirty || busy} onClick={() => { setDraft(saved.template); setStatus(null); }}>Undo changes</button>
          <button className="btn primary" disabled={!dirty || busy} onClick={save}>Save wording</button>
        </div>
      </div>
    </div>
  );
}

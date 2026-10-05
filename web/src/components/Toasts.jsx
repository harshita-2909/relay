import { useCallback, useRef, useState } from 'react';

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback((toast) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, ...toast }]);
    setTimeout(() => dismiss(id), toast.tone === 'error' ? 8000 : 5000);
  }, [dismiss]);

  return { toasts, push, dismiss };
}

export default function Toasts({ toasts, dismiss }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone ?? ''}`}>
          <div className="toast-text">
            <strong>{t.title}</strong>
            {t.body && <span>{t.body}</span>}
          </div>
          {t.action && (
            <button className="link" onClick={() => { t.action.onClick(); dismiss(t.id); }}>{t.action.label}</button>
          )}
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}

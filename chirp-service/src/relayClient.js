// The ONLY place Chirp talks to Relay. Chirp says what happened; Relay decides everything else.
// If Relay is down or slow, Chirp carries on and the activity simply goes unnotified.

export function createRelayClient({ baseUrl, timeoutMs = 2000, log = console } = {}) {
  async function send(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  }

  return {
    baseUrl,

    /** Report one activity. Never throws; returns what happened so the UI can show it. */
    async report(event) {
      try {
        const { res, json } = await send('POST', '/api/events', event);
        if (res.ok) return { reported: true, eventId: json.eventId, summary: json.summary };
        log.warn(`[chirp] Relay rejected ${event.type}: ${json?.error?.message ?? res.status}`);
        return { reported: false, eventId: json?.eventId, error: json?.error?.message ?? `Relay answered ${res.status}` };
      } catch (err) {
        log.warn(`[chirp] Relay unreachable (${err.name === 'TimeoutError' ? 'timed out' : err.cause?.code ?? err.message}); `
          + `${event.type} went unnotified.`);
        return { reported: false, error: 'Relay is not reachable, so this activity went unnotified.' };
      }
    },

    /** Introduce Chirp's people to Relay. Throws if Relay can't be reached (callers retry). */
    async registerUsers(users) {
      for (const u of users) {
        const { res } = await send('PUT', `/api/users/${encodeURIComponent(u.id)}`, { name: u.name });
        if (!res.ok) throw new Error(`Relay answered ${res.status} registering ${u.id}`);
      }
    },
  };
}

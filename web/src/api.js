// Thin JSON clients for the two services. Errors carry the service's plain-language message.

export class ApiError extends Error {
  constructor(message, { status, code, service } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.service = service;
  }
}

function client(base, service) {
  return async (path, { method = 'GET', body } = {}) => {
    let res;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(`${service} is not reachable.`, { service, code: 'unreachable' });
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      // The dev-server proxy answers 5xx without a JSON body when the service is down.
      const offline = !json && res.status >= 500;
      throw new ApiError(
        json?.error?.message ?? (offline ? `${service} is not running.` : `${service} request failed (${res.status}).`),
        { status: res.status, code: json?.error?.code ?? (offline ? 'unreachable' : undefined), service },
      );
    }
    return json;
  };
}

const chirpCall = client('/chirp-api', 'Chirp');
const relayCall = client('/relay-api', 'Relay');

const u = encodeURIComponent;

export const chirp = {
  users: () => chirpCall('/users'),
  posts: () => chirpCall('/posts'),
  createPost: (actorId, text) => chirpCall('/posts', { method: 'POST', body: { actorId, text } }),
  comment: (postId, actorId, text) => chirpCall(`/posts/${postId}/comments`, { method: 'POST', body: { actorId, text } }),
  like: (postId, actorId) => chirpCall(`/posts/${postId}/likes`, { method: 'POST', body: { actorId } }),
  follow: (userId, actorId) => chirpCall(`/users/${u(userId)}/followers`, { method: 'POST', body: { actorId } }),
  unfollow: (userId, actorId) => chirpCall(`/users/${u(userId)}/followers/${u(actorId)}`, { method: 'DELETE' }),
};

export const relay = {
  inbox: (userId) => relayCall(`/users/${u(userId)}/inbox`),
  markRead: (userId, id) => relayCall(`/users/${u(userId)}/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: (userId) => relayCall(`/users/${u(userId)}/inbox/read-all`, { method: 'POST' }),
  preferences: (userId) => relayCall(`/users/${u(userId)}/preferences`),
  setPreferences: (userId, changes) => relayCall(`/users/${u(userId)}/preferences`, { method: 'PUT', body: changes }),
  mutes: (userId) => relayCall(`/users/${u(userId)}/mutes`),
  mute: (userId, subject) => relayCall(`/users/${u(userId)}/mutes/${u(subject)}`, { method: 'PUT' }),
  unmute: (userId, subject) => relayCall(`/users/${u(userId)}/mutes/${u(subject)}`, { method: 'DELETE' }),
  snooze: (userId, minutes) => relayCall(`/users/${u(userId)}/snooze`, { method: 'PUT', body: { minutes } }),
  endSnooze: (userId) => relayCall(`/users/${u(userId)}/snooze`, { method: 'DELETE' }),
  templates: () => relayCall('/templates'),
  saveTemplate: (type, changes) => relayCall(`/templates/${u(type)}`, { method: 'PUT', body: changes }),
  events: ({ recipientId, status } = {}) => {
    const q = new URLSearchParams({ limit: '100' });
    if (recipientId) q.set('recipientId', recipientId);
    if (status) q.set('status', status);
    return relayCall(`/events?${q}`);
  },
};

import { Router } from 'express';
import { nowIso, transaction } from '../db/db.js';
import {
  getPreferences, getTemplate, getUser, listUsers, setPreference, toNotification, unreadCount, upsertUser,
} from '../store.js';
import { sendError } from './errors.js';

// Everything under /api/users/:userId is scoped to that one person: their profile,
// their preferences and their inbox. Nobody can read or change another person's inbox here.
export function usersRouter(db) {
  const router = Router();

  router.get('/', (_req, res) => res.json({ users: listUsers(db) }));

  // Apps can introduce people up front (events also introduce them automatically).
  router.put('/:userId', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return sendError(res, 400, 'invalid_user', 'Send {"name": "..."} to register a person.');
    upsertUser(db, { id: req.params.userId, name });
    return res.json(getUser(db, req.params.userId));
  });

  router.get('/:userId', (req, res) => {
    const user = getUser(db, req.params.userId);
    if (!user) return unknownUser(res, req.params.userId);
    return res.json(user);
  });

  // ---- preferences -----------------------------------------------------------------------

  // Unknown people get the defaults: that is exactly what they would receive.
  router.get('/:userId/preferences', (req, res) => {
    res.json({ userId: req.params.userId, preferences: getPreferences(db, req.params.userId) });
  });

  // Body: { "new_like": false, "mention": true, ... } — any subset of notification types.
  router.put('/:userId/preferences', (req, res) => {
    const { userId } = req.params;
    if (!getUser(db, userId)) return unknownUser(res, userId);

    const changes = req.body;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) {
      return sendError(res, 400, 'invalid_preferences',
        'Send an object of notification types to true/false, e.g. {"new_like": false}.');
    }
    const problems = [];
    for (const [type, enabled] of Object.entries(changes)) {
      if (!getTemplate(db, type)) problems.push(`"${type}" is not a notification type`);
      else if (typeof enabled !== 'boolean') problems.push(`"${type}" must be true or false`);
    }
    if (problems.length) return sendError(res, 400, 'invalid_preferences', `${problems.join('; ')}.`, problems);

    const now = nowIso();
    transaction(db, () => {
      for (const [type, enabled] of Object.entries(changes)) setPreference(db, userId, type, enabled, now);
    });
    return res.json({ userId, preferences: getPreferences(db, userId) });
  });

  // ---- inbox -----------------------------------------------------------------------------

  router.get('/:userId/inbox', (req, res) => {
    const { userId } = req.params;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const items = db.prepare(`
      SELECT * FROM notifications WHERE recipient_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(userId, limit).map(toNotification);
    res.json({ userId, unreadCount: unreadCount(db, userId), items });
  });

  router.post('/:userId/notifications/:notificationId/read', (req, res) => {
    const { userId } = req.params;
    const id = Number(req.params.notificationId);
    // Scoped by recipient: someone else's notification id looks exactly like a missing one.
    const row = db.prepare('SELECT * FROM notifications WHERE id = ? AND recipient_id = ?').get(id, userId);
    if (!row) {
      return sendError(res, 404, 'notification_not_found',
        `There is no notification ${req.params.notificationId} in ${userId}'s inbox.`);
    }
    if (row.read_at === null) {
      db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(nowIso(), id);
    }
    const updated = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
    return res.json({ notification: toNotification(updated), unreadCount: unreadCount(db, userId) });
  });

  router.post('/:userId/inbox/read-all', (req, res) => {
    const { userId } = req.params;
    const { changes } = db.prepare(
      'UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL',
    ).run(nowIso(), userId);
    res.json({ userId, markedRead: Number(changes), unreadCount: unreadCount(db, userId) });
  });

  return router;
}

const unknownUser = (res, userId) => sendError(res, 404, 'user_not_found',
  `Relay hasn't heard of "${userId}" yet. Register them with PUT /api/users/${userId} or send an event that involves them.`);

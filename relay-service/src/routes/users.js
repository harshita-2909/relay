import { Router } from 'express';
import { nowIso, transaction } from '../db/db.js';
import {
  activeSnooze, getPreferences, getTemplate, getUser, heldCount, listMutes, listUsers, setPreference,
  toNotification, unreadCount, upsertUser,
} from '../store.js';
import { sendError } from './errors.js';

const SUBJECT = /^[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_.-]{1,100}$/;
const MAX_SNOOZE_MINUTES = 7 * 24 * 60;

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
  // Only what has arrived: notifications held by a snooze stay out of sight (and out of the
  // unread count) until it ends.

  router.get('/:userId/inbox', (req, res) => {
    const { userId } = req.params;
    const now = nowIso();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const items = db.prepare(`
      SELECT * FROM notifications WHERE recipient_id = ? AND visible_at <= ?
      ORDER BY visible_at DESC, id DESC LIMIT ?
    `).all(userId, now, limit).map(toNotification);
    res.json({
      userId,
      unreadCount: unreadCount(db, userId, now),
      items,
      snooze: snoozeState(userId, now),
    });
  });

  router.post('/:userId/notifications/:notificationId/read', (req, res) => {
    const { userId } = req.params;
    const id = Number(req.params.notificationId);
    const now = nowIso();
    // Scoped by recipient: someone else's notification id looks exactly like a missing one.
    const row = db.prepare('SELECT * FROM notifications WHERE id = ? AND recipient_id = ? AND visible_at <= ?')
      .get(id, userId, now);
    if (!row) {
      return sendError(res, 404, 'notification_not_found',
        `There is no notification ${req.params.notificationId} in ${userId}'s inbox.`);
    }
    if (row.read_at === null) {
      db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(now, id);
    }
    const updated = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
    return res.json({ notification: toNotification(updated), unreadCount: unreadCount(db, userId, now) });
  });

  router.post('/:userId/inbox/read-all', (req, res) => {
    const { userId } = req.params;
    const now = nowIso();
    const { changes } = db.prepare(
      'UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL AND visible_at <= ?',
    ).run(now, userId, now);
    res.json({ userId, markedRead: Number(changes), unreadCount: unreadCount(db, userId, now) });
  });

  // ---- mute (B5) -------------------------------------------------------------------------
  // A subject is whatever notifications are about, e.g. "post:12". Muting it silences
  // comments, likes and new-post notifications about it. Direct @mentions still get through.

  router.get('/:userId/mutes', (req, res) => {
    res.json({ userId: req.params.userId, mutes: listMutes(db, req.params.userId) });
  });

  router.put('/:userId/mutes/:subject', (req, res) => {
    const { userId, subject } = req.params;
    if (!getUser(db, userId)) return unknownUser(res, userId);
    if (!SUBJECT.test(subject)) return badSubject(res, subject);
    db.prepare('INSERT OR IGNORE INTO mutes (user_id, subject, created_at) VALUES (?, ?, ?)').run(userId, subject, nowIso());
    res.json({ userId, subject, muted: true, mutes: listMutes(db, userId) });
  });

  router.delete('/:userId/mutes/:subject', (req, res) => {
    const { userId, subject } = req.params;
    if (!SUBJECT.test(subject)) return badSubject(res, subject);
    db.prepare('DELETE FROM mutes WHERE user_id = ? AND subject = ?').run(userId, subject);
    res.json({ userId, subject, muted: false, mutes: listMutes(db, userId) });
  });

  // ---- snooze (B5) -----------------------------------------------------------------------
  // While snoozing, nothing is lost: notifications are held and appear (unread) when the
  // snooze ends — on its own at the end time, or straight away if ended early.

  const snoozeState = (userId, now = nowIso()) => {
    const until = activeSnooze(db, userId, now);
    return { active: !!until, until, heldCount: heldCount(db, userId, now) };
  };

  router.get('/:userId/snooze', (req, res) => {
    res.json({ userId: req.params.userId, ...snoozeState(req.params.userId) });
  });

  // Body: { "minutes": 1..10080 }
  router.put('/:userId/snooze', (req, res) => {
    const { userId } = req.params;
    if (!getUser(db, userId)) return unknownUser(res, userId);
    const minutes = req.body?.minutes;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_SNOOZE_MINUTES) {
      return sendError(res, 400, 'invalid_snooze',
        `Send {"minutes": n} with a whole number of minutes from 1 to ${MAX_SNOOZE_MINUTES} (one week).`);
    }
    const now = nowIso();
    const until = new Date(Date.parse(now) + minutes * 60_000).toISOString();
    transaction(db, () => {
      db.prepare('UPDATE users SET snoozed_until = ? WHERE id = ?').run(until, userId);
      // Anything already held now waits for the new end time.
      db.prepare('UPDATE notifications SET visible_at = ? WHERE recipient_id = ? AND visible_at > ?').run(until, userId, now);
    });
    res.json({ userId, ...snoozeState(userId, now) });
  });

  router.delete('/:userId/snooze', (req, res) => {
    const { userId } = req.params;
    const now = nowIso();
    const released = transaction(db, () => {
      db.prepare('UPDATE users SET snoozed_until = NULL WHERE id = ?').run(userId);
      return Number(db.prepare('UPDATE notifications SET visible_at = ? WHERE recipient_id = ? AND visible_at > ?')
        .run(now, userId, now).changes);
    });
    res.json({ userId, released, ...snoozeState(userId, now), unreadCount: unreadCount(db, userId, now) });
  });

  return router;
}

const badSubject = (res, subject) => sendError(res, 400, 'invalid_subject',
  `"${subject}" is not a subject Relay understands. Subjects look like "post:12".`);

const unknownUser = (res, userId) => sendError(res, 404, 'user_not_found',
  `Relay hasn't heard of "${userId}" yet. Register them with PUT /api/users/${userId} or send an event that involves them.`);

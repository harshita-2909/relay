// Small data-access helpers shared by the engine and the routes.
import { nowIso } from './db/db.js';

// ---- users -------------------------------------------------------------------------------

export function upsertUser(db, { id, name }, now = nowIso()) {
  db.prepare(`
    INSERT INTO users (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
      WHERE users.name IS NOT excluded.name
  `).run(id, name, now, now);
}

export function getUser(db, id) {
  return db.prepare('SELECT id, name, created_at AS createdAt FROM users WHERE id = ?').get(id) ?? null;
}

export function listUsers(db) {
  return db.prepare('SELECT id, name, created_at AS createdAt FROM users ORDER BY name').all();
}

// ---- templates ---------------------------------------------------------------------------

const toTemplate = (r) => ({
  type: r.type,
  label: r.label,
  description: r.description,
  template: r.template,
  variables: JSON.parse(r.variables),
  defaultEnabled: r.default_enabled === 1,
  updatedAt: r.updated_at,
});

export function listTemplates(db) {
  return db.prepare('SELECT * FROM notification_templates ORDER BY label').all().map(toTemplate);
}

export function getTemplate(db, type) {
  const row = db.prepare('SELECT * FROM notification_templates WHERE type = ?').get(type);
  return row ? toTemplate(row) : null;
}

export function updateTemplate(db, type, template, now = nowIso()) {
  db.prepare('UPDATE notification_templates SET template = ?, updated_at = ? WHERE type = ?')
    .run(template, now, type);
  return getTemplate(db, type);
}

// ---- preferences -------------------------------------------------------------------------

/** { [type]: { enabled, isDefault } } for every notification type. Works for unknown users too. */
export function getPreferences(db, userId) {
  const overrides = new Map(
    db.prepare('SELECT type, enabled FROM preferences WHERE user_id = ?').all(userId)
      .map((r) => [r.type, r.enabled === 1]),
  );
  return listTemplates(db).map((t) => ({
    type: t.type,
    label: t.label,
    description: t.description,
    enabled: overrides.get(t.type) ?? t.defaultEnabled,
    isDefault: !overrides.has(t.type),
  }));
}

export function isEnabled(db, userId, type) {
  const row = db.prepare(`
    SELECT COALESCE(p.enabled, t.default_enabled) AS enabled
    FROM notification_templates t
    LEFT JOIN preferences p ON p.type = t.type AND p.user_id = ?
    WHERE t.type = ?
  `).get(userId, type);
  return row?.enabled === 1;
}

export function setPreference(db, userId, type, enabled, now = nowIso()) {
  db.prepare(`
    INSERT INTO preferences (user_id, type, enabled, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, type) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
  `).run(userId, type, enabled ? 1 : 0, now);
}

// ---- inbox -------------------------------------------------------------------------------

export function unreadCount(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND read_at IS NULL')
    .get(userId).n;
}

export const toNotification = (r) => ({
  id: r.id,
  type: r.type,
  body: r.body,
  actorId: r.actor_id,
  eventId: r.event_id,
  read: r.read_at !== null,
  readAt: r.read_at,
  createdAt: r.created_at,
});

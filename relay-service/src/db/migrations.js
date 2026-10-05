// Schema changes after the first version (schema.sql). Each runs once, in order, inside a
// transaction, and bumps PRAGMA user_version. Fresh and existing databases end up identical.

export const MIGRATIONS = [
  {
    version: 2,
    name: 'grouping, followers, mute and snooze',
    sql: `
      -- B3 grouping + B5 snooze: notifications can absorb later activity and be held until later.
      ALTER TABLE notifications ADD COLUMN subject TEXT;                 -- e.g. "post:12"
      ALTER TABLE notifications ADD COLUMN group_key TEXT;               -- type|subject when grouping applies
      ALTER TABLE notifications ADD COLUMN actor_ids TEXT;               -- JSON, most recent first
      ALTER TABLE notifications ADD COLUMN activity_count INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE notifications ADD COLUMN updated_at TEXT;
      ALTER TABLE notifications ADD COLUMN visible_at TEXT;              -- when it shows in the inbox
      UPDATE notifications SET
        actor_ids = json_array(actor_id),
        updated_at = created_at,
        visible_at = created_at;
      DROP INDEX IF EXISTS idx_notifications_inbox;
      CREATE INDEX idx_notifications_inbox ON notifications (recipient_id, visible_at DESC, id DESC);
      CREATE INDEX idx_notifications_group ON notifications (recipient_id, group_key, updated_at DESC);

      -- How long (minutes) similar notifications keep combining. NULL = never group.
      ALTER TABLE notification_templates ADD COLUMN group_window_minutes INTEGER;
      UPDATE notification_templates SET group_window_minutes = 60
        WHERE type IN ('new_like', 'new_comment', 'new_follower');

      -- B5 snooze: everything is held until this time.
      ALTER TABLE users ADD COLUMN snoozed_until TEXT;

      -- B5 mute: no notifications about this subject (except direct mentions).
      CREATE TABLE mutes (
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (user_id, subject)
      );

      -- Records gain a third outcome, 'held' (snoozed). SQLite can't alter a CHECK, so rebuild.
      CREATE TABLE notification_records_v2 (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id         INTEGER NOT NULL REFERENCES events(id),
        recipient_id     TEXT NOT NULL REFERENCES users(id),
        type             TEXT NOT NULL REFERENCES notification_templates(type),
        outcome          TEXT NOT NULL CHECK (outcome IN ('delivered', 'held', 'skipped')),
        reason_code      TEXT NOT NULL,   -- delivered | grouped | snoozed | self_action | preference_off | muted
        reason           TEXT NOT NULL,
        notification_id  INTEGER REFERENCES notifications(id),
        created_at       TEXT NOT NULL
      );
      INSERT INTO notification_records_v2 SELECT * FROM notification_records;
      DROP TABLE notification_records;
      ALTER TABLE notification_records_v2 RENAME TO notification_records;
      CREATE INDEX idx_records_event ON notification_records (event_id);
      CREATE INDEX idx_records_recipient ON notification_records (recipient_id);
    `,
  },
];

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Relay database migration ${m.version} (${m.name}) failed: ${err.message}`);
    }
  }
}

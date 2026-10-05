-- Relay owns everything about notifications. It never reads the app's (Chirp's) data;
-- everything it knows arrives in events or through its own API.

-- People Relay has heard of. Created/updated from events or PUT /api/users/:id.
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- One row per notification type: its wording (editable by the content owner),
-- the placeholders that wording may use, and whether new people get it by default.
CREATE TABLE IF NOT EXISTS notification_templates (
  type             TEXT PRIMARY KEY,           -- new_comment | new_like | mention | new_follower
  label            TEXT NOT NULL,              -- "New comment"
  description      TEXT NOT NULL,
  template         TEXT NOT NULL,              -- "{actor} commented on your post: '{comment}'"
  variables        TEXT NOT NULL,              -- JSON array of allowed placeholder names
  default_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (default_enabled IN (0, 1)),
  updated_at       TEXT NOT NULL
);

-- Only explicit choices are stored. No row = the type's default_enabled applies.
CREATE TABLE IF NOT EXISTS preferences (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL REFERENCES notification_templates(type),
  enabled     INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, type)
);

-- Every report Relay receives, including ones it rejected (so "why?" is always answerable).
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT,                           -- may be NULL/unknown for rejected events
  actor_id     TEXT,
  payload      TEXT NOT NULL,                  -- the raw JSON body as received
  status       TEXT NOT NULL CHECK (status IN ('processed', 'rejected')),
  error_code   TEXT,
  error        TEXT,                           -- plain-language rejection reason
  occurred_at  TEXT,                           -- when it happened in the app (if reported)
  received_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_received ON events (received_at DESC, id DESC);

-- In-app inbox. The body is rendered at delivery time, so later wording edits
-- only affect new notifications.
CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id      INTEGER NOT NULL REFERENCES events(id),
  type          TEXT NOT NULL REFERENCES notification_templates(type),
  actor_id      TEXT,
  body          TEXT NOT NULL,
  read_at       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_inbox
  ON notifications (recipient_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (recipient_id) WHERE read_at IS NULL;

-- Relay's receipt: one row per person considered for an event, delivered or skipped, and why.
CREATE TABLE IF NOT EXISTS notification_records (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id         INTEGER NOT NULL REFERENCES events(id),
  recipient_id     TEXT NOT NULL REFERENCES users(id),
  type             TEXT NOT NULL REFERENCES notification_templates(type),
  outcome          TEXT NOT NULL CHECK (outcome IN ('delivered', 'skipped')),
  reason_code      TEXT NOT NULL,              -- delivered | self_action | preference_off
  reason           TEXT NOT NULL,              -- plain language, e.g. "Asha has turned off ..."
  notification_id  INTEGER REFERENCES notifications(id),
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_event ON notification_records (event_id);
CREATE INDEX IF NOT EXISTS idx_records_recipient ON notification_records (recipient_id);

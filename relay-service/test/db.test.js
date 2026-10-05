import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, transaction } from '../src/db/db.js';
import { DEFAULT_TEMPLATES } from '../src/db/seed.js';

test('schema creates all tables', () => {
  const db = openDb(':memory:');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all().map((r) => r.name).filter((n) => !n.startsWith('sqlite_'));
  assert.deepEqual(tables, [
    'events', 'mutes', 'notification_records', 'notification_templates', 'notifications', 'preferences', 'users',
  ]);
});

test('default templates are seeded, and edits survive a restart', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-db-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'relay.db');

  const db = openDb(file);
  const types = db.prepare('SELECT type FROM notification_templates ORDER BY type').all().map((r) => r.type);
  assert.deepEqual(types, DEFAULT_TEMPLATES.map((tpl) => tpl.type).sort());
  db.prepare("UPDATE notification_templates SET template = 'edited' WHERE type = 'new_like'").run();
  db.close();

  const reopened = openDb(file); // re-runs schema + seed, as every start does
  const row = reopened.prepare("SELECT template FROM notification_templates WHERE type = 'new_like'").get();
  assert.equal(row.template, 'edited');
  reopened.close();
});

test('foreign keys are enforced', () => {
  const db = openDb(':memory:');
  assert.throws(() => db.prepare(
    "INSERT INTO preferences (user_id, type, enabled, updated_at) VALUES ('ghost', 'new_like', 0, 'x')",
  ).run(), /FOREIGN KEY/);
});

test('transaction rolls back on error', () => {
  const db = openDb(':memory:');
  assert.throws(() => transaction(db, () => {
    db.prepare("INSERT INTO users (id, name, created_at, updated_at) VALUES ('a', 'A', 'x', 'x')").run();
    throw new Error('boom');
  }), /boom/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

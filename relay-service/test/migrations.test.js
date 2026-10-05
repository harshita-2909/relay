// A database created by the Part A version upgrades in place, keeping its data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db/db.js';

test('a version-1 database is migrated without losing notifications or records', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-mig-'));
  const file = join(dir, 'relay.db');

  // Build an old-style database by hand: schema.sql only, as Part A shipped.
  const old = new DatabaseSync(file);
  old.exec(readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  old.exec(`
    INSERT INTO users VALUES ('asha', 'Asha', 'x', 'x'), ('rahul', 'Rahul', 'x', 'x');
    INSERT INTO notification_templates VALUES
      ('new_comment', 'New comment', 'd', '{actor} commented on your post: ''{comment}''', '["actor"]', 1, 'x');
    INSERT INTO events (id, type, actor_id, payload, status, received_at)
      VALUES (1, 'comment.created', 'rahul',
        '{"type":"comment.created","actor":{"id":"rahul","name":"Rahul"},"data":{"post":{"id":1,"author":{"id":"asha","name":"Asha"}},"comment":{"id":1,"text":"Old"}}}',
        'processed', '2026-10-01T00:00:00.000Z');
    INSERT INTO notifications (id, recipient_id, event_id, type, actor_id, body, created_at)
      VALUES (1, 'asha', 1, 'new_comment', 'rahul', 'Rahul commented on your post: ''Old''', '2026-10-01T00:00:00.000Z');
    INSERT INTO notification_records (event_id, recipient_id, type, outcome, reason_code, reason, notification_id, created_at)
      VALUES (1, 'asha', 'new_comment', 'delivered', 'delivered', 'Delivered.', 1, '2026-10-01T00:00:00.000Z');
  `);
  old.close();

  const db = openDb(file);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); }); // close first: Windows locks open files
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  const api = request(createApp(db));

  const inbox = (await api.get('/api/users/asha/inbox').expect(200)).body;
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].body, "Rahul commented on your post: 'Old'");
  assert.deepEqual(inbox.items[0].actorIds, ['rahul']);
  assert.equal(inbox.unreadCount, 1);

  const record = (await api.get('/api/events/1').expect(200)).body;
  assert.equal(record.results[0].reason, 'Delivered.');
  assert.equal(record.description, "Rahul commented on Asha's post");

  const templates = (await api.get('/api/templates').expect(200)).body.templates;
  assert.ok(templates.some((tpl) => tpl.type === 'new_post'), 'new types are seeded');
  assert.equal(templates.find((tpl) => tpl.type === 'new_comment').groupWindowMinutes, 60);
});

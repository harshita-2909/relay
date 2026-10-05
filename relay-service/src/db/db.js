import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrations.js';
import { seedTemplates } from './seed.js';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Open (and if needed create, migrate + seed) a Relay database. Use ':memory:' for tests. */
export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA); // version 1
  migrate(db);
  seedTemplates(db);
  return db;
}

/** Run fn inside a transaction; rolls back if it throws. */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** The one source of "now", so tests can move time (grouping windows, snooze expiry). */
export const clock = { now: () => new Date() };
export const nowIso = () => clock.now().toISOString();

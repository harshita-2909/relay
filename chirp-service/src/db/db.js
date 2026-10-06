import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { seed } from './seed.js';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Open (and if needed create + seed) the Chirp database. Use ':memory:' for tests. */
export function openDb(path, { seedData = true } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  if (seedData) seed(db);
  return db;
}

export const nowIso = () => new Date().toISOString();


// Deletes the Chirp database so the next start begins from the seeded people and post.
import { rmSync } from 'node:fs';
import { DB_PATH } from '../config.js';

for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
console.log(`Chirp database reset (${DB_PATH})`);

// Deletes the Relay database so the next start begins from the seeded defaults.
import { rmSync } from 'node:fs';
import { DB_PATH } from '../config.js';

for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
console.log(`Relay database reset (${DB_PATH})`);

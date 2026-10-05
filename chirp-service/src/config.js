import { fileURLToPath } from 'node:url';

export const PORT = Number(process.env.CHIRP_PORT ?? 4001);
export const RELAY_URL = process.env.RELAY_URL ?? 'http://localhost:4000';
export const DB_PATH = process.env.CHIRP_DB_PATH
  ?? fileURLToPath(new URL('../data/chirp.db', import.meta.url));

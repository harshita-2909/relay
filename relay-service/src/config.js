import { fileURLToPath } from 'node:url';

export const PORT = Number(process.env.RELAY_PORT ?? 4000);
export const DB_PATH = process.env.RELAY_DB_PATH
  ?? fileURLToPath(new URL('../data/relay.db', import.meta.url));

import { createApp } from './app.js';
import { DB_PATH, PORT, RELAY_URL } from './config.js';
import { openDb } from './db/db.js';
import { createRelayClient } from './relayClient.js';

const db = openDb(DB_PATH);
const relay = createRelayClient({ baseUrl: RELAY_URL });

const server = createApp(db, relay).listen(PORT, () => {
  console.log(`Chirp listening on http://localhost:${PORT} (db: ${DB_PATH}, relay: ${RELAY_URL})`);
});
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Port ${PORT} is already in use. Is Chirp already running? Stop it, or set CHIRP_PORT to use another port.`);
  process.exit(1);
});

// Introduce Chirp's people to Relay. Relay may start after Chirp (or not at all), so keep
// trying quietly in the background; Chirp works either way.
const users = db.prepare('SELECT id, name FROM users').all();
const register = async (attempt = 1) => {
  try {
    await relay.registerUsers(users);
    console.log(`[chirp] Registered ${users.length} people with Relay`);
  } catch {
    if (attempt === 1) console.log('[chirp] Relay not reachable yet; will keep trying to register people in the background');
    setTimeout(() => register(attempt + 1), Math.min(10_000, 1000 * attempt)).unref();
  }
};
register();

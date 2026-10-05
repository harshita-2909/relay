import { createApp } from './app.js';
import { DB_PATH, PORT } from './config.js';
import { openDb } from './db/db.js';

const db = openDb(DB_PATH);
const server = createApp(db).listen(PORT, () => {
  console.log(`Relay listening on http://localhost:${PORT} (db: ${DB_PATH})`);
});
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Port ${PORT} is already in use. Is Relay already running? Stop it, or set RELAY_PORT to use another port.`);
  process.exit(1);
});

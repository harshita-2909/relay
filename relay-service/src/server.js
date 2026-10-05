import { createApp } from './app.js';
import { DB_PATH, PORT } from './config.js';
import { openDb } from './db/db.js';

const db = openDb(DB_PATH);
createApp(db).listen(PORT, () => {
  console.log(`Relay listening on http://localhost:${PORT} (db: ${DB_PATH})`);
});

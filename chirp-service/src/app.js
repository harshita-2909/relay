import express from 'express';
import { chirpRouter } from './routes.js';

export function createApp(db, relay) {
  const app = express();
  app.use(express.json({ limit: '50kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'chirp', relayUrl: relay.baseUrl }));
  app.use('/api', chirpRouter(db, relay));

  app.use((req, res) => res.status(404).json({ error: { code: 'not_found', message: `No such endpoint: ${req.method} ${req.path}` } }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'invalid_json', message: 'The request body is not valid JSON.' } });
    }
    console.error(err);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong inside Chirp.' } });
  });

  return app;
}

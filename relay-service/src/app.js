import express from 'express';
import { eventsRouter, eventTypesHandler } from './routes/events.js';
import { sendError } from './routes/errors.js';
import { templatesRouter } from './routes/templates.js';
import { usersRouter } from './routes/users.js';

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'relay' }));
  app.get('/api/event-types', eventTypesHandler);
  app.use('/api/events', eventsRouter(db));
  app.use('/api/templates', templatesRouter(db));
  app.use('/api/users', usersRouter(db));

  app.use((req, res) => sendError(res, 404, 'not_found', `No such endpoint: ${req.method} ${req.path}`));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return sendError(res, 400, 'invalid_json', 'The request body is not valid JSON.');
    }
    if (err.type === 'entity.too.large') {
      return sendError(res, 413, 'payload_too_large', 'The request body is too large.');
    }
    console.error(err);
    return sendError(res, 500, 'internal_error', 'Something went wrong inside Relay.');
  });

  return app;
}

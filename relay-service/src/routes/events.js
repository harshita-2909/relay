import { Router } from 'express';
import { processEvent, summarise } from '../engine/processEvent.js';
import { EVENT_TYPES, KNOWN_EVENT_TYPES } from '../rules/eventTypes.js';
import { sendError } from './errors.js';

export function eventsRouter(db) {
  const router = Router();

  // The one call an app makes: "this happened".
  router.post('/', (req, res) => {
    const result = processEvent(db, req.body);
    if (result.status === 'rejected') {
      return res.status(422).json({ eventId: result.eventId, status: 'rejected', error: result.error });
    }
    return res.status(201).json(result);
  });

  // Records: what happened, who was notified, who was skipped and why.
  router.get('/', (req, res) => {
    const limit = clamp(Number(req.query.limit) || 50, 1, 200);
    const where = [];
    const params = [];
    if (req.query.status) { where.push('e.status = ?'); params.push(String(req.query.status)); }
    if (req.query.type) { where.push('e.type = ?'); params.push(String(req.query.type)); }
    if (req.query.recipientId) {
      where.push('EXISTS (SELECT 1 FROM notification_records r WHERE r.event_id = e.id AND r.recipient_id = ?)');
      params.push(String(req.query.recipientId));
    }
    const rows = db.prepare(`
      SELECT e.* FROM events e
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY e.received_at DESC, e.id DESC LIMIT ?
    `).all(...params, limit);
    res.json({ events: rows.map((row) => toRecord(db, row)) });
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id));
    if (!row) return sendError(res, 404, 'event_not_found', `There is no event with id ${req.params.id}.`);
    return res.json(toRecord(db, row));
  });

  return router;
}

export function eventTypesHandler(_req, res) {
  res.json({
    eventTypes: KNOWN_EVENT_TYPES.map((type) => ({
      type,
      description: EVENT_TYPES[type].description,
      fields: EVENT_TYPES[type].fields,
      notificationTypes: EVENT_TYPES[type].rules.map((r) => r.type),
    })),
  });
}

function toRecord(db, row) {
  const payload = JSON.parse(row.payload);
  const base = {
    id: row.id,
    type: row.type,
    actorId: row.actor_id,
    status: row.status,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    payload,
  };
  if (row.status === 'rejected') {
    return { ...base, description: 'Rejected', summary: row.error, error: { code: row.error_code, message: row.error }, results: [] };
  }

  const results = db.prepare(`
    SELECT r.*, u.name AS recipient_name, t.label AS type_label
    FROM notification_records r
    JOIN users u ON u.id = r.recipient_id
    JOIN notification_templates t ON t.type = r.type
    WHERE r.event_id = ? ORDER BY r.id
  `).all(row.id).map((r) => ({
    recipient: { id: r.recipient_id, name: r.recipient_name },
    type: r.type,
    typeLabel: r.type_label,
    outcome: r.outcome,
    reasonCode: r.reason_code,
    reason: r.reason,
    notificationId: r.notification_id,
  }));

  return {
    ...base,
    description: EVENT_TYPES[row.type]?.describe(payload) ?? row.type,
    summary: summarise(results),
    results,
  };
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

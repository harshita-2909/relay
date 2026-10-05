// The Relay pipeline: activity → recipients → content → preferences → inbox, with a record
// of every decision. Everything for one event happens in a single transaction.
import { nowIso, transaction } from '../db/db.js';
import { EVENT_TYPES } from '../rules/eventTypes.js';
import { getTemplate, isEnabled, upsertUser } from '../store.js';
import { render } from './render.js';
import { EventRejected, validateEvent } from './validate.js';

/**
 * Process one reported event.
 * Returns { status: 'processed', eventId, summary, results } or
 *         { status: 'rejected',  eventId, error: { code, message, details } }.
 */
export function processEvent(db, body) {
  const receivedAt = nowIso();

  let event;
  try {
    event = validateEvent(body);
  } catch (err) {
    if (!(err instanceof EventRejected)) throw err;
    const eventId = saveRejected(db, body, err, receivedAt);
    return { status: 'rejected', eventId, error: { code: err.code, message: err.message, details: err.details } };
  }

  return transaction(db, () => deliver(db, event, receivedAt));
}

function saveRejected(db, body, err, receivedAt) {
  const type = typeof body?.type === 'string' ? body.type : null;
  const actorId = body?.actor?.id != null ? String(body.actor.id) : null;
  return Number(db.prepare(`
    INSERT INTO events (type, actor_id, payload, status, error_code, error, received_at)
    VALUES (?, ?, ?, 'rejected', ?, ?, ?)
  `).run(type, actorId, JSON.stringify(body ?? null), err.code, err.message, receivedAt).lastInsertRowid);
}

function deliver(db, event, now) {
  const def = EVENT_TYPES[event.type];
  const { actor } = event;

  upsertUser(db, actor, now);
  const eventId = Number(db.prepare(`
    INSERT INTO events (type, actor_id, payload, status, occurred_at, received_at)
    VALUES (?, ?, ?, 'processed', ?, ?)
  `).run(event.type, actor.id, JSON.stringify(event), event.occurredAt ?? now, now).lastInsertRowid);

  // 1. Who should hear about it. Each person keeps the rules that matched them, in priority order.
  const candidates = new Map();
  for (const rule of def.rules) {
    for (const person of rule.recipients(event)) {
      if (!candidates.has(person.id)) candidates.set(person.id, { person, rules: [] });
      candidates.get(person.id).rules.push(rule);
    }
  }

  const insertNotification = db.prepare(`
    INSERT INTO notifications (recipient_id, event_id, type, actor_id, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertRecord = db.prepare(`
    INSERT INTO notification_records
      (event_id, recipient_id, type, outcome, reason_code, reason, notification_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const results = [];
  for (const { person, rules } of candidates.values()) {
    upsertUser(db, person, now);
    const labels = rules.map((r) => getTemplate(db, r.type).label);
    let outcome;

    if (person.id === actor.id) {
      // 2. Never notify people about their own actions.
      outcome = {
        type: rules[0].type, outcome: 'skipped', reasonCode: 'self_action',
        reason: `${person.name} did this themselves, and people are never notified about their own actions.`,
      };
    } else {
      // 3. Respect preferences: use the highest-priority type this person still accepts.
      const chosen = rules.findIndex((r) => isEnabled(db, person.id, r.type));
      if (chosen === -1) {
        outcome = {
          type: rules[0].type, outcome: 'skipped', reasonCode: 'preference_off',
          reason: `${person.name} has turned off ${joinLabels(labels)} notifications.`,
        };
      } else {
        // 4. Write the words and put it in their inbox.
        const rule = rules[chosen];
        const template = getTemplate(db, rule.type);
        const body = render(template.template, { actor: actor.name, recipient: person.name, ...rule.vars(event) });
        const notificationId = Number(
          insertNotification.run(person.id, eventId, rule.type, actor.id, body, now).lastInsertRowid,
        );
        outcome = {
          type: rule.type, outcome: 'delivered', reasonCode: 'delivered', notificationId, body,
          reason: deliveredReason(person.name, labels, chosen),
        };
      }
    }

    insertRecord.run(eventId, person.id, outcome.type, outcome.outcome, outcome.reasonCode, outcome.reason,
      outcome.notificationId ?? null, now);
    results.push({ recipient: person, ...outcome });
  }

  return {
    status: 'processed',
    eventId,
    description: def.describe(event),
    summary: summarise(results),
    results,
  };
}

function deliveredReason(name, labels, chosen) {
  let reason = `Delivered to ${name}'s inbox as a ${labels[chosen]} notification.`;
  if (chosen > 0) {
    reason += ` (${name} has turned off ${joinLabels(labels.slice(0, chosen))} notifications.)`;
  } else if (labels.length > 1) {
    reason += ` ${name} also qualified for ${joinLabels(labels.slice(1))}, but gets only one notification per activity.`;
  }
  return reason;
}

const joinLabels = (labels) => {
  const quoted = labels.map((l) => `"${l}"`);
  return quoted.length <= 1 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
};

export function summarise(results) {
  const delivered = results.filter((r) => r.outcome === 'delivered').length;
  const skipped = results.length - delivered;
  if (results.length === 0) return 'Nobody needed to hear about this.';
  return `Notified ${delivered}, skipped ${skipped}.`;
}

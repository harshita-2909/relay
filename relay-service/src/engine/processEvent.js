// The Relay pipeline: activity → recipients → content → preferences → inbox, with a record
// of every decision. Everything for one event happens in a single transaction.
import { nowIso, transaction } from '../db/db.js';
import { EVENT_TYPES } from '../rules/eventTypes.js';
import { activeSnooze, getTemplate, isEnabled, isMuted, upsertUser } from '../store.js';
import { putInInbox } from './inbox.js';
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

  const insertRecord = db.prepare(`
    INSERT INTO notification_records
      (event_id, recipient_id, type, outcome, reason_code, reason, notification_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const results = [];
  for (const { person, rules } of candidates.values()) {
    upsertUser(db, person, now);
    const outcome = person.id === actor.id
      ? {
        // 2. Never notify people about their own actions.
        type: rules[0].type, outcome: 'skipped', reasonCode: 'self_action',
        reason: `${person.name} did this themselves, and people are never notified about their own actions.`,
      }
      : decide(db, { person, rules, event, eventId, now });

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

function decide(db, { person, rules, event, eventId, now }) {
  const name = person.name;
  const label = (rule) => getTemplate(db, rule.type).label;

  // 3. Respect choices: the highest-priority type this person accepts and hasn't muted.
  const checks = rules.map((rule) => {
    const subject = rule.subject?.(event) ?? null;
    if (!isEnabled(db, person.id, rule.type)) return { rule, subject, blocked: 'preference_off' };
    if (subject && !rule.bypassMute && isMuted(db, person.id, subject)) return { rule, subject, blocked: 'muted' };
    return { rule, subject };
  });
  const chosen = checks.findIndex((c) => !c.blocked);

  if (chosen === -1) {
    const muted = checks.some((c) => c.blocked === 'muted');
    return {
      type: rules[0].type,
      outcome: 'skipped',
      reasonCode: muted ? 'muted' : 'preference_off',
      reason: blockedReasons(name, checks, label),
    };
  }

  // 4. Write the words and put it in their inbox — now, or when their snooze ends.
  const { rule, subject } = checks[chosen];
  const snoozedUntil = activeSnooze(db, person.id, now);
  const placed = putInInbox(db, {
    recipient: person, actor: event.actor, eventId, rule, event, subject, now,
    visibleAt: snoozedUntil ?? now, held: !!snoozedUntil,
  });

  let reason;
  if (snoozedUntil) {
    reason = `Held: ${name} is snoozing until ${formatTime(snoozedUntil)}, so this "${label(rule)}" notification will appear in their inbox then.`;
  } else if (placed.grouped) {
    reason = `Combined into ${name}'s existing "${label(rule)}" notification (now ${placed.actorCount} ${placed.actorCount === 1 ? 'person' : 'people'}); it is unread again.`;
  } else {
    reason = `Delivered to ${name}'s inbox as a ${label(rule)} notification.`;
  }
  if (chosen > 0) {
    reason += ` (${blockedReasons(name, checks.slice(0, chosen), label).replace(/\.$/, '')}.)`;
  } else if (rules.length > 1) {
    reason += ` ${name} also qualified for ${joinLabels(rules.slice(1).map(label))}, but gets only one notification per activity.`;
  }

  return {
    type: rule.type,
    outcome: snoozedUntil ? 'held' : 'delivered',
    reasonCode: snoozedUntil ? 'snoozed' : placed.grouped ? 'grouped' : 'delivered',
    notificationId: placed.notificationId,
    body: placed.body,
    reason,
  };
}

function blockedReasons(name, checks, label) {
  const off = checks.filter((c) => c.blocked === 'preference_off').map((c) => label(c.rule));
  const muted = checks.filter((c) => c.blocked === 'muted');
  const parts = [];
  if (off.length) parts.push(`${name} has turned off ${joinLabels(off)} notifications`);
  if (muted.length) parts.push(`${name} muted notifications about this ${muted[0].subject.split(':')[0]}`);
  return `${parts.join(', and ')}.`;
}

// Local time is right here: Relay runs on the same machine as the people reading the records.
const formatTime = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

const joinLabels = (labels) => {
  const quoted = labels.map((l) => `"${l}"`);
  return quoted.length <= 1 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
};

export function summarise(results) {
  if (results.length === 0) return 'Nobody needed to hear about this.';
  const count = (o) => results.filter((r) => r.outcome === o).length;
  const held = count('held');
  return `Notified ${count('delivered')}, ${held ? `held ${held}, ` : ''}skipped ${count('skipped')}.`;
}

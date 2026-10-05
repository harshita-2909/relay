import { EVENT_TYPES, KNOWN_EVENT_TYPES } from '../rules/eventTypes.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => (typeof v === 'string' && v.trim() !== '') || Number.isInteger(v);
const isPerson = (v) => isObject(v) && isId(v.id) && typeof v.name === 'string' && v.name.trim() !== '';

const KINDS = {
  id: { check: isId, hint: 'a non-empty string or integer id' },
  string: { check: (v) => typeof v === 'string', hint: 'a string' },
  person: { check: isPerson, hint: 'a person: {"id": ..., "name": "..."}' },
  people: { check: (v) => Array.isArray(v) && v.every(isPerson), hint: 'a list of people: [{"id": ..., "name": "..."}]' },
};

const get = (obj, path) => path.split('.').reduce((v, key) => (isObject(v) ? v[key] : undefined), obj);

export class EventRejected extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/**
 * Check an incoming event. Returns a normalised copy (ids as strings, mentions de-duplicated)
 * or throws EventRejected with a plain-language explanation.
 */
export function validateEvent(body) {
  if (!isObject(body)) {
    throw new EventRejected('invalid_event', 'An event must be a JSON object like {"type": ..., "actor": ..., "data": ...}.');
  }
  if (typeof body.type !== 'string' || body.type.trim() === '') {
    throw new EventRejected('invalid_event', `Every event needs a "type". Relay understands: ${KNOWN_EVENT_TYPES.join(', ')}.`);
  }
  const def = EVENT_TYPES[body.type];
  if (!def) {
    throw new EventRejected('unknown_event_type',
      `Relay doesn't recognise the event type "${body.type}", so nobody was notified. `
      + `Relay understands: ${KNOWN_EVENT_TYPES.join(', ')}.`);
  }

  const problems = [];
  if (!isPerson(body.actor)) problems.push(`"actor" must be ${KINDS.person.hint}`);
  if (!isObject(body.data)) problems.push('"data" must be an object');
  if (body.occurredAt !== undefined && Number.isNaN(Date.parse(body.occurredAt))) {
    problems.push('"occurredAt" must be an ISO date-time if given');
  }
  if (isObject(body.data)) {
    for (const [path, spec] of Object.entries(def.fields)) {
      const optional = spec.endsWith('?');
      const kind = KINDS[spec.replace('?', '')];
      const value = get(body, path);
      if (value === undefined || value === null) {
        if (!optional) problems.push(`"${path}" is required (${kind.hint})`);
      } else if (!kind.check(value)) {
        problems.push(`"${path}" must be ${kind.hint}`);
      }
    }
  }
  if (problems.length) {
    throw new EventRejected('invalid_event',
      `This "${body.type}" event is missing information Relay needs: ${problems.join('; ')}.`, problems);
  }

  return normalise(body);
}

// Ids become strings everywhere, names are trimmed, and mention lists are de-duplicated.
function normalise(body) {
  const fix = (v) => {
    if (isPerson(v)) return { ...v, id: String(v.id), name: v.name.trim() };
    if (Array.isArray(v) && v.every(isPerson)) {
      const seen = new Map();
      for (const p of v) seen.set(String(p.id), fix(p));
      return [...seen.values()];
    }
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
    return v;
  };
  return fix(body);
}

// Putting a notification into someone's inbox — either a new one, or folded into a similar
// recent one (B3 grouping), and either visible now or held until a snooze ends (B5).
import { getTemplate, namesOf } from '../store.js';
import { render } from './render.js';

/** "Rahul" · "Rahul and Meera" · "Rahul and 4 others" (most recent first). */
export function actorPhrase(names) {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}

/**
 * @returns {{ notificationId, body, grouped: boolean, actorCount: number }}
 */
export function putInInbox(db, { recipient, actor, eventId, rule, event, subject, visibleAt, held, now }) {
  const template = getTemplate(db, rule.type);
  const vars = { ...rule.vars(event), recipient: recipient.name };
  const groupKey = template.groupWindowMinutes && subject ? `${rule.type}|${subject}` : null;

  if (groupKey) {
    const since = new Date(Date.parse(now) - template.groupWindowMinutes * 60_000).toISOString();
    // Fold into a recent similar notification. While snoozing, only into one that is also
    // being held — never pull an already-visible notification back out of sight.
    const existing = db.prepare(`
      SELECT * FROM notifications
      WHERE recipient_id = ? AND group_key = ? AND updated_at >= ?
        AND ${held ? 'visible_at > ?' : 'visible_at <= ?'}
      ORDER BY updated_at DESC, id DESC LIMIT 1
    `).get(recipient.id, groupKey, since, now);

    if (existing) {
      const actorIds = [actor.id, ...JSON.parse(existing.actor_ids ?? '[]').filter((id) => id !== actor.id)];
      const body = render(template.template, { ...vars, actor: actorPhrase(namesOf(db, actorIds)) });
      // More activity: new words, back to unread, back to the top of the inbox.
      db.prepare(`
        UPDATE notifications
        SET body = ?, actor_id = ?, actor_ids = ?, activity_count = activity_count + 1, event_id = ?,
            read_at = NULL, updated_at = ?, visible_at = ?
        WHERE id = ?
      `).run(body, actor.id, JSON.stringify(actorIds), eventId, now, visibleAt, existing.id);
      return { notificationId: existing.id, body, grouped: true, actorCount: actorIds.length };
    }
  }

  const body = render(template.template, { ...vars, actor: actor.name });
  const notificationId = Number(db.prepare(`
    INSERT INTO notifications
      (recipient_id, event_id, type, subject, group_key, actor_id, actor_ids, body,
       created_at, updated_at, visible_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(recipient.id, eventId, rule.type, subject, groupKey, actor.id, JSON.stringify([actor.id]), body,
    now, now, visibleAt).lastInsertRowid);
  return { notificationId, body, grouped: false, actorCount: 1 };
}

// Default wording for each notification type. Inserted only if missing, so the
// content owner's edits survive restarts.
export const DEFAULT_TEMPLATES = [
  {
    type: 'mention',
    label: 'Mention',
    description: 'Someone mentioned you with @name in a post or comment.',
    template: "{actor} mentioned you in a {context}: '{text}'",
    variables: ['actor', 'recipient', 'context', 'text'],
    defaultEnabled: true,
  },
  {
    type: 'new_comment',
    label: 'New comment',
    description: 'Someone commented on your post.',
    template: "{actor} commented on your post: '{comment}'",
    variables: ['actor', 'recipient', 'comment', 'post'],
    defaultEnabled: true,
  },
  {
    type: 'new_like',
    label: 'New like',
    description: 'Someone liked your post.',
    template: "{actor} liked your post: '{post}'",
    variables: ['actor', 'recipient', 'post'],
    defaultEnabled: true,
  },
  {
    type: 'new_follower',
    label: 'New follower',
    description: 'Someone started following you.',
    template: '{actor} started following you',
    variables: ['actor', 'recipient'],
    defaultEnabled: true,
  },
];

export function seedTemplates(db, now = new Date().toISOString()) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO notification_templates
      (type, label, description, template, variables, default_enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const t of DEFAULT_TEMPLATES) {
    insert.run(t.type, t.label, t.description, t.template, JSON.stringify(t.variables),
      t.defaultEnabled ? 1 : 0, now);
  }
}

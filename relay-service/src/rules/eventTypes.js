// The kinds of activity Relay understands, and who should hear about each.
//
// This is generic social-app vocabulary, not Chirp code: any app that reports these
// events (with people as {id, name}) gets notifications without Relay changing.
//
// `fields` describes the payload. Kinds: 'id', 'string', 'person' ({id, name}),
// 'people' (array of persons). A trailing '?' marks the field optional.
//
// `rules` are listed in priority order. A person matched by several rules for the same
// event gets ONE notification: the first rule whose type they haven't switched off.
// `vars` supplies the template blanks for that notification type.

const excerpt = (text, max = 60) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

export const EVENT_TYPES = {
  'post.created': {
    description: 'Someone wrote a post.',
    fields: {
      'data.post.id': 'id',
      'data.post.text': 'string',
      'data.mentions': 'people?',
    },
    describe: (e) => `${e.actor.name} wrote a post`,
    rules: [
      {
        type: 'mention',
        recipients: (e) => e.data.mentions ?? [],
        vars: (e) => ({ context: 'post', text: excerpt(e.data.post.text) }),
      },
    ],
  },

  'comment.created': {
    description: "Someone commented on a post.",
    fields: {
      'data.post.id': 'id',
      'data.post.author': 'person',
      'data.post.text': 'string?',
      'data.comment.id': 'id',
      'data.comment.text': 'string',
      'data.mentions': 'people?',
    },
    describe: (e) => `${e.actor.name} commented on ${e.data.post.author.name}'s post`,
    rules: [
      {
        type: 'mention',
        recipients: (e) => e.data.mentions ?? [],
        vars: (e) => ({ context: 'comment', text: excerpt(e.data.comment.text) }),
      },
      {
        type: 'new_comment',
        recipients: (e) => [e.data.post.author],
        vars: (e) => ({ comment: excerpt(e.data.comment.text), post: excerpt(e.data.post.text) }),
      },
    ],
  },

  'post.liked': {
    description: 'Someone liked a post.',
    fields: {
      'data.post.id': 'id',
      'data.post.author': 'person',
      'data.post.text': 'string?',
    },
    describe: (e) => `${e.actor.name} liked ${e.data.post.author.name}'s post`,
    rules: [
      {
        type: 'new_like',
        recipients: (e) => [e.data.post.author],
        vars: (e) => ({ post: excerpt(e.data.post.text) }),
      },
    ],
  },

  'user.followed': {
    description: 'Someone started following another person.',
    fields: {
      'data.followee': 'person',
    },
    describe: (e) => `${e.actor.name} followed ${e.data.followee.name}`,
    rules: [
      {
        type: 'new_follower',
        recipients: (e) => [e.data.followee],
        vars: () => ({}),
      },
    ],
  },
};

export const KNOWN_EVENT_TYPES = Object.keys(EVENT_TYPES).sort();

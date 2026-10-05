// The kinds of activity Relay understands, and who should hear about each.
//
// This is generic social-app vocabulary, not Chirp code: any app that reports these
// events (with people as {id, name}) gets notifications without Relay changing.
//
// `fields` describes the payload. Kinds: 'id', 'string', 'person' ({id, name}),
// 'people' (array of persons). A trailing '?' marks the field optional.
//
// `rules` are listed in priority order. A person matched by several rules for the same
// event gets ONE notification: the first rule whose type they accept (and haven't muted).
// - `vars` supplies the template blanks for that notification type.
// - `subject` names the thing the notification is about ("post:12", "user:asha"). People
//   can mute a subject, and similar notifications about the same subject can be grouped.
// - `bypassMute` lets a rule through even when its subject is muted (direct @mentions).

const excerpt = (text, max = 60) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const postSubject = (e) => `post:${e.data.post.id}`;

export const EVENT_TYPES = {
  'post.created': {
    description: 'Someone wrote a post. Followers (if given) hear about it; mentioned people get a mention.',
    fields: {
      'data.post.id': 'id',
      'data.post.text': 'string',
      'data.mentions': 'people?',
      'data.followers': 'people?',
    },
    describe: (e) => `${e.actor.name} wrote a post`,
    rules: [
      {
        type: 'mention',
        recipients: (e) => e.data.mentions ?? [],
        subject: postSubject,
        bypassMute: true,
        vars: (e) => ({ context: 'post', text: excerpt(e.data.post.text) }),
      },
      {
        type: 'new_post',
        recipients: (e) => e.data.followers ?? [],
        subject: postSubject,
        vars: (e) => ({ post: excerpt(e.data.post.text) }),
      },
    ],
  },

  'comment.created': {
    description: 'Someone commented on a post.',
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
        subject: postSubject,
        bypassMute: true,
        vars: (e) => ({ context: 'comment', text: excerpt(e.data.comment.text) }),
      },
      {
        type: 'new_comment',
        recipients: (e) => [e.data.post.author],
        subject: postSubject,
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
        subject: postSubject,
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
        subject: (e) => `user:${e.data.followee.id}`,
        vars: () => ({}),
      },
    ],
  },

  'user.unfollowed': {
    description: 'Someone stopped following another person. Recorded; nobody is notified.',
    fields: {
      'data.followee': 'person',
    },
    describe: (e) => `${e.actor.name} unfollowed ${e.data.followee.name}`,
    rules: [],
  },
};

export const KNOWN_EVENT_TYPES = Object.keys(EVENT_TYPES).sort();

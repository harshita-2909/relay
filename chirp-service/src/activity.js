// Turns Chirp actions into "what happened" reports, in the vocabulary Relay understands.
// These describe facts only — no recipients, no wording, no preferences.

const person = (u) => ({ id: u.id, name: u.name });

export const postCreated = (actor, post, mentions) => ({
  type: 'post.created',
  actor: person(actor),
  occurredAt: post.createdAt,
  data: { post: { id: post.id, text: post.text }, mentions: mentions.map(person) },
});

export const commentCreated = (actor, post, postAuthor, comment, mentions) => ({
  type: 'comment.created',
  actor: person(actor),
  occurredAt: comment.createdAt,
  data: {
    post: { id: post.id, text: post.text, author: person(postAuthor) },
    comment: { id: comment.id, text: comment.text },
    mentions: mentions.map(person),
  },
});

export const postLiked = (actor, post, postAuthor, likedAt) => ({
  type: 'post.liked',
  actor: person(actor),
  occurredAt: likedAt,
  data: { post: { id: post.id, text: post.text, author: person(postAuthor) } },
});

export const userFollowed = (actor, followee, followedAt) => ({
  type: 'user.followed',
  actor: person(actor),
  occurredAt: followedAt,
  data: { followee: person(followee) },
});

// Turns Chirp actions into "what happened" reports, in the vocabulary Relay understands.
// These describe facts only — no recipients, no wording, no preferences.

const person = (u) => ({ id: u.id, name: u.name });

// Chirp knows who follows whom, so it says who the author's followers are at the moment
// of posting. Relay decides whether and how to tell them.
export const postCreated = (actor, post, mentions, followers) => ({
  type: 'post.created',
  actor: person(actor),
  occurredAt: post.createdAt,
  data: { post: { id: post.id, text: post.text }, mentions: mentions.map(person), followers: followers.map(person) },
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

export const userUnfollowed = (actor, followee, unfollowedAt) => ({
  type: 'user.unfollowed',
  actor: person(actor),
  occurredAt: unfollowedAt,
  data: { followee: person(followee) },
});

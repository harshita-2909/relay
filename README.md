# Relay + Chirp

**Chirp** is a pretend social app where made-up people (Asha, Rahul, Meera, Dev) post, comment, like, @mention and follow each other. **Relay** is a separate notification service: Chirp only reports *what happened*, and Relay decides who to tell, what to say, whether each person wants it, puts it in their inbox, and records every decision.

Everything runs locally: Node.js + Express, SQLite (Node's built-in `node:sqlite`), React (Vite). No accounts, no external services.

## Run it

Requires **Node.js 22.13+** (built and tested on Node 24).

```bash
npm install
npm start          # Relay :4000, Chirp :4001, web UI → http://localhost:5173
```

`npm start` runs all three directly with Node, so it works in any terminal (no shell tools needed). Ctrl+C stops everything.

| Command | What it does |
|---|---|
| `npm test` | Relay (70) and Chirp (12) test suites, including end-to-end runs of the story below |
| `npm run reset` | Wipe both databases back to the seeded people, starter post and default wording |
| `RELAY_PORT`, `CHIRP_PORT`, `WEB_PORT` | Override ports if something else is using them |

## Recreate the example (brief §5)

1. **Act as Asha** (top bar) → **Notification settings** → switch **New like** off.
2. **Act as Rahul** → **Feed** → comment `Great photo!` on Asha's sunset post. A toast says Relay notified 1 person.
3. **Act as Meera** → like the post. The toast says 0 notified, 1 skipped. Click **View record**, which reads *Asha has turned off "New like" notifications.*
4. **Act as Asha**. The bell shows **1**. Open **Inbox**, where you'll see *Rahul commented on your post: 'Great photo!'*. Click it: it's marked read and the count drops to 0.

The **Relay console** tabs are the company's view. **Templates** is where the content owner edits wording, and **Records** shows who was notified or skipped, and why, for every activity, including rejected ones. Every inbox item has a **Why?** link to its record.

## How it fits together

```
Browser ──/chirp-api──▶ Chirp :4001 ──POST /api/events──▶ Relay :4000
   └──────/relay-api (inbox, settings, console)─────────────▶┘
```

- **Chirp never creates notifications.** [`relayClient.js`](chirp-service/src/relayClient.js) is the only file that knows Relay exists. Each action is saved in Chirp first, then reported. If Relay is down or slow (2s timeout), the action still succeeds and the UI says the activity went unnotified.
- **Relay never reads Chirp's data.** Everything it knows arrives in events, as people `{id, name}`, post ids and text. The events use generic vocabulary (`post.created`, `comment.created`, `post.liked`, `user.followed`, `user.unfollowed`), so another app could send the same events without Relay changing. The recipient rules live in [`eventTypes.js`](relay-service/src/rules/eventTypes.js).
- **One pipeline, one transaction per event:** validate → recipients → drop the actor → pick one type per person (preferences, mutes) → render the wording → inbox (grouping, snooze) → record.
- Unknown or malformed events get a **422** with a plain-language reason, and are stored as rejected so they appear in Records.

## Optional features built

**B3 Grouping, B4 Followers, B5 Mute and snooze.**

### B3. Grouping
- Notifications **combine** when they're for the same person, of the same type, about the same thing (e.g. likes on post 12). This applies while they keep arriving within a **sliding window**: 60 minutes by default for likes, comments and new followers.
- `{actor}` becomes *Rahul* → *Rahul and Meera* → *Rahul and 4 others* (the most recent person is named first), so one template serves both cases. Each update re-renders the notification, marks it **unread again** and moves it to the top.
- **Mentions and new posts never group.** Each is addressed to you or is individually interesting.
- The content owner can change each type's window, or set it to 0 for never, on the Templates page. A "Combined" preview shows how a grouped notification reads.

### B4. Followers
- Follow and unfollow from the **People** panel or on any post. Being followed creates a notification (and those group: *Dev and 2 others started following you*). Unfollowing is reported and recorded, but notifies nobody.
- When someone posts, **each of their followers gets a "New post" notification**. If a follower is also @mentioned, they get one notification, the mention.
- **Who the followers are:** Chirp includes the author's current followers in the `post.created` event. Chirp owns the follow graph, so Relay never acts on a stale copy, and a follow that happened while Relay was down still counts.
- **Many followers (decision):** everyone who follows you is notified. That's what following means, so there's no cap and no sampling. Fan-out happens on write, in the same transaction as the event: 5,000 followers take about 0.7s end to end in the tests. Each follower can still opt out with the **New post** switch.

  For a real service with very large accounts, I'd keep the same behaviour but move the fan-out off the request path: accept the event, then deliver to followers from a queue in batches. For the very largest accounts I'd switch to fan-out on read, where followers' inboxes pull in new posts when opened, rather than writing millions of rows per post. The event payload would then reference a follower list instead of carrying it.

### B5. Mute and snooze
- **Mute a post** (feed, or from any notification about it). This silences comments, likes and new-post notifications about that post for that person. **A direct @mention still gets through**, because someone addressing you by name is different from a busy thread, which is also how GitHub and Slack treat mutes. Muted posts are listed in Notification settings with Unmute. Records say *Asha muted notifications about this post.*
- **Snooze everything** for 1 minute up to 8 hours (the API allows up to a week). **Decision: activity during a snooze is held, not dropped.** It appears in the inbox, unread, when the snooze ends: automatically at the end time, or immediately if you end it early.

  *Why:* a snooze means "not now", not "never". Dropping things is what preferences and mute are for, and losing a mention because you took a break would be a nasty surprise. Held notifications still group among themselves, so 20 likes during a snooze arrive as one "… and 19 others" notification rather than a flood. They never merge into something already visible, so nothing you've seen vanishes. Records show **Held (snoozed)** with the end time.

## Assumptions and decisions

- **Default preferences:** every type is **on** for new people, and only the changes someone makes are stored. Someone new to an app wants to see activity, and the brief's story has Asha choosing to turn likes off, which implies they start on.
- **One notification per person per activity**, by priority: mention › new comment / new post. If the higher-priority type is switched off, Relay falls back to the next type the person accepts, and the record explains it.
- **People are never notified about their own actions.** When someone is considered and skipped, the record lists them with the reason.
- **Wording is rendered at delivery.** Editing a template changes new notifications only, and old ones keep their words. Grouped notifications re-render with the current wording when they update.
- **No logins** (as the brief says). "A person only ever sees their own inbox" is enforced by scoping every inbox call to one person. Marking someone else's notification read returns 404, just as a missing one would.
- **Liking twice / following twice** are no-ops in Chirp and aren't reported, since nothing new happened. There's no "unlike" (the brief doesn't ask for one).
- **People reach Relay** through events, and Chirp also registers its people on startup, retrying in the background if Relay isn't up yet.
- **Database changes** are versioned migrations (`PRAGMA user_version`), so a Part A database upgrades in place.

## What I'd do next

- **B2 live inbox:** push new notifications and the unread count over Server-Sent Events. Today the inbox refreshes when you switch person, change tab, refocus the window, or a snooze ends.
- **B6 no duplicates:** an idempotency key on events (e.g. `chirp:comment:42`) with a unique index, so a repeated report is recorded once.
- **Delivery off the request path:** move it to a queue with retries, plus an outbox in Chirp so activity reported while Relay is down is sent later instead of going unnotified.
- **Real authentication** for inboxes, and an audit trail for template edits.
- **Retention:** prune old records and notifications.

## Project layout

```
relay-service/   Relay: engine (src/engine), rules (src/rules), routes, SQLite schema + migrations, tests
chirp-service/   Chirp: posts/comments/likes/follows, relayClient.js, tests (incl. end-to-end with Relay)
web/             React UI: Chirp feed, inbox, settings, and the Relay console (templates, records)
scripts/start.js Starts all three with one command
```

## Use of AI tools

This project was built with Claude Code (Anthropic) as a pair programmer. It drafted the architecture, code, tests and this README under my direction and review.

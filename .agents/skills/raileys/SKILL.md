---
name: raileys
description: How to build WhatsApp bots with raileys — the human-readable wrapper over Baileys. Use when code imports "raileys" or "@rzfan03/raileys", calls raileys(, or the user asks for a WhatsApp bot, command bot, auto-reply, media send, group ops, or asks "why doesn't the bot reply".
---

# raileys

raileys is a friendly wrapper around **Baileys** (WhatsApp Web, unofficial). Baileys is the engine; you write the small API. One mental model: **bot + handlers, and a handler's return value IS the reply.**

```ts
import raileys from 'raileys' // scoped: '@rzfan03/raileys'

const bot = raileys('6281234567890', { ping: 'pong' })
// or: raileys({ phone, name, prefix, typing, owner, config: './raileys.config.ts' })
```

- Number filled → pairing-code login printed to terminal. Empty → QR.
- Session persists in `.raileys/<name>/` (name defaults to the script filename). Deleting the folder relinks.
- Reconnects itself with backoff. No `await bot.start()` needed for a running bot; `.start()` exists to await the first connection.

## Return-value rules (both `.cmd()` and `.on()`)

| Handler returns | Effect |
| --- | --- |
| `string` | text |
| `string[]` | several messages, in order |
| `Buffer` | type sniffed from magic bytes → image/video/audio/sticker |
| `{ html }` | small HTML subset → WhatsApp formatting |
| `{ image / video / audio / sticker / document, caption }` | media; Buffer **or http(s) URL** |
| `null` / `undefined` | nothing |

## API cheat sheet

```ts
bot.cmd('ping|p', handler)                              // aliases via |
bot.cmd('kick', { group: true, admin: true }, handler)  // filters: group, admin, owner, media
bot.on('image' | 'text' | 'join' | 'leave' | ..., handler)
bot.use(async (m, next) => { /* ... */; await next() })  // middleware; skip next() = drop
bot.edit(key, newText)                                  // own messages
bot.remove(key)                                         // delete message
bot.sock                                                // raw Baileys — escape hatch
```

On `m` (inbound message):

- Read: `m.text` (body or caption), `m.name`, `m.senderId`, `m.phone`, `m.chatId`, `m.isGroup`, `m.type`, `m.id`, `m.mentions` (JIDs), `m.raw` (WAMessage), `m.quoted`.
- Command fields: `m.command`, `m.args` (joined string), `m.argv` (array).
- Actions: `m.reply(text)` (quote), `m.send(text)`, `m.react('👍')`, `m.read()`, `m.media()` (Buffer download), `m.sticker(webpBuffer)`, `m.kick(jids)`, `m.groupAdd(jids)`, `m.groupInfo()`, `m.leave()`.
- Flows: `await m.ask('Umur?', { validate: /^\d+$/, retry: 'Angka saja' })`; `await m.menu('Pick:', [{ title, run }])`; `m.user.data.x = 1` (per-user JSON storage, persisted).
- HTML subset: `<b> <i> <s> <code> <pre> <br> <a href>` → `*…* _…_ ~…~ ```mono``` \n "text (url)"`. No underline — WhatsApp has none.

## Pitfalls (these cause most "bot doesn't work" reports)

1. **`m.chatId` is the chat's JID, not the message id** — sending to `m.id` fails; reply via `m.reply()` or send to `m.chatId`.
2. **The bot ignores its own messages** (`fromMe`). Test from a second number. No option to enable self-events in v0.2.
3. **Pairing code is bound to the number in `phone`** — mismatch (or an expired code) → WhatsApp rejects the session, raileys erases it and prints hints. Use the real number of the account you link.
4. **`{ admin: true }` requires BOTH** the sender and the bot to be group admins; otherwise the command silently skips.
5. **`.cmd` prefixes are `.`, `!`, `/` by default** — a bare `ping` text is not a command.
6. **`m.ask()` queues one open question per chat+user** — the user's next message resolves it (2 min timeout). Don't `ask()` twice in parallel for the same user.
7. **`m.sticker()` needs a webp Buffer/URL** — no image→webp conversion is bundled (needs ffmpeg).
8. **Broadcast pacing is your job** — WhatsApp throttles fast repeats; keep a few hundred ms between sends.
9. Handlers run without awaiting; an async handler that throws is caught and reported via `onError` (default: console). It does not crash the bot.
10. `status@broadcast` messages never reach handlers.

## When something fails

1. Read the terminal: login, reconnect, and handler errors always print (`[raileys] …`).
2. No reply at all → check pitfalls 2, 3, 5 first.
3. Pairing loop (`Sesi ditolak…`) → erase `.raileys/<name>/`, fix `phone`, run again.
4. Type errors on raileys calls → check the installed `dist/*.d.ts` (source of truth), don't cast away.
5. Media download throws → message must actually carry media (`m.mediaInfo`), and expired media re-requests itself automatically.

## Versions

- `0.2.x` — current: commands/filters/events/middleware, ask/menu/poll, HTML subset, groups, per-user storage, config file.
- Not wrapped yet (use `bot.sock`): poll vote results, profile management, block/unblock, presence subscription, newsletters.
- Package on npm: `@rzfan03/raileys`. The plain `raileys` name on npm is a DIFFERENT, unrelated package — never install it for this.

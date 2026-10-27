# raileys

**Baileys, but human readable and easy to use.**

raileys is a friendly wrapper around [Baileys](https://github.com/WhiskeySockets/Baileys) — the powerful but low-level WhatsApp Web library. All of Baileys' engine work (WebSocket, protobuf, encryption, session files, reconnection) stays underneath; what you see is a small, human-readable API.

```ts
import raileys from 'raileys'

raileys('6281234567890', {
  ping: 'pong',                                  // string = static reply
  'halo|hi': (m) => `Halo ${m.name}!`,           // alias via |
  say: (m) => m.args || 'Kata-katanya mana?',    // return a string → auto reply
})
```

No `await bot.start()`, no auth config, no event plumbing. Phone number filled in → pairing-code login printed to the terminal; left empty → QR.

---

## Install

```sh
npm install raileys
```

Node.js ≥ 20. TypeScript types included; works from plain JavaScript too.

## Quick start

```sh
npx tsx bot.ts
```

First run prints a pairing code:

```
[raileys] Pairing code (WhatsApp → Devices → Link a Device): C20C-41CC
```

Enter it on your phone: **WhatsApp → Linked devices → Link a device → Link with phone number instead**. After that the session is stored in `.raileys/<session-name>/` and survives restarts — you only link once.

## The idea

**A handler's return value is what gets sent.** One rule to remember:

| Return | Effect |
|---|---|
| `string` | send as text |
| `string[]` | send several messages in order |
| `Buffer` | type detected from magic bytes, sent as image/video/audio/sticker |
| `{ html: '<b>hi</b>' }` | small HTML subset rendered as WhatsApp formatting |
| `{ image / video / audio / sticker / document, caption }` | send media (Buffer or http URL) |
| `undefined` / `null` | send nothing |

## Options

```ts
raileys({
  phone: '6281234567890',   // pairing-code login; omit for QR
  name: 'mybot',            // session name → .raileys/mybot/ (default: script filename)
  prefix: ['.', '!', '/'],  // command prefixes (default)
  typing: true,             // show "typing…" while handlers run
  owner: ['6281111111111'], // numbers allowed to use { owner: true } commands
  reconnect: true,          // auto-reconnect with backoff (default)
  quiet: false,             // silence info logs; errors always print
  onError: (err, m) => m?.reply('Oops, try again'), // global handler errors
  config: './raileys.config.ts', // options file; direct options above win over it
})
```

### Config file

Prefer keeping credentials and settings out of the bot source? Export default options from their own file:

```ts
// raileys.config.ts
export default {
  phone: '6281234567890',
  prefix: ['.', '!'],
  owner: ['6281111111111'],
  typing: true,
}
```

```ts
import raileys from 'raileys'

raileys({
  config: './raileys.config.ts', // everything comes from the file…
  name: 'shop',                  // …except what you set here — it wins
})
```

The file is loaded at `start()`; direct options always override it. `.ts` requires running through a TS loader (tsx or Node's native type stripping) — `.mjs`/`.js`/`.json` work everywhere.

## Commands — `.cmd()`

```ts
raileys('6281234567890')
  .cmd('ping|p', 'pong')                                    // aliases via |
  .cmd('say', (m) => m.args || 'Say what?')                 // dynamic reply
  .cmd('kick', { group: true, admin: true }, (m) => m.kick(m.mentions))
  .cmd('sticker', { media: 'image' }, async (m) => m.sticker(await m.media()))
  .cmd('eval', { owner: true }, (m) => String(eval(m.args)))
```

Per-command filters:

| Filter | Meaning |
|---|---|
| `{ group: true }` | only inside groups |
| `{ admin: true }` | sender must be a group admin **and** the bot must be an admin |
| `{ owner: true }` | sender's number is in `options.owner` |
| `{ media: 'image' }` | message must carry this media (accepts an array too) |

Denied commands are skipped silently (bots shouldn't nag). Defaults apply on every prefix: `.ping`, `!ping`, `/ping` are the same command.

## Message object — `m`

| Property / method | Description |
|---|---|
| `m.text` | body text, or the caption on media |
| `m.name`, `m.senderId`, `m.phone` | display name, JID, phone number of the sender |
| `m.chatId`, `m.isGroup`, `m.fromMe`, `m.id` | chat context |
| `m.type` | `text` \| `image` \| `video` \| `audio` \| `sticker` \| `document` \| `location` \| `contact` \| `reaction` \| `poll` |
| `m.command`, `m.args`, `m.argv` | parsed command name / joined args / split args |
| `m.mentions` | JIDs @mentioned in the message |
| `m.raw` | the original Baileys `WAMessage` — full escape hatch |
| `m.reply(text)` | quote-reply; `m.reply(text, { quoted: false })` for plain |
| `m.media()` | download attached media as a `Buffer` |
| `m.react('👍')` | react to the message |
| `m.read()` | mark the message as read |
| `m.html('<b>hi</b>')` | send HTML subset as WhatsApp formatting |
| `m.sticker(webp)` | send a webp Buffer as a sticker |
| `m.poll(question, options)` | official WhatsApp poll |
| `m.menu(title, items)` | numbered menu with automatic routing (below) |
| `m.ask(question)` | multi-step conversation (below) |
| `m.kick(jids)` / `m.groupAdd(jids)` / `m.leave()` / `m.groupInfo()` | group management (bot must be admin) |
| `m.user.data` | per-user storage, persisted to disk (below) |

## Multi-step conversations — `m.ask()`

In raw Baileys a question/answer flow means a hand-rolled state machine. Here:

```ts
daftar: async (m) => {
  const nama = await m.ask('Namamu siapa?')
  const umur = await m.ask('Umur berapa?', {
    validate: /^\d+$/,          // regex or (answer) => boolean
    retry: 'Angka saja ya',     // re-asks on invalid input
  })
  m.user.data.profile = { nama, umur: Number(umur) }
  return `Terdaftar: ${nama} (${umur} th)`
}
```

The next message from that user in that chat becomes the answer (timeout: 2 minutes, default). Questions are queued per chat+user, so two users can register at the same time.

## Per-user storage

`m.user.data` is a plain object persisted to `.raileys/<name>/users/<number>.json` after every handler. No database needed for small bots.

## Menus and polls

```ts
menu: (m) =>
  m.menu('Pick a service:', [
    { title: 'Check balance', run: () => 'Balance: $0 😢' },
    { title: 'Help',          run: () => 'Type .help' },
  ]),  // user replies "1" → run()'s return value is sent automatically

vote: (m) => m.poll('Lunch?', ['Nasi goreng', 'Bakso', 'Mie ayam']),
```

`m.menu()` sends a numbered list and routes the reply — no visual "buttons", which is deliberate: WhatsApp's native button API is unofficial and breaks on every WhatsApp update. Numbered menus work on every client, forever.

## "HTML" in chat

WhatsApp never renders real HTML. raileys converts a small subset to the native formatting every client understands:

```ts
promo: () => ({ html: '<b>PROMO!</b> <i>free shipping</i> until <s>tomorrow</s>' }),
info:  (m) => m.html('<b>Info:</b> type <b>.menu</b> to start'),
// captions accept the same subset: { image: url, caption: '<b>bold</b>' }
```

| HTML | WhatsApp |
|---|---|
| `<b>`, `<strong>` | `*bold*` |
| `<i>`, `<em>` | `_italic_` |
| `<s>`, `<del>`, `<strike>` | `~strike~` |
| `<code>`, `<pre>` | ```` ```monospace``` ```` |
| `<br>` | newline |
| `<a href="url">text</a>` | `text (url)` |

Other tags are stripped; unclosed tags close themselves. `<u>` (underline) doesn't exist in WhatsApp and passes through as plain text.

## Events — `.on()`

```ts
bot.on('text',    (m) => m.text.includes('?') && 'Got a question?')
bot.on('image',   async (m) => { const img = await m.media(); /* ... */ })
bot.on('join',    () => 'Welcome!')   // group participants
bot.on('leave',   () => 'Bye!')
bot.on('poll',    (m) => console.log(`poll created: ${m.text}`))
bot.on('reaction',(m) => console.log(`${m.name} reacted ${m.emoji}`))
```

Events: `message` (everything), `text`, `image`, `video`, `audio`, `sticker`, `document`, `location`, `contact`, `reaction`, `poll`, plus group `join`/`leave`. Same return-value rules as `.cmd()`.

## Middleware — `.use()`

```ts
bot.use(async (m, next) => {
  console.log(`[${m.senderId}] ${m.text}`)
  if (!m.user.data.banned) await next()   // skipping next() drops the message
})
```

Runs before every command and event handler, in registration order.

## Advanced control

```ts
const bot = raileys('6281234567890')

bot.sock                       // raw Baileys socket — everything raileys doesn't wrap
bot.edit(msg.raw.key, 'new')   // edit your own message
bot.remove(msg.raw.key)        // delete a message
await bot.start()              // resolves once connected (usually unnecessary)
bot.stop()
bot.me                         // { id, name } once connected
```

## How it works under the hood

- **Session** — credentials in `.raileys/<name>/`, written by Baileys' own auth store. Deleting the folder relinks on next start.
- **Reconnection** — automatic with exponential backoff (1s → 30s cap). A `loggedOut` erase clears the session; `connectionReplaced` (another device took over) stops quietly.
- **Pairing code** — generated for the number in `phone`; the code expires fast, enter it promptly. Mismatched number/phone = session rejected and cleared, with a hint printed.
- **Media upload/download** — Baileys' own media stack; expired media is re-requested automatically on download.
- **Honest logging** — auto-start and return-value magic are quiet, but login, connection drops, and handler errors always print.

## Development

```sh
npm test        # build + 33 assertions (JIDs, command parsing, media sniffing, HTML)
npm run typecheck
npm run try     # run examples/basic.ts with your own number
```

## Status & scope

v0.2 — the foundation is stable and battle-tested (real-world pairing, reconnect, sessions, sends). Vote results for polls, profile management, block/unblock, presence, and newsletters are not wrapped yet; until they are, `bot.sock` gives you raw Baileys for anything missing.

## License

MIT. Not affiliated with or endorsed by WhatsApp or Meta. Unofficial — automated use of WhatsApp accounts can risk restriction; keep your bot polite and pace your broadcasts.

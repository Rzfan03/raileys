import { downloadMediaMessage, type WASocket, type WAMessage } from 'baileys'
import { contentOf, describeMessage, type DescribedMessage } from './content.js'
import { renderHtml } from './html.js'
import { isGroup, senderOf, toJid, phoneNumber } from './jid.js'
import { toMediaUpload } from './reply.js'
import type { LocationInfo, MediaInfo } from './types.js'

export interface AskOptions {
  /** Regex or predicate the answer must match. */
  validate?: RegExp | ((answer: string) => boolean)
  /** Reply sent when validation fails, then the question repeats. */
  retry?: string
  /** Give up after this long. Default 120000 ms — the promise rejects. */
  timeout?: number
}

export interface MenuItem {
  title: string
  /** Returns a reply (string/media) sent after the user picks this item. */
  run?: () => import('./types.js').ReplyResult | Promise<import('./types.js').ReplyResult>
}

export interface PollOptions {
  /** How many options a voter may pick. Default 1. */
  selectableCount?: number
}

/** Everything a handler needs on `m`. */
export class InboundMessage {
  readonly raw: WAMessage
  private readonly sock: WASocket
  private readonly prefixes: string[]
  private readonly described: DescribedMessage
  /** resolved by the client before handlers run */
  userData: Record<string, unknown> = {}
  askFn: ((question: string, options?: AskOptions) => Promise<string>) | null = null

  constructor(raw: WAMessage, sock: WASocket, prefixes: string[]) {
    this.raw = raw
    this.sock = sock
    this.prefixes = prefixes
    this.described = describeMessage(raw)
  }

  /** Message id — stable per chat, needed to edit/delete/react. */
  get id(): string {
    return this.raw.key.id ?? ''
  }

  /** Where the message arrived: user JID in private chats, `…@g.us` in groups. */
  get chatId(): string {
    return this.raw.key.remoteJid ?? ''
  }

  /** Who sent it: the participant in groups, otherwise the chat itself. */
  get senderId(): string {
    return senderOf(this.chatId, this.raw.key.participant)
  }

  /** Sender's phone number (null in some groups/LID setups). */
  get phone(): string | null {
    return phoneNumber(this.senderId)
  }

  get isGroup(): boolean {
    return isGroup(this.chatId)
  }

  /** True when the bot itself sent this message. */
  get fromMe(): boolean {
    return !!this.raw.key.fromMe
  }

  /** Sender's display name, when WhatsApp shares it. */
  get name(): string {
    return this.raw.pushName ?? ''
  }

  /** Epoch milliseconds. */
  get timestamp(): number {
    return Number(this.raw.messageTimestamp ?? 0) * 1000
  }

  /** The body: text, or the caption on media. Empty for stickers/audio. */
  get text(): string {
    return this.described.text
  }

  get type(): DescribedMessage['type'] {
    return this.described.type
  }

  get mediaInfo(): MediaInfo | null {
    return this.described.media
  }

  get location(): LocationInfo | null {
    return this.described.location
  }

  /** Emoji when `type === 'reaction'`. */
  get emoji(): string | null {
    return this.described.reaction
  }

  /** Contact display name when `type === 'contact'`. */
  get contactName(): string | null {
    return this.described.contactName
  }

  /** The message being replied to, when present. */
  get quoted(): InboundMessage | null {
    const context =
      (contentOf(this.raw)?.extendedTextMessage?.contextInfo ??
        contentOf(this.raw)?.imageMessage?.contextInfo ??
        contentOf(this.raw)?.videoMessage?.contextInfo ??
        contentOf(this.raw)?.documentMessage?.contextInfo) ?? null
    const quotedMessage = context?.quotedMessage
    if (!quotedMessage) return null
    const me = this.sock.user?.id ?? ''
    const quotedRaw: WAMessage = {
      key: {
        // in private chats the quoted message's chat *is* the participant
        remoteJid: context.remoteJid || (isGroup(this.chatId) ? this.chatId : (context.participant ?? this.chatId)),
        fromMe:
          !!context.participant &&
          String(me).split(':')[0] === String(context.participant).split(':')[0],
        id: context.stanzaId ?? '',
        participant: context.participant ?? undefined,
      },
      message: quotedMessage,
      messageTimestamp: this.raw.messageTimestamp,
    }
    return new InboundMessage(quotedRaw, this.sock, this.prefixes)
  }

  /** JIDs the sender @mentioned. */
  get mentions(): string[] {
    const context = contentOf(this.raw)?.extendedTextMessage?.contextInfo
    return context?.mentionedJid?.filter((j): j is string => !!j) ?? []
  }

  /** Per-user storage. `m.user.data.anything` persists across restarts. */
  get user(): { id: string; data: Record<string, unknown> } {
    return { id: this.senderId, data: this.userData }
  }

  // ── command fields (meaningful inside .cmd handlers) ────────────────────

  private parsed: { command: string; args: string[]; argstr: string } | null | undefined

  /** Command name without the prefix, lowercase — `"!Ping x"` → `"ping"`. Empty outside commands. */
  get command(): string {
    return this.parse()?.command ?? ''
  }

  /** Everything after the command as one string. */
  get args(): string {
    return this.parse()?.argstr ?? ''
  }

  /** Arguments split on whitespace. */
  get argv(): string[] {
    return this.parse()?.args ?? []
  }

  private parse(): { command: string; args: string[]; argstr: string } | null {
    if (this.parsed !== undefined) return this.parsed
    const text = this.text
    const prefix = this.prefixes.find((p) => text.startsWith(p))
    if (prefix === undefined) return (this.parsed = null)
    const body = text.slice(prefix.length)
    const [name = '', ...args] = body.split(/\s+/)
    if (!name) return (this.parsed = null)
    return (this.parsed = {
      command: name.toLowerCase(),
      args,
      argstr: body.slice(name.length).trimStart(),
    })
  }

  // ── actions ─────────────────────────────────────────────────────────────

  /**
   * Send a small HTML subset as WhatsApp formatting:
   * `<b>`, `<i>`, `<s>`, `<code>`, `<br>`, `<a href>` — the rest is stripped.
   * Underline doesn't exist in WhatsApp; `<u>` comes through as plain text.
   */
  async html(markup: string): Promise<void> {
    await this.send(renderHtml(markup))
  }

  /** Reply quoting this message. `{ quoted: false }` for a plain send. */
  async reply(text: string, options: { quoted?: boolean } = {}): Promise<void> {
    await this.sock.sendMessage(
      this.chatId,
      { text },
      options.quoted === false ? undefined : { quoted: this.raw },
    )
  }

  /** Send a plain (not quoted) message into this chat. */
  async send(text: string): Promise<void> {
    await this.sock.sendMessage(this.chatId, { text })
  }

  /** React to this message with an emoji. */
  async react(emoji: string): Promise<void> {
    await this.sock.sendMessage(this.chatId, { react: { text: emoji, key: this.raw.key } })
  }

  /** Download this message's media as a Buffer. Throws when there is none. */
  async media(): Promise<Buffer> {
    if (!this.described.media) throw new Error('raileys: this message has no media')
    return (await downloadMediaMessage(
      this.raw,
      'buffer',
      {},
      { logger: silentLogger(), reuploadRequest: this.sock.updateMediaMessage },
    )) as Buffer
  }

  /** Send a webp Buffer as a sticker into this chat. */
  async sticker(webp: string | Buffer): Promise<void> {
    await this.sock.sendMessage(this.chatId, { sticker: toMediaUpload(webp) })
  }

  /** Remove members from this group. The bot must be an admin. */
  async kick(jids: string[]): Promise<void> {
    await this.sock.groupParticipantsUpdate(this.chatId, jids.map(toJid), 'remove')
  }

  /** Add members to this group. The bot must be an admin. */
  async groupAdd(jids: string[]): Promise<void> {
    await this.sock.groupParticipantsUpdate(this.chatId, jids.map(toJid), 'add')
  }

  /** Group details: name, participants (with phones and admin flags). */
  async groupInfo() {
    const meta = await this.sock.groupMetadata(this.chatId)
    return {
      id: meta.id,
      name: meta.subject ?? '',
      owner: meta.owner ?? null,
      participants: meta.participants.map((p) => ({
        id: p.id,
        phone: phoneNumber(p.id),
        admin: p.admin != null ? ('admin' as const) : null,
      })),
    }
  }

  /** Make the bot leave this group. */
  async leave(): Promise<void> {
    await this.sock.groupLeave(this.chatId)
  }

  /** Mark this message as read. */
  async read(): Promise<void> {
    await this.sock.readMessages([this.raw.key])
  }

  /** Send an official WhatsApp poll. Results arrive as `poll` events later. */
  async poll(question: string, options: string[], pollOptions: PollOptions = {}): Promise<void> {
    if (options.length < 2) throw new Error('raileys: poll needs at least 2 options')
    await this.sock.sendMessage(this.chatId, {
      poll: {
        name: question,
        values: options,
        selectableCount: pollOptions.selectableCount ?? 1,
      },
    })
  }

  /**
   * Send a numbered menu; the user's next message picks an item and its
   * `run()` result is returned to you. Works on every WhatsApp client.
   *
   *   const picked = await m.menu('Pilih:', [{ title: 'A', run: () => 'a!' }, { title: 'B' }])
   */
  async menu(title: string, items: MenuItem[]): Promise<unknown> {
    if (!items.length) throw new Error('raileys: menu needs at least one item')
    const list = items.map((item, i) => `${i + 1}. ${item.title}`).join('\n')
    const answer = await this.ask(`${title}\n${list}`, {
      validate: (a) => {
        const n = Number(a)
        return Number.isInteger(n) && n >= 1 && n <= items.length
      },
      retry: `Pilih angka 1-${items.length} ya`,
    })
    const picked = items[Number(answer.trim()) - 1]
    return picked?.run ? picked.run() : picked?.title
  }

  /**
   * Ask a follow-up question and wait for this user's next message.
   * `const name = await m.ask('Namamu?')` — that's a whole state machine.
   */
  ask(question: string, options?: AskOptions): Promise<string> {
    if (!this.askFn) throw new Error('raileys: ask() is not wired up')
    return this.askFn(question, options)
  }
}

function silentLogger() {
  const noop = () => {}
  const logger: Record<string, unknown> = {
    level: 'silent',
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  }
  return logger as never
}

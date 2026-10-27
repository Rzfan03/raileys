import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
  type WAMessage,
} from 'baileys'
import { randomBytes } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import qrcode from 'qrcode-terminal'
import { describeMessage } from './content.js'
import { Emitter } from './events.js'
import { phoneNumber, toJid } from './jid.js'
import { InboundMessage, type AskOptions } from './message.js'
import { contentFor } from './reply.js'
import { UserStore } from './storage.js'
import type {
  CmdOptions,
  GroupEvent,
  Handler,
  LoginMode,
  MessageEventName,
  MiddlewareHandler,
  RaileysOptions,
  ReplyResult,
} from './types.js'

type ResolvedOptions = Omit<
  RaileysOptions,
  'phone' | 'authDir' | 'onError' | 'prefix' | 'config' | 'name' | 'owner' | 'reconnect' | 'typing' | 'quiet' | 'login'
> & {
  name: string
  prefix: string[]
  owner: string[]
  typing: boolean
  quiet: boolean
  login: LoginMode
  reconnect: boolean
  phone?: string
  authDir?: string
  onError?: RaileysOptions['onError']
}

const DEFAULT_PREFIXES = ['.', '!', '/']

interface PendingAsk {
  resolve: (answer: string) => void
}

/** Group events don't come from a message; they get a small context object. */
interface EventContext {
  sock: WASocket
  chatId: string
}

/**
 * The whole bot:
 *
 *   import raileys from 'raileys'
 *
 *   raileys('6281234567890', {
 *     ping: 'pong',
 *     'halo|hi': (m) => `Halo ${m.name}!`,
 *     daftar: async (m) => {
 *       const nama = await m.ask('Namamu siapa?')
 *       return `Hai ${nama}`
 *     },
 *   })
 *
 * Handlers may return a string, media, a Buffer, or an array of strings —
 * each is sent as a reply automatically. Returning nothing sends nothing.
 */
export class Raileys {
  private readonly direct: Omit<RaileysOptions, 'config'>
  private readonly configPath?: string
  private fileOptions: Omit<RaileysOptions, 'config'> | null = null
  private resolved: ResolvedOptions | null = null
  private readonly emitter = new Emitter<Record<string, unknown>>()
  private readonly commands = new Map<string, { options: CmdOptions; handler: Handler }>()
  private readonly middlewares: MiddlewareHandler[] = []
  private readonly pendingAsks = new Map<string, PendingAsk>()
  private store: UserStore | null = null
  private _sock: WASocket | null = null
  private attempts = 0
  private loginOffered = false
  private launched = false

  constructor(options: RaileysOptions = {}) {
    const { config, ...rest } = options
    this.direct = rest
    if (typeof config === 'string') this.configPath = config
    else if (config) this.fileOptions = config
    // no file config → resolve immediately so getters work before start()
    if (!this.configPath) this.resolve()
  }

  /** Merge file config (lower) with direct options (higher), apply defaults. */
  private resolve(): ResolvedOptions {
    if (this.resolved) return this.resolved
    const o = { ...this.fileOptions, ...this.direct }
    const prefixInput = o.prefix ?? DEFAULT_PREFIXES
    const prefix = (Array.isArray(prefixInput) ? prefixInput : [prefixInput]).map(String)
    if (prefix.some((p) => !p)) {
      // '' alone would swallow every text as an empty command name
      throw new Error("raileys: prefix '' alone is not allowed — pass a real prefix like '.'")
    }
    this.resolved = {
      name:
        o.name ??
        (path.basename(process.argv[1] ?? 'default', path.extname(process.argv[1] ?? '')) ||
          'default'),
      prefix,
      typing: o.typing ?? false,
      owner: o.owner ?? [],
      login: o.login ?? (o.phone ? 'pairing' : 'qr'),
      reconnect: o.reconnect ?? true,
      quiet: o.quiet ?? false,
      phone: o.phone,
      authDir: o.authDir,
      onError: o.onError,
    }
    return this.resolved
  }

  private get opts(): ResolvedOptions {
    if (!this.resolved) {
      throw new Error('raileys: options with a config file resolve at start() — access them after connecting')
    }
    return this.resolved
  }

  /** Credential folder for this session. */
  get folder(): string {
    return this.opts.authDir ?? path.join('.raileys', this.opts.name)
  }

  get prefixes(): string[] {
    return this.opts.prefix
  }

  /** Resolves once connected. Optional — the bot starts itself. */
  start(): Promise<void> {
    this.launch()
    return this.connectedPromise
  }

  /** Register a command. `"ping|p"` gives aliases. Optional filters: `.cmd('kick', { admin: true }, fn)`. */
  cmd(spec: string, handler: Handler): this
  cmd(spec: string, options: CmdOptions, handler: Handler): this
  cmd(
    spec: string,
    handlerOrOptions: Handler | CmdOptions,
    maybeHandler?: Handler,
  ): this {
    const options = maybeHandler ? (handlerOrOptions as CmdOptions) : {}
    const handler = (maybeHandler ?? handlerOrOptions) as Handler
    for (const name of spec.split('|')) {
      const key = name.trim().toLowerCase()
      if (!key) throw new Error(`raileys: empty command name in "${spec}"`)
      this.commands.set(key, { options, handler })
    }
    return this
  }

  /** Listen for inbound messages by type, or group `join`/`leave`. Same reply semantics as `.cmd`. */
  on(event: MessageEventName, handler: Handler): this
  on(event: 'join' | 'leave', handler: (m: GroupEvent) => ReplyResult | Promise<ReplyResult>): this
  on(event: string, handler: Handler | ((m: GroupEvent) => ReplyResult | Promise<ReplyResult>)): this {
    if (event === 'join' || event === 'leave') {
      this.emitter.on(event, (payload: unknown) => {
        const groupEvent = payload as GroupEvent
        void this.runEvent(groupEvent, handler as (m: GroupEvent) => ReplyResult)
      })
      return this
    }
    this.emitter.on(event, (payload: unknown) => {
      void this.runHandler(payload as InboundMessage, handler as Handler, {})
    })
    return this
  }

  /** Runs before every handler. `await next()` to continue; skipping drops the message. */
  use(middleware: MiddlewareHandler): this {
    this.middlewares.push(middleware)
    return this
  }

  /** Disconnect. Credentials are kept; the process exiting keeps them too. */
  stop(): void {
    this.sock?.end(new Error('raileys: stopped by stop()'))
  }

  /** The connected account once connected, or null. */
  get me(): { id: string; name: string } | null {
    const me = this.sock?.user
    return me ? { id: me.id, name: me.name ?? '' } : null
  }

  /** Raw Baileys socket — the escape hatch for anything raileys doesn't wrap. */
  get sock(): WASocket | null {
    return this._sock
  }

  // ── connection ──────────────────────────────────────────────────────────

  private connectedResolve: (() => void) | null = null
  private connectedPromise: Promise<void> = Promise.resolve()

  private launch(): void {
    if (this.launched) return
    this.launched = true
    this.connectedPromise = new Promise<void>((resolve) => (this.connectedResolve = resolve))
    void this.connect()
  }

  private async connect(): Promise<void> {
    if (this.configPath) {
      this.fileOptions = await loadRaileysConfig(this.configPath)
      this.resolve()
    }
    const folder = this.folder
    await mkdir(folder, { recursive: true })
    this.store ??= new UserStore(path.join(folder, 'users'))

    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState(folder)

    const sock: WASocket = makeWASocket({
      auth: state,
      version,
      logger: silentLogger(),
      // baileys defaults to looking online, which fakes read receipts
      markOnlineOnConnect: false,
    })
    this._sock = sock

    sock.ev.on('connection.update', (update) => this.onConnection(sock, update))
    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return
      for (const raw of messages) void this.dispatch(sock, raw)
    })
    sock.ev.on('group-participants.update', ({ id, participants, action }) => {
      const event = action === 'add' ? 'join' : action === 'remove' ? 'leave' : null
      const jids = participants.map((p) => p.id ?? '').filter(Boolean)
      if (!event || !jids.length) return
      this.emitter.emit(event, {
        chatId: id,
        user: jids[0],
        users: jids,
        raw: { id, participants, action },
        reply: async (text: string) => {
          await sock.sendMessage(id, { text })
        },
      } satisfies GroupEvent)
    })
  }

  private onConnection(
    sock: WASocket,
    update: { connection?: string; qr?: string; lastDisconnect?: { error?: unknown } },
  ): void {
    const { connection, lastDisconnect, qr } = update

    if (qr && !this.loginOffered) this.offerLogin(sock, qr)

    if (connection === 'connecting') return
    if (connection === 'open') {
      this.attempts = 0
      this.log(`Bot siap sebagai ${this.me?.name || this.me?.id} (sesi: ${this.opts.name})`)
      this.settle()
      return
    }
    if (connection === 'close') {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
        ?.statusCode
      void this.onClose(sock, code)
    }
  }

  private settle(): void {
    const resolve = this.connectedResolve
    this.connectedResolve = null
    resolve?.()
  }

  private offerLogin(sock: WASocket, qr: string): void {
    this.loginOffered = true
    if (this.opts.login === 'pairing') {
      const number = this.opts.phone
      if (!number) throw new Error("raileys: login 'pairing' butiap butuh `phone` di options")
      void sock
        .requestPairingCode(number, randomBytes(4).toString('hex').toUpperCase())
        .then((code) => {
          console.log(`[raileys] Pairing code (WhatsApp → Perangkat → Tautkan): ${code.slice(0, 4)}-${code.slice(4)}`)
        })
      return
    }
    console.log('[raileys] Scan QR ini di WhatsApp → Perangkat → Tautkan Perangkat:')
    qrcode.generate(qr, { small: true })
  }

  private async onClose(sock: WASocket, code: number | undefined): Promise<void> {
    if (code === DisconnectReason.loggedOut) {
      await rm(this.folder, { recursive: true, force: true })
      this.loginOffered = false
      console.log(
        '[raileys] Sesi ditolak WhatsApp dan dihapus. Penyebab paling umum:\n' +
          '  1. Nomor di `phone` bukan nomor WhatsApp yang kamu link-kan — samakan dulu,\n' +
          '  2. Pairing code lama sudah kedaluwarsa — jalankan lagi dan masukkan code baru segera.',
      )
      this.settle()
      return
    }
    if (code === DisconnectReason.connectionReplaced || code === DisconnectReason.forbidden) {
      console.log('[raileys] Sesi diambil perangkat lain. Tidak menyambung ulang.')
      this.settle()
      return
    }
    if (!this.reconnectable(code)) {
      this.settle()
      return
    }
    // backoff: 1s, 2s, 4s … cap 30s
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5))
    this.log(`Koneksi terputus (${code}). Menyambung ulang dalam ${delay / 1000}s…`)
    this.connectedPromise = new Promise((resolve) => {
      this.connectedResolve = resolve
      setTimeout(() => void this.connect(), delay)
    })
  }

  private reconnectable(code: number | undefined): boolean {
    if (!this.opts.reconnect) return false
    return true
  }

  private log(message: string): void {
    if (!this.opts.quiet) console.log(`[raileys] ${message}`)
  }

  // ── inbound pipeline ────────────────────────────────────────────────────

  private async dispatch(sock: WASocket, raw: WAMessage): Promise<void> {
    if (raw.key.remoteJid === 'status@broadcast') return
    if (raw.key.fromMe) return

    const described = describeMessage(raw)
    if (described.isProtocol || described.type === 'unknown' || described.type === 'other') return

    const msg = new InboundMessage(raw, sock, this.prefixes)
    msg.userData = await this.store!.load(msg.senderId)
    this.attachAsk(msg)

    // an open question gets the next message from that user, before anything else
    const askKey = `${msg.chatId}|${msg.senderId}`
    const pending = this.pendingAsks.get(askKey)
    if (pending) {
      this.pendingAsks.delete(askKey)
      pending.resolve(msg.text)
      return
    }

    if (msg.type === 'reaction') {
      this.emitter.emit('reaction', msg)
      return
    }
    // a button tap behaves like typing its id as a command, when one exists
    if (msg.type === 'button' && msg.buttonId) {
      const tapped = this.commands.get(msg.buttonId.toLowerCase())
      if (tapped) {
        this.emitter.emit('message', msg)
        this.emitter.emit('button', msg)
        await this.runCommand(msg, tapped)
        return
      }
    }

    this.emitter.emit('message', msg)
    this.emitter.emit(msg.type, msg)

    // commands
    const cmdInfo = msg.command ? this.commands.get(msg.command) : undefined
    if (cmdInfo) await this.runCommand(msg, cmdInfo)
  }

  private async runCommand(
    msg: InboundMessage,
    entry: { options: CmdOptions; handler: Handler },
  ): Promise<void> {
    const denied = await this.checkFilters(msg, entry.options)
    if (denied) return
    await this.runHandler(msg, entry.handler, entry.options)
  }

  private async checkFilters(msg: InboundMessage, options: CmdOptions): Promise<string | null> {
    if (options.group && !msg.isGroup) return 'not-group'
    if (options.owner && !this.opts.owner.includes(msg.phone ?? '')) return 'not-owner'
    if (options.media) {
      const wanted = Array.isArray(options.media) ? options.media : [options.media]
      const info = msg.mediaInfo
      if (!info || !wanted.includes(info.type)) return 'no-media'
    }
    if (options.admin) {
      const ok = await this.isAdminChat(msg)
      if (!ok) return 'not-admin'
    }
    return null
  }

  private async isAdminChat(msg: InboundMessage): Promise<boolean> {
    if (!msg.isGroup) return false
    try {
      const meta = await this.sock!.groupMetadata(msg.chatId)
      const admin = (id: string | undefined) =>
        meta.participants.some(
          (p) => p.id && phoneNumber(p.id) === phoneNumber(id) && p.admin != null,
        )
      return admin(msg.senderId) && admin(this.me?.id)
    } catch {
      return false
    }
  }

  private async runHandler(
    msg: InboundMessage,
    handler: Handler,
    options: CmdOptions,
  ): Promise<void> {
    let index = 0
    let dispatched = false
    const next = async (): Promise<void> => {
      while (index < this.middlewares.length) {
        const mw = this.middlewares[index++]
        await mw(msg, next)
      }
      if (dispatched) return
      dispatched = true

      try {
        if (this.opts.typing) await this.sock!.sendPresenceUpdate('composing', msg.chatId)
        const result = await handler(msg)
        await this.sendReply(msg.chatId, result)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        if (this.opts.onError) this.opts.onError(err, msg)
        else console.error('[raileys] handler gagal:', err.message)
      } finally {
        if (this.opts.typing) await this.sock!.sendPresenceUpdate('paused', msg.chatId)
        await this.store!.save(msg.senderId, msg.userData)
      }
    }
    await next()
  }

  private async runEvent(groupEvent: GroupEvent, handler: (m: GroupEvent) => ReplyResult): Promise<void> {
    try {
      const result = await handler(groupEvent)
      await this.sendReply(groupEvent.chatId, result)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      if (this.opts.onError) this.opts.onError(err, null)
      else console.error('[raileys] handler gagal:', err.message)
    }
  }

  /** The return-value magic: string → text, media object → media, Buffer → sniffed, array → several. */
  private async sendReply(chatId: string, result: ReplyResult): Promise<void> {
    if (result == null) return
    const sock = this.sock
    if (!sock) throw new Error('raileys: not connected yet')
    if (Array.isArray(result)) {
      for (const part of result) await sock.sendMessage(chatId, { text: part })
      return
    }
    const content = contentFor(result)
    await sock.sendMessage(chatId, content as never)
  }

  // ── m.ask() ─────────────────────────────────────────────────────────────

  private async ask(msg: InboundMessage, question: string, options: AskOptions = {}): Promise<string> {
    const key = `${msg.chatId}|${msg.senderId}`
    const validate = options.validate
    const retry = options.retry
    for (let attempt = 0; attempt < 3; attempt++) {
      await msg.reply(question)
      const answer = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          this.pendingAsks.delete(key)
          resolve(null)
        }, options.timeout ?? 120_000)
        this.pendingAsks.set(key, {
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
        })
      })
      if (answer === null) throw new Error('raileys: ask() timed out')
      const valid = !validate || (typeof validate === 'function' ? validate(answer) : validate.test(answer))
      if (valid) return answer
      if (retry) await msg.reply(retry)
    }
    throw new Error('raileys: ask() gagal validasi 3x')
  }

  /** Wire-up hook so InboundMessage.ask works without exposing internals. */
  attachAsk(msg: InboundMessage): void {
    msg.askFn = (question, options) => this.ask(msg, question, options)
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

/**
 * Load options from a user's config file (`export default { … }`).
 * `raileys({ config: './raileys.config.ts' })` resolves it at start().
 */
export async function loadRaileysConfig(
  filePath: string,
): Promise<Omit<RaileysOptions, 'config'>> {
  const { pathToFileURL } = await import('node:url')
  const abs = path.resolve(process.cwd(), filePath)
  const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>
  const conf = (mod.default ?? mod) as Omit<RaileysOptions, 'config'>
  if (!conf || typeof conf !== 'object' || Array.isArray(conf)) {
    throw new Error(`raileys: config "${filePath}" must export default an options object`)
  }
  return conf
}

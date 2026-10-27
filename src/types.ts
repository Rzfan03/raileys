import type { InboundMessage } from './message.js'

export type LoginMode = 'qr' | 'pairing'

export interface RaileysOptions {
  /** Bot's WhatsApp number for pairing-code login, e.g. `'6281234567890'`. No phone → QR. */
  phone?: string
  /** Session name; credentials live under `.raileys/<name>/`. Default: script filename. */
  name?: string
  /** Command prefixes. Default `['.', '!', '/']`. Pass `''` to answer plain text too. */
  prefix?: string[] | string
  /** Show "typing…" while a handler runs. Default `false`. */
  typing?: boolean
  /** Numbers (628…) allowed to use `{ owner: true }` commands. */
  owner?: string[]
  /** Force the login style. Default: phone set → pairing, else QR. */
  login?: LoginMode
  /** Override the credential folder. Default `.raileys/<name>`. */
  authDir?: string
  /** Auto-reconnect on drop. Default `true`. */
  reconnect?: boolean
  /** Silence info logs. Errors are always printed. */
  quiet?: boolean
  /** Called when a handler throws. Default: log to console. */
  onError?: (error: Error, msg: InboundMessage | null) => void
  /** Options file (default export) or object; direct options here win over it. */
  config?: RaileysOptions | string
}

/** What a handler may return — everything here is sent as a reply automatically. */
export type ReplyResult =
  | string
  | string[]
  | Buffer
  | MediaResult
  | null
  | undefined
  | void

/** `{ image: … }` etc. accepts a Buffer/`Buffer`-like or an http(s) URL string. */
export interface MediaResult {
  /** Small HTML subset rendered as WhatsApp formatting (*bold*, _italic_, …). */
  html?: string
  image?: string | Buffer
  video?: string | Buffer
  audio?: string | Buffer
  sticker?: string | Buffer
  document?: string | Buffer
  caption?: string
  /** document only */
  fileName?: string
  mime?: string
  /** audio only: send as a voice note */
  ptt?: boolean
}

export interface CmdOptions {
  /** Only inside groups. */
  group?: boolean
  /** Sender must be a group admin (and the bot too, for kick-style actions). */
  admin?: boolean
  /** Sender must be in `options.owner`. */
  owner?: boolean
  /** Message must carry this media. */
  media?: 'image' | 'video' | 'audio' | 'sticker' | 'document' | Array<
    'image' | 'video' | 'audio' | 'sticker' | 'document'
  >
}

export type Handler = (m: InboundMessage) => ReplyResult | Promise<ReplyResult>
export type MiddlewareHandler = (m: InboundMessage, next: () => Promise<void>) => void | Promise<void>

export type MessageEventName =
  | 'message'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'sticker'
  | 'document'
  | 'location'
  | 'contact'
  | 'reaction'
  | 'poll'

/** Payload of the `join` / `leave` events. */
export interface GroupEvent {
  chatId: string
  /** The participant(s) that joined/left. */
  user: string
  users: string[]
  raw: unknown
  /** Send a plain text into the group. */
  reply(text: string): Promise<void>
}

export type InboundType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'sticker'
  | 'document'
  | 'location'
  | 'contact'
  | 'reaction'
  | 'poll'
  | 'other'
  | 'unknown'

export interface MediaInfo {
  type: 'image' | 'video' | 'audio' | 'sticker' | 'document'
  mime?: string
  fileName?: string
}

export interface LocationInfo {
  lat: number
  long: number
  name?: string
  address?: string
}

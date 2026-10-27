export type { AskOptions, MenuItem, PollOptions } from './message.js'
export { Raileys, loadRaileysConfig } from './client.js'
export { InboundMessage } from './message.js'
export type { ButtonItem } from './buttons.js'
export { isGroup, phoneNumber as phoneFromJid, toJid } from './jid.js'
export type {
  RaileysOptions,
  ReplyResult,
  MediaResult,
  CmdOptions,
  Handler,
  MessageEventName,
  GroupEvent,
  InboundType,
  MediaInfo,
  LocationInfo,
} from './types.js'
import { Raileys } from './client.js'
import type { RaileysOptions } from './types.js'
import type { Handler, CmdOptions } from './types.js'

type Commands = Record<string, Handler | string>

/**
 * Create and start a bot in one call.
 *
 *   import raileys from 'raileys'
 *   raileys('6281234567890', { ping: 'pong' })
 */
export function raileys(phone: string, commands?: Commands): Raileys
export function raileys(options: RaileysOptions, commands?: Commands): Raileys
export function raileys(phoneOrOptions: string | RaileysOptions, commands?: Commands): Raileys {
  const options = typeof phoneOrOptions === 'string' ? { phone: phoneOrOptions } : phoneOrOptions
  const bot = new Raileys(options)
  if (commands) registerCommands(bot, commands)
  void bot.start()
  return bot
}

function registerCommands(bot: Raileys, commands: Commands): void {
  for (const [spec, value] of Object.entries(commands)) {
    if (typeof value === 'string') bot.cmd(spec, () => value)
    else bot.cmd(spec, value)
  }
}

export default raileys

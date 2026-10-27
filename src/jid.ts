/** JID helpers. A JID is WhatsApp's chat address: `user@s.whatsapp.net`, `123-456@g.us`, … */

export const USER_SERVER = 's.whatsapp.net'

export function isGroup(jid: string | null | undefined): boolean {
  return (jid ?? '').endsWith('@g.us')
}

/** `628123…@s.whatsapp.net` → `628123…` */
export function phoneNumber(jid: string | null | undefined): string | null {
  const j = jid ?? ''
  if (!j.endsWith('@' + USER_SERVER)) return null
  return j.slice(0, j.lastIndexOf('@')).split(':')[0]
}

/**
 * Accepts what a human would type and returns a valid JID.
 * `"6281234567"` → `"6281234567@s.whatsapp.net"`, groups and raw JIDs pass through.
 */
export function toJid(input: string): string {
  const value = input.trim()
  if (value.includes('@')) return value
  const digits = value.replace(/\D/g, '')
  // a bare group id ("120363-1234") and a dashed phone ("+62 812-3") both contain
  // dashes — only '+' marks an unambiguous phone number
  if (!digits || (value.includes('-') && !value.startsWith('+'))) {
    throw new Error(
      `raileys: unclear chat address "${input}". ` +
        'Pass a phone number (628… or +62…) or a full JID (…@g.us, …@s.whatsapp.net).',
    )
  }
  return digits + '@' + USER_SERVER
}

/** The real sender of a message: the participant in groups, the chat itself otherwise. */
export function senderOf(
  jid: string | null | undefined,
  participant: string | null | undefined,
): string {
  return isGroup(jid) ? (participant ?? '') : (jid ?? '')
}

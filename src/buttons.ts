import { generateWAMessageFromContent, type WASocket } from 'baileys'
import type { WAMessageContent } from 'baileys'

export interface ButtonItem {
  /** Returned when the user taps it (default: lowercase text). Keep it a command name. */
  id?: string
  /** Label shown on the button. */
  text: string
}

/**
 * Unofficial visual buttons via WhatsApp's native flow (interactiveMessage).
 * Renders as real tappable buttons on current clients — but it is not a
 * documented API and WhatsApp can change or drop it anytime. The numbered
 * `m.menu()` stays the stable fallback.
 */
export function buildButtonsMessage(title: string, buttons: ButtonItem[], footer?: string) {
  if (!buttons.length || buttons.length > 10) {
    throw new Error('raileys: buttons need 1–10 items')
  }
  const ids = buttons.map((b, i) => (b.id ?? b.text.toLowerCase()).trim())
  if (ids.some((id) => !id)) throw new Error('raileys: button text/id must not be empty')
  if (new Set(ids).size !== ids.length) throw new Error('raileys: button ids must be unique')

  // isForwarded nudges clients into rendering the interactive bubble reliably
  const content = {
    viewOnceMessage: {
      message: {
        messageContextInfo: {},
        interactiveMessage: {
          contextInfo: { isForwarded: true, forwardingScore: 1 },
          body: { text: title },
          footer: footer ? { text: footer } : undefined,
          nativeFlowMessage: {
            messageParamsJson: '',
            buttons: ids.map((id, i) => ({
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({ id, display_text: buttons[i].text }),
            })),
          },
        },
      },
    },
  }
  return content as WAMessageContent
}

/** Send visual buttons; resolves with the message id of the bubble. */
export async function sendButtons(
  sock: WASocket,
  jid: string,
  title: string,
  buttons: ButtonItem[],
  footer?: string,
): Promise<string | undefined> {
  const content = buildButtonsMessage(title, buttons, footer)
  const msg = generateWAMessageFromContent(jid, content, { userJid: sock.user?.id ?? '' })
  if (!msg.message || !msg.key.id) throw new Error('raileys: failed to build buttons message')
  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id })
  return msg.key.id
}

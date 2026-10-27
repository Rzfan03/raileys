import { proto, type WAMessage } from 'baileys'
import type { InboundType, LocationInfo, MediaInfo } from './types.js'

/** Media-carrying Message field of proto.Message */
const MEDIA_KEYS = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'stickerMessage',
  'documentMessage',
] as const

const TYPE_OF_MEDIA_KEY: Record<(typeof MEDIA_KEYS)[number], MediaInfo['type']> = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  stickerMessage: 'sticker',
  documentMessage: 'document',
}

export interface DescribedMessage {
  type: InboundType
  text: string
  media: MediaInfo | null
  location: LocationInfo | null
  contactName: string | null
  reaction: string | null
  isProtocol: boolean
}

/** The single content node of a normal message, or null for empty/protocol messages. */
export function contentOf(message: WAMessage): proto.Message | null {
  return (message.message as proto.Message | undefined) ?? null
}

/** Turn a Baileys message into the flat fields raileys exposes. */
export function describeMessage(raw: WAMessage): DescribedMessage {
  const out: DescribedMessage = {
    type: 'unknown',
    text: '',
    media: null,
    location: null,
    contactName: null,
    reaction: null,
    isProtocol: false,
  }
  const content = contentOf(raw)
  if (!content) {
    out.isProtocol = !!raw.messageStubType
    return out
  }

  for (const key of MEDIA_KEYS) {
    const mediaMessage = content[key]
    if (mediaMessage && typeof mediaMessage === 'object') {
      const node = mediaMessage as proto.Message.IImageMessage
      out.type = TYPE_OF_MEDIA_KEY[key]
      out.media = {
        type: TYPE_OF_MEDIA_KEY[key],
        mime: node.mimetype ?? undefined,
        fileName:
          key === 'documentMessage'
            ? (mediaMessage as proto.Message.IDocumentMessage).fileName ?? undefined
            : undefined,
      }
      if (key === 'documentMessage') {
        out.text = (mediaMessage as proto.Message.IDocumentMessage).caption ?? ''
      } else if (key !== 'stickerMessage' && key !== 'audioMessage') {
        out.text = (mediaMessage as proto.Message.IImageMessage).caption ?? ''
      }
      return out
    }
  }

  if (content.conversation !== undefined) {
    out.type = 'text'
    out.text = content.conversation ?? ''
    return out
  }
  const poll = content.pollCreationMessage
  if (poll && typeof poll === 'object') {
    out.type = 'poll'
    out.text = poll.name ?? ''
    return out
  }
  const ext = content.extendedTextMessage
  if (ext && typeof ext === 'object') {
    out.type = 'text'
    out.text = ext.text ?? ''
    return out
  }
  const loc = content.locationMessage
  if (loc && typeof loc === 'object') {
    out.type = 'location'
    out.location = {
      lat: loc.degreesLatitude ?? 0,
      long: loc.degreesLongitude ?? 0,
      name: loc.name ?? undefined,
      address: loc.address ?? undefined,
    }
    out.text = loc.name ?? ''
    return out
  }
  const contact = content.contactMessage
  if (contact && typeof contact === 'object') {
    out.type = 'contact'
    out.contactName = contact.displayName ?? null
    out.text = contact.displayName ?? ''
    return out
  }
  const reaction = content.reactionMessage
  if (reaction && typeof reaction === 'object') {
    out.type = 'reaction'
    out.reaction = reaction.text ?? null
    out.text = reaction.text ?? ''
    return out
  }

  out.type = 'other'
  return out
}

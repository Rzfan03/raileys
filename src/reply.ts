import type { MediaResult, ReplyResult } from './types.js'
import { renderHtml } from './html.js'

/** Guess what a Buffer is from its magic bytes, so `return buffer` just works. */
export function mediaKind(buf: Buffer): 'image' | 'video' | 'audio' | 'sticker' | 'document' {
  const head = (start: number, end: number) => buf.subarray(start, end).toString('latin1')
  if (head(0, 3) === '\xff\xd8\xff') return 'image' // jpeg
  if (buf[0] === 0x89 && head(1, 4) === 'PNG') return 'image' // png
  if (head(0, 3) === 'GIF') return 'image' // gif
  if (head(0, 4) === 'RIFF' && head(8, 12) === 'WEBP') return 'sticker' // webp
  if (head(4, 8) === 'ftyp') return 'video' // mp4/mov
  if (head(0, 4) === 'OggS' || head(0, 3) === 'ID3' || buf[0] === 0xff) return 'audio' // ogg/mp3
  return 'document'
}

/** Baileys media fields take a Buffer or `{ url }`, never a bare string. */
export function toMediaUpload(value: string | Buffer): Buffer | { url: string } {
  return typeof value === 'string' ? { url: value } : value
}

/** Build the Baileys message content for whatever a handler returned. */
export function contentFor(result: Exclude<ReplyResult, null | undefined | void>) {
  if (typeof result === 'string') return { text: result }
  if (result instanceof Buffer) {
    const kind = mediaKind(result)
    if (kind === 'document') throw new Error('raileys: unknown buffer type — send with { document: buf, fileName, mime }')
    return { [kind]: result }
  }
  const r = result as MediaResult
  if (r.html !== undefined) return { text: renderHtml(r.html) }
  const [field, value] = Object.entries(r).find(([k]) =>
    ['image', 'video', 'audio', 'sticker', 'document'].includes(k),
  ) ?? [null, null]
  if (!field) throw new Error('raileys: media reply needs one of html/image/video/audio/sticker/document')
  const content: Record<string, unknown> = { [field]: toMediaUpload(value as string | Buffer) }
  if (r.caption) content.caption = renderHtml(r.caption)
  if (r.fileName) content.fileName = r.fileName
  if (field === 'document') content.mimetype = r.mime ?? 'application/octet-stream'
  if (field === 'audio' && r.ptt) content.ptt = true
  return content
}

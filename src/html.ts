/**
 * Tiny HTML → WhatsApp-formatting converter. WhatsApp never renders real HTML;
 * the honest trick is mapping a small, useful subset to the native markup
 * every WhatsApp client renders: *bold*, _italic_, ~strike~, ```mono```.
 */

const WRAPPERS: Record<string, string> = {
  b: '*',
  strong: '*',
  i: '_',
  em: '_',
  s: '~',
  del: '~',
  strike: '~',
  code: '```',
  pre: '```',
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

/** Convert a small HTML subset into WhatsApp text. Unknown tags are stripped, not shown. */
export function htmlToWa(html: string): string {
  let out = ''
  const stack: string[] = []
  let rest = html

  while (rest.length) {
    const open = rest.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)[^>]*>/)
    if (!open) {
      const nextTag = rest.indexOf('<')
      const text = nextTag === -1 ? rest : rest.slice(0, nextTag)
      out += decodeEntities(text)
      rest = nextTag === -1 ? '' : rest.slice(nextTag)
      continue
    }
    const [full, slash, tagLower] = open
    const tag = tagLower.toLowerCase()
    rest = rest.slice(full.length)

    if (tag === 'br') {
      out += '\n'
      continue
    }

    const wrapper = WRAPPERS[tag]
    if (slash) {
      // closing: emit the marker only if the matching opening was seen
      const depth = stack.lastIndexOf(tag)
      if (depth !== -1) {
        stack.splice(depth, 1)
        out += WRAPPERS[tag]
      }
      continue
    }
    if (wrapper) {
      stack.push(tag)
      out += wrapper
    }
    // other tags (div, span, p, a, …) vanish; their text stays
  }
  // unclosed tags: close them so formatting doesn't leak to the rest of the chat
  return out + stack.map((tag) => WRAPPERS[tag]).join('')
}

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
}

/** `href` can't be styled by WhatsApp — a link becomes `text (url)`. */
export function linkify(html: string): string {
  return html.replace(/<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const plain = htmlToWa(text).trim()
    return plain === href || !plain ? href : `${plain} (${href})`
  })
}

/** Full pipeline: handle links first, then formatting. */
export function renderHtml(html: string): string {
  return htmlToWa(linkify(html)).replace(/\n{3,}/g, '\n\n').trim()
}

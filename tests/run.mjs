// Pure-logic regression tests for raileys. Run: npm test
import assert from 'node:assert/strict'
import { phoneNumber as phoneFromJid, isGroup, toJid } from '../dist/jid.js'
import { InboundMessage } from '../dist/message.js'
import { mediaKind, contentFor, toMediaUpload } from '../dist/reply.js'
import { Emitter } from '../dist/events.js'

const PREFIXES = ['.', '!', '/']
const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── toJid ──
test('toJid: phone digits get the user server', () => {
  assert.equal(toJid('6281234567890'), '6281234567890@s.whatsapp.net')
})
test('toJid: + and dashes and spaces are stripped', () => {
  assert.equal(toJid('+62 812-3456'), '628123456@s.whatsapp.net')
})
test('toJid: jids pass through', () => {
  assert.equal(toJid('1203630@g.us'), '1203630@g.us')
})
test('toJid: bare group id without domain fails loudly', () => {
  assert.throws(() => toJid('120363-1234'), /unclear chat address/)
})

// ── phoneFromJid / isGroup ──
test('phoneFromJid strips server and device suffix', () => {
  assert.equal(phoneFromJid('628123456789:12@s.whatsapp.net'), '628123456789')
  assert.equal(phoneFromJid('1203630@g.us'), null)
})
test('isGroup detects @g.us', () => {
  assert.equal(isGroup('1203630@g.us'), true)
  assert.equal(isGroup('62812@s.whatsapp.net'), false)
})

// ── command parsing ──

function fakeMessage(text, extra = {}) {
  const raw = {
    key: { remoteJid: '62812@s.whatsapp.net', id: 'X' },
    message: { conversation: text },
    messageTimestamp: 0,
    ...extra,
  }
  const sock = { user: { id: '62812:1@s.whatsapp.net' } }
  return new InboundMessage(raw, sock, PREFIXES)
}

test('command: !ping parsed', () => {
  const m = fakeMessage('!ping two words')
  assert.equal(m.command, 'ping')
  assert.equal(m.args, 'two words')
  assert.deepEqual(m.argv, ['two', 'words'])
})
test('command: every default prefix works', () => {
  for (const p of PREFIXES) assert.equal(fakeMessage(`${p}ping`).command, 'ping')
})
test('command: alias order — first word only', () => {
  assert.equal(fakeMessage('.ping hi').args, 'hi')
})
test('command: case-insensitive name', () => {
  assert.equal(fakeMessage('!PING').command, 'ping')
})
test('command: wrong prefix → empty command', () => {
  assert.equal(fakeMessage('ping').command, '')
})
test('command: prefix alone → empty command', () => {
  assert.equal(fakeMessage('!').command, '')
})

// ── message fields ──
test('describe: captioned image', () => {
  const m = fakeMessage('', {
    message: { imageMessage: { caption: 'kucing', mimetype: 'image/jpeg' } },
  })
  assert.equal(m.type, 'image')
  assert.equal(m.text, 'kucing')
  assert.equal(m.mediaInfo?.mime, 'image/jpeg')
})
test('describe: reaction emoji', () => {
  const m = fakeMessage('', { message: { reactionMessage: { text: '👍' } } })
  assert.equal(m.type, 'reaction')
  assert.equal(m.emoji, '👍')
})
test('quoted message is exposed with its own sender', () => {
  const m = fakeMessage('reply dulu', {
    message: {
      extendedTextMessage: {
        text: 'reply dulu',
        contextInfo: {
          stanzaId: 'inner-id',
          participant: '62899@s.whatsapp.net',
          quotedMessage: { conversation: 'pesan asli' },
        },
      },
    },
  })
  assert.equal(m.quoted.id, 'inner-id')
  assert.equal(m.quoted.text, 'pesan asli')
  assert.equal(m.quoted.senderId, '62899@s.whatsapp.net')
})

// ── reply result handling ──
test('mediaKind sniffs jpeg, png, webp, mp4, ogg', () => {
  assert.equal(mediaKind(Buffer.from('ffd8ffe0', 'hex')), 'image')
  assert.equal(mediaKind(Buffer.from('89504e47', 'hex')), 'image')
  const webp = Buffer.concat([Buffer.from('RIFF\x00\x00\x00\x00WEBP'), Buffer.alloc(4)])
  assert.equal(mediaKind(webp), 'sticker')
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(4)])
  assert.equal(mediaKind(mp4), 'video')
  assert.equal(mediaKind(Buffer.from('OggS')), 'audio')
  assert.equal(mediaKind(Buffer.from('mystery')), 'document')
})
test('contentFor: plain string', () => {
  assert.deepEqual(contentFor('hai'), { text: 'hai' })
})
test('contentFor: media object with url and caption', () => {
  assert.deepEqual(contentFor({ image: 'https://x/y.jpg', caption: 'nih' }), {
    image: { url: 'https://x/y.jpg' },
    caption: 'nih',
  })
})
test('contentFor: buffer is sniffed into the right field', () => {
  assert.deepEqual(contentFor(Buffer.from('ffd8ffe0', 'hex')), { image: Buffer.from('ffd8ffe0', 'hex') })
})
test('contentFor: document gets fileName and mimetype', () => {
  const c = contentFor({ document: Buffer.alloc(2), fileName: 'a.pdf', mime: 'application/pdf' })
  assert.equal(c.fileName, 'a.pdf')
  assert.equal(c.mimetype, 'application/pdf')
})
test('contentFor: media object without a media field fails loudly', () => {
  assert.throws(() => contentFor({ caption: 'tanpa isi' }), /needs one of/)
})
test('toMediaUpload wraps urls only', () => {
  assert.deepEqual(toMediaUpload('https://x'), { url: 'https://x' })
  const buf = Buffer.alloc(1)
  assert.ok(toMediaUpload(buf) === buf)
})

// ── poll message ──
test('describe: poll yields its question', () => {
  const m = fakeMessage('', {
    message: { pollCreationMessage: { name: 'Makan apa?', options: [] } },
  })
  assert.equal(m.type, 'poll')
  assert.equal(m.text, 'Makan apa?')
})

// ── emitter ──
test('emitter: fires and unsubscribes', () => {
  const e = new Emitter()
  let seen = 0
  const off = e.on('hit', (n) => (seen += n))
  e.emit('hit', 1)
  e.emit('hit', 2)
  assert.equal(seen, 3)
  off()
  e.emit('hit', 4)
  assert.equal(seen, 3)
})

// ── html → WhatsApp formatting ──
import { htmlToWa, renderHtml } from '../dist/html.js'
test('html: bold, italic, strike, code', () => {
  assert.equal(htmlToWa('<b>tebal</b> <i>miring</i>'), '*tebal* _miring_')
  assert.equal(htmlToWa('<s>hapus</s>'), '~hapus~')
  assert.equal(htmlToWa('<code>x = 1</code>'), '```x = 1```')
})
test('html: strong/em/del map the same way', () => {
  assert.equal(htmlToWa('<strong>A</strong><em>B</em><del>C</del>'), '*A*_B_~C~')
})
test('html: nested tags close correctly', () => {
  assert.equal(htmlToWa('<b>tebal <i>campur</i></b> polos'), '*tebal _campur_* polos')
})
test('html: unclosed tag closes itself', () => {
  assert.equal(htmlToWa('halo <b>dunia'), 'halo *dunia*')
})
test('html: <br> becomes newline, unknown tags are stripped', () => {
  assert.equal(htmlToWa('a<br>b<span>c</span><u>d</u>'), 'a\nbcd')
})
test('html: entities decoded', () => {
  assert.equal(htmlToWa('a &amp; b &lt;c&gt;'), 'a & b <c>')
})
test('html: link keeps url', () => {
  assert.equal(renderHtml('<a href="https://x.id">klik</a>'), 'klik (https://x.id)')
  assert.equal(renderHtml('<a href="https://x.id">https://x.id</a>'), 'https://x.id')
})
test('html: caption with markup in media result', () => {
  const c = contentFor({ image: 'https://x/y.jpg', caption: '<b>nih</b>' })
  assert.equal(c.caption, '*nih*')
})
test('html: { html } is a reply result on its own', () => {
  assert.deepEqual(contentFor({ html: '<b>hai</b>' }), { text: '*hai*' })
})

// ── config file ──
import { loadRaileysConfig } from '../dist/client.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const asyncTests = []
const atest = (name, fn) => asyncTests.push([name, fn])

atest('config: default export loads', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'raileys-'))
  const file = path.join(dir, 'raileys.config.mjs')
  await writeFile(file, 'export default { phone: "62812", prefix: ["#"] }')
  const conf = await loadRaileysConfig(file)
  assert.equal(conf.phone, '62812')
  assert.deepEqual(conf.prefix, ['#'])
})
atest('config: non-object export fails loudly', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'raileys-'))
  const file = path.join(dir, 'bad.mjs')
  await writeFile(file, 'export default 42')
  await assert.rejects(() => loadRaileysConfig(file), /must export default an options object/)
})
atest('config: missing file fails loudly', async () => {
  await assert.rejects(() => loadRaileysConfig('./does-not-exist.mjs'), /Cannot find|ERR_MODULE_NOT_FOUND/)
})

let failures = 0
for (const [name, fn] of tests) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (error) {
    failures++
    console.error(`✗ ${name}`)
    console.error(error?.message ?? error)
  }
}
for (const [name, fn] of asyncTests) {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (error) {
    failures++
    console.error(`✗ ${name}`)
    console.error(error?.message ?? error)
  }
}
console.log(failures ? `\n${failures} test(s) failed` : `\nAll ${tests.length} tests passed`)
process.exit(failures ? 1 : 0)

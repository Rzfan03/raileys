// Full bot in one file. Run: npm run try
// First run: pairing code (phone set) or QR (phone empty).
import raileys from '../dist/index.js'

const bot = raileys('6281234567890', {
  ping: 'pong', // string = static reply
  'halo|hi': (m) => `Halo ${m.name}!`,
  say: (m) => m.args || 'Kata-katanya mana?',

  // multi-step conversation
  daftar: async (m) => {
    const nama = await m.ask('Namamu siapa?')
    const umur = await m.ask('Umur berapa?', { validate: /^\d+$/, retry: 'Angka saja ya' })
    m.user.data.profile = { nama, umur: Number(umur) } // persists per user
    return `Terdaftar: ${nama} (${umur} th)`
  },
  profil: (m) => {
    const p = m.user.data.profile
    return p ? `${p.nama}, ${p.umur} th` : 'Belum daftar. Ketik .daftar'
  },

  // numbered menu + official poll
  menu: (m) =>
    m.menu('Pilih layanan:', [
      { title: 'Cek waktu', run: () => `Sekarang ${new Date().toLocaleTimeString('id-ID')}` },
      { title: 'Tentang bot', run: () => 'Raileys — bot WA simpel.' },
    ]),
  vote: (m) => m.poll('Makan apa?', ['Nasi goreng', 'Bakso', 'Mie ayam']),

  // HTML subset → WhatsApp formatting (*bold*, _italic_, ~strike~, mono)
  promo: () => ({ html: '<b>PROMO!</b> <i>gratis ongkir</i> s.d <s>besok</s><br><code>.daftar</code> sekarang' }),
  info: (m) => m.html('<b>Info:</b> ketik <b>.menu</b> untuk mulai'),

  // real visual buttons (unofficial path) — the tap runs the matching command
  saldo: () => 'Saldo: Rp 150.000',
  jam: () => `Sekarang ${new Date().toLocaleTimeString('id-ID')}`,
  tombol: (m) =>
    m.buttons('Mau apa?', [
      { id: 'saldo', text: 'Cek saldo' },
      { id: 'jam', text: 'Cek jam' },
    ], { footer: 'Ketuk tombolnya' }),

  // media: Buffer or URL, caption accepts the same HTML subset
  meme: () => ({ image: 'https://i.imgur.com/xxx.jpg', caption: '<b>nih</b>' }),
})

bot
  .cmd('kick', { group: true, admin: true }, (m) => m.kick(m.mentions))
  .on('image', 'gambar diterima!')
  .on('poll', (m) => console.log(`[raileys] poll dibuat: ${m.text}`))
  .on('button', (m) => console.log(`[raileys] tombol ditekan: ${m.buttonId}`))
  .on('join', () => 'Selamat datang!')

// escape hatch: bot.sock (raw Baileys), m.raw (raw WAMessage)

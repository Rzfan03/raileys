import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Per-user JSON storage. `m.user.data` is a plain object; whatever the bot
 * stores there survives restarts. One file per user, written after each
 * handler that touched it.
 */
export class UserStore {
  private readonly dir: string
  private readonly cache = new Map<string, Record<string, unknown>>()

  constructor(dir: string) {
    this.dir = dir
  }

  async load(userId: string): Promise<Record<string, unknown>> {
    const cached = this.cache.get(userId)
    if (cached) return cached
    const file = this.fileFor(userId)
    try {
      const data = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
      this.cache.set(userId, data)
      return data
    } catch {
      const fresh = {}
      this.cache.set(userId, fresh)
      return fresh
    }
  }

  async save(userId: string, data: Record<string, unknown>): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.fileFor(userId), JSON.stringify(data, null, 2))
  }

  private fileFor(userId: string): string {
    // jids contain ':' (device suffix) — not filename-safe everywhere
    return path.join(this.dir, userId.split('@')[0].split(':')[0] + '.json')
  }
}

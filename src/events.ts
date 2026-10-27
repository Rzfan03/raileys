/** Minimal typed event emitter — enough for a chat client, no dependency. */

export class Emitter<M extends Record<string, unknown>> {
  private handlers = new Map<keyof M, Set<(payload: unknown) => void>>()

  on<K extends keyof M>(name: K, fn: (payload: M[K]) => void): () => void {
    let set = this.handlers.get(name)
    if (!set) {
      set = new Set()
      this.handlers.set(name, set)
    }
    const wrapped = fn as (payload: unknown) => void
    set.add(wrapped)
    return () => set!.delete(wrapped)
  }

  emit<K extends keyof M>(name: K, payload: M[K]): void {
    const set = this.handlers.get(name)
    if (!set) return
    for (const fn of set) {
      try {
        fn(payload)
      } catch (error) {
        // a broken listener must not break the client
        console.error('[raileys] handler rejected:', error)
      }
    }
  }
}

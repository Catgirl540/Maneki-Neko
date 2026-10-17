// The server must propagate read/write errors. Browser storage fallbacks would
// silently replace a corrupt or unavailable database with seeded balances.
const PREFIX = 'luckycat.'
export const STORAGE_KEYS = { mockDb: 'mock.db', supportHistory: 'support.history.v1' }
export const storage = {
  get(key, fallback) {
    const raw = globalThis.window.localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : JSON.parse(raw)
  },
  set(key, value) { globalThis.window.localStorage.setItem(PREFIX + key, JSON.stringify(value)) },
  setMany(entries) {
    const values = entries.map(([key, value]) => [PREFIX + key, JSON.stringify(value)])
    globalThis.window.localStorage.setItemsAtomically(values)
    return true
  },
  remove(key) { globalThis.window.localStorage.removeItem(PREFIX + key) },
}

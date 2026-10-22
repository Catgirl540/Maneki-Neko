// The server must propagate read/write errors. Browser storage fallbacks would
// silently replace a corrupt or unavailable database with seeded balances.
const PREFIX = 'luckycat.'
export const STORAGE_KEYS = { mockDb: 'mock.db', supportHistory: 'support.history.v1' }
export const storage = {
  get(key, fallback) {
    if (globalThis.window.localStorage.getValue) return globalThis.window.localStorage.getValue(PREFIX + key) ?? fallback
    const raw = globalThis.window.localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : JSON.parse(raw)
  },
  set(key, value) {
    if (globalThis.window.localStorage.setValuesAtomically) return globalThis.window.localStorage.setValuesAtomically([[PREFIX + key, value]])
    globalThis.window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  },
  setMany(entries) {
    if (globalThis.window.localStorage.setValuesAtomically) {
      globalThis.window.localStorage.setValuesAtomically(entries.map(([key, value]) => [PREFIX + key, value]))
      return true
    }
    const values = entries.map(([key, value]) => [PREFIX + key, JSON.stringify(value)])
    globalThis.window.localStorage.setItemsAtomically(values)
    return true
  },
  remove(key) { globalThis.window.localStorage.removeItem(PREFIX + key) },
  get profileStore() { return globalThis.window.localStorage.scoped ? globalThis.window.localStorage : null },
}

import { createHash, randomUUID } from 'node:crypto'

export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** A bounded, transaction-local projection for the synchronous business rules.
 * Unrelated customers and their transaction histories never enter this process.
 * The raw localStorage interface remains available to offline import tools.
 */
export async function createScopedProfileStorage({ db, query, get, run, readProfile, saveProfile, postChanges, openCardPan, currentKey, profilesKey }) {
  const empty = () => ({ entries: new Map(), values: new Map(), profiles: new Map(), originals: new Map(), dirty: new Set(), current: null, originalCurrent: null, currentChanged: false })
  let frame = empty(), pending = null, starting = false
  const active = () => pending ?? frame
  async function load(owner, work = active()) {
    if (!owner) return null
    if (work.profiles.has(owner)) return work.profiles.get(owner)
    const original = {}
    const profile = await readProfile(owner, original)
    if (!profile) return null
    original.hash = fingerprint(profile)
    work.profiles.set(owner, profile); work.originals.set(owner, original)
    return profile
  }
  async function snapshot({ loadCurrent = true } = {}) {
    const work = empty()
    // Profile entries contain directory previews, never the runtime data source.
    for (const row of await query('SELECT key,value_json FROM app_storage WHERE key NOT IN (?,?)', currentKey, profilesKey)) work.entries.set(row.key, row.value_json)
    const binding = await get('SELECT owner_id FROM profile_bindings WHERE storage_key=? ORDER BY ordinal LIMIT 1', currentKey)
    if (binding) {
      work.originalCurrent = binding.owner_id
      if (loadCurrent) work.current = await load(binding.owner_id, work)
    }
    return work
  }
  function remember(profile, work) {
    if (!profile?.user?.id) throw new Error('Customer id is required')
    work.profiles.set(profile.user.id, profile); work.dirty.add(profile.user.id)
  }
  function setValue(key, value) {
    if (!pending) throw new Error('Scoped writes require an active database unit of work')
    const work = active()
    if (key === currentKey) {
      remember(value, work)
      work.currentChanged ||= work.originalCurrent !== value.user.id
      work.current = value
    } else if (key === profilesKey) {
      // This is a partial projection. Never replace/delete unrelated bindings.
      for (const profile of Object.values(value)) remember(profile, work)
    } else {
      work.values.set(key, value); work.entries.set(key, JSON.stringify(value)); work.dirty.add(key)
    }
  }
  function getValue(key) {
    const work = active()
    if (key === currentKey) return work.current
    if (key === profilesKey) return Object.fromEntries([...work.profiles.values()].map(profile => [profile.user.phone, profile]))
    if (!work.values.has(key)) {
      const raw = work.entries.get(key)
      if (raw === undefined || raw === null) return null
      work.values.set(key, JSON.parse(raw))
    }
    return work.values.get(key)
  }
  const storage = {
    scoped: true,
    activateProfile(profile) { active().current = profile },
    getValue,
    setValuesAtomically(entries) { for (const [key, value] of entries) setValue(key, value) },
    getItem(key) { const value = getValue(key); return value === null ? null : JSON.stringify(value) },
    setItem(key, raw) { setValue(key, JSON.parse(raw)) },
    setItemsAtomically(entries) { for (const [key, raw] of entries) setValue(key, JSON.parse(raw)) },
    removeItem(key) {
      if (!pending) throw new Error('Scoped writes require an active database unit of work')
      if (key === currentKey || key === profilesKey) throw new Error('Financial profiles cannot be removed')
      const work = active(); work.entries.set(key, null); work.values.delete(key); work.dirty.add(key)
    },
    clear() { throw new Error('Financial records cannot be cleared') },
    hasPendingWrites() { return Boolean(pending || frame.dirty.size) },
    async findProfileByPhone(phone) {
      const normalized = phone.replace(/\D/g, '')
      const cached = [...active().profiles.values()].find(profile => profile.user.phone === normalized)
      if (cached) return cached
      return load((await get('SELECT id FROM customers WHERE phone=?', normalized))?.id)
    },
    async findProfileByUserId(owner) {
      if (active().profiles.has(owner)) return active().profiles.get(owner)
      return load((await get('SELECT id FROM customers WHERE id=?', owner))?.id)
    },
    async recipientProfiles(number) {
      const normalized = number.replace(/\D/g, '')
      const owners = await query('SELECT owner_id FROM bank_accounts WHERE account_no=?', normalized)
      const cards = await query(`SELECT s.owner_id,s.card_id,s.pan FROM virtual_card_secrets s
        JOIN virtual_cards c ON c.owner_id=s.owner_id AND c.id=s.card_id WHERE c.last4=? AND c.status='active'`, normalized.slice(-4))
      for (const row of cards) if (openCardPan(row) === normalized) owners.push({ owner_id: row.owner_id })
      for (const row of owners) await load(row.owner_id)
      return [...active().profiles.values()]
    },
    async fpsProfiles(idType, id) {
      for (const row of await query('SELECT owner_id FROM fps_registrations WHERE id=?', `${idType}:${id}`)) await load(row.owner_id)
      return [...active().profiles.values()]
    },
    async searchCustomers(keyword) {
      const needle = String(keyword ?? '').trim().toLowerCase()
      const rows = await query(`SELECT c.id,c.name,c.phone,
        EXISTS(SELECT 1 FROM bank_transactions t WHERE t.owner_id=c.id AND t.pending_reason='inflight') AS held,
        EXISTS(SELECT 1 FROM virtual_cards v WHERE v.owner_id=c.id AND v.status='locked') AS locked
        FROM customers c WHERE strpos(lower(c.name || ' ' || c.phone || ' ' || c.id),?)>0 ORDER BY c.id`, needle)
      return rows.map(row => ({ user: { id: row.id, name: row.name, phone: row.phone },
        transactions: row.held ? [{ pendingReason: 'inflight' }] : [], cards: row.locked ? [{ status: 'locked' }] : [] }))
    },
    async settlementOwners(after = '', limit = 25) {
      return query(`SELECT owner_id FROM (
        SELECT owner_id FROM bank_transactions WHERE status='pending'
        UNION SELECT owner_id FROM bank_background_tasks WHERE due_at<=CURRENT_TIMESTAMP
        ) due WHERE owner_id>? ORDER BY owner_id LIMIT ?`, after, limit)
    },
    releaseProjection() { if (!pending) frame = empty() },
    async beginUnitOfWork({ requestId = randomUUID(), loadCurrent = true } = {}) {
      if (pending || starting) throw new Error('A database unit of work is already active')
      if (typeof requestId !== 'string' || !requestId || requestId.length > 200) throw new Error('Invalid request id')
      if (frame.dirty.size) throw new Error('Start a unit of work before changing scoped profiles')
      starting = true
      try {
        await db.begin()
        await db.query('SELECT pg_advisory_xact_lock(782614101)')
        pending = await snapshot({ loadCurrent }); pending.requestId = requestId
      } catch (error) { await db.rollback(); throw error }
      finally { starting = false }
    },
    async commitUnitOfWork() {
      if (!pending) throw new Error('No database unit of work is active')
      const work = pending, changes = []
      try {
        for (const owner of work.dirty) {
          const profile = work.profiles.get(owner)
          if (profile) {
            const original = work.originals.get(owner)
            if (original?.hash === fingerprint(profile)) continue
            await saveProfile(profile, changes, original)
            // Phone changes remove only this owner's old directory membership.
            await run('DELETE FROM profile_bindings WHERE storage_key=? AND owner_id=? AND member_key<>?', profilesKey, owner, profile.user.phone)
            await run(`INSERT INTO app_storage(key,value_json) VALUES (?, '{}') ON CONFLICT(key) DO NOTHING`, profilesKey)
            await run(`INSERT INTO profile_bindings(storage_key,member_key,owner_id,ordinal) VALUES (?,?,?,0)
              ON CONFLICT(storage_key,member_key) DO UPDATE SET owner_id=excluded.owner_id`, profilesKey, profile.user.phone, owner)
          } else {
            const raw = work.entries.get(owner)
            if (raw === null) await run('DELETE FROM app_storage WHERE key=?', owner)
            else await run('INSERT INTO app_storage(key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP', owner, raw)
          }
        }
        await postChanges(changes, work.requestId)
        if (work.currentChanged && work.current && work.current.user.id !== work.originalCurrent) {
          await run(`INSERT INTO app_storage(key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`, currentKey, JSON.stringify({ user: { id: work.current.user.id, name: work.current.user.name, phone: work.current.user.phone } }))
          await run('DELETE FROM profile_bindings WHERE storage_key=?', currentKey)
          await run('INSERT INTO profile_bindings(storage_key,member_key,owner_id,ordinal) VALUES (?,\'\',?,0)', currentKey, work.current.user.id)
        }
        await db.commit()
        work.dirty.clear(); frame = work; pending = null
      } catch (error) {
        await db.rollback(); pending = null; frame = await snapshot(); throw error
      }
    },
    async rollbackUnitOfWork() {
      if (!pending) return
      try { await db.rollback() } finally { pending = null; frame = await snapshot() }
    },
    async flush() { throw new Error('Scoped profiles must be saved inside a unit of work') },
    async refresh() {
      if (pending || frame.dirty.size) throw new Error('Cannot refresh while profile writes are pending')
      frame = await db.transaction(snapshot)
    },
  }
  frame = await db.transaction(snapshot)
  return storage
}

/** Cumulative assistant snapshots replace older prefixes in the replay cache.
 * Live subscribers still receive every frame; durable history remains in SQL.
 */
export function isReplayCheckpoint(entry, event, now = Date.now()) {
  if (event.type === 'card-secret') return false
  if (entry && event.type === 'assistant-update') {
    const previous = entry.assistantCheckpoint
    if (previous?.messageId === event.messageId && now - previous.at < 1000) return false
    entry.assistantCheckpoint = { messageId: event.messageId, at: now }
  }
  return true
}

export function retainReplayEvent(entry, item, { maxEvents = 256, maxBytes = 1024 * 1024 } = {}) {
  const events = entry.events ??= []
  const event = item.event
  if (event.messageId && ['assistant-update', 'assistant', 'assistant-reset'].includes(event.type)) {
    for (let i = events.length - 1; i >= 0; i--) {
      const previous = events[i].event
      if (previous.type === 'assistant-update' && previous.messageId === event.messageId) events.splice(i, 1)
    }
  }
  events.push(item)
  let bytes = events.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)), 0)
  while (events.length > 1 && (events.length > maxEvents || bytes > maxBytes)) bytes -= Buffer.byteLength(JSON.stringify(events.shift()))
  entry.replayBytes = bytes
}

export function compactReplay(entry) {
  const events = entry.events ?? []
  entry.events = []
  for (const item of events) retainReplayEvent(entry, item)
  return entry
}

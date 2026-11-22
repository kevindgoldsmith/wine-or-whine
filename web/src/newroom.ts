import { hostKeyKey, seatStore } from './net'

/**
 * Create a room and go to it. From a phone, this browser keeps the host key and its player becomes host.
 * From the TV board (`fromTv`), the TV shows the lobby and the first phone to join becomes host.
 */
export async function createRoomAndGo(fromTv: boolean): Promise<void> {
  const r = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fromTv ? { from: 'tv' } : {}),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || 'generic')
  if (!fromTv) seatStore.set(hostKeyKey(body.code), body.host_key)
  location.href = fromTv ? `/${body.code}/tv` : `/${body.code}`
}

import { hostKeyKey, seatStore, store, tvKeyKey } from './net'

/**
 * Create a room and go to it. From a phone, this browser keeps the host key and its player becomes host.
 * From the TV board (`fromTv`), the TV keeps the host key and is the host (it can hand hosting to a phone).
 */
export async function createRoomAndGo(fromTv: boolean): Promise<void> {
  const r = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fromTv ? { from: 'tv' } : {}),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || 'generic')
  if (fromTv) store.set(tvKeyKey(body.code), body.host_key)
  else seatStore.set(hostKeyKey(body.code), body.host_key)
  location.href = fromTv ? `/${body.code}/tv` : `/${body.code}`
}

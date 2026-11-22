// Resilient WebSocket: reconnects with backoff, on wake (visibilitychange) and on the `online` event,
// detects dead sockets via the server's 20 s pings, and resends unacknowledged actions (the server
// de-duplicates them by action id, so double taps and retries are harmless).

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'gone'

const BACKOFF = [500, 1000, 2000, 4000, 5000]
const DEAD_AFTER_MS = 45_000 // two missed pings

export const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      /* private mode: fine, we just won't remember */
    }
  },
}

export const tokenKey = (code: string) => `wow:${code}:token`
export const hostKeyKey = (code: string) => `wow:${code}:host`

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function wsUrl(code: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws/${code}`
}

export class Connection {
  private ws: WebSocket | null = null
  private attempt = 0
  private timer: number | undefined
  private lastSeen = Date.now()
  private pending = new Map<string, any>()
  private closed = false
  status: ConnStatus = 'connecting'

  constructor(
    private code: string,
    private kind: 'player' | 'tv',
    private onMessage: (m: any) => void,
    private onStatus: (s: ConnStatus) => void,
  ) {
    document.addEventListener('visibilitychange', this.onVisible)
    window.addEventListener('online', this.reconnectNow)
    window.addEventListener('pageshow', this.onVisible)
    setInterval(this.watchdog, 5000)
    this.connect()
  }

  private setStatus(s: ConnStatus) {
    this.status = s
    this.onStatus(s)
  }

  private connect = () => {
    if (this.closed) return
    clearTimeout(this.timer)
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    const ws = new WebSocket(wsUrl(this.code))
    this.ws = ws
    ws.onopen = () => {
      if (ws !== this.ws) return
      this.attempt = 0
      this.lastSeen = Date.now()
      const token = this.kind === 'player' ? store.get(tokenKey(this.code)) : null
      ws.send(JSON.stringify({ t: 'hello', kind: this.kind, token }))
      for (const msg of this.pending.values()) ws.send(JSON.stringify(msg))
      this.setStatus('open')
    }
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return
      this.lastSeen = Date.now()
      let msg: any
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.t === 'ping') {
        ws.send('{"t":"pong"}')
        return
      }
      if ((msg.t === 'ack' || msg.t === 'error') && msg.id) {
        const quiet = this.pending.get(msg.id)?.resent
        this.pending.delete(msg.id)
        if (quiet && msg.t === 'error') return
      }
      if (msg.t === 'welcome' && msg.token) store.set(tokenKey(this.code), msg.token)
      if (msg.t === 'kicked') store.set(tokenKey(this.code), null)
      if (msg.t === 'error' && msg.code === 'room_missing') {
        this.closed = true
        this.setStatus('gone')
      }
      this.onMessage(msg)
    }
    ws.onclose = (ev) => {
      if (ws !== this.ws) return
      if (ev.code === 4404 || this.closed) {
        this.closed = true
        this.setStatus('gone')
        return
      }
      this.setStatus('reconnecting')
      const base = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)]
      this.attempt++
      this.timer = window.setTimeout(this.connect, base * (0.75 + Math.random() * 0.5))
    }
  }

  private reconnectNow = () => {
    if (this.closed) return
    if (this.ws && this.ws.readyState === WebSocket.OPEN && Date.now() - this.lastSeen < 25_000) return
    this.attempt = 0
    this.connect()
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible') this.reconnectNow()
  }

  private watchdog = () => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && Date.now() - this.lastSeen > DEAD_AFTER_MS) {
      this.connect()
    }
  }

  send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  /** Send an action that must arrive exactly once. Retried after reconnects until acknowledged. */
  private reliable(t: string, a: any, extra: any = {}) {
    const id = newId()
    const msg = { t, id, a, ...extra }
    this.pending.set(id, msg)
    this.send(msg)
    // Mark as a resend for later attempts, so stale retries fail quietly.
    setTimeout(() => {
      const m = this.pending.get(id)
      if (m) m.resent = true
    }, 50)
    return id
  }

  act(a: any) {
    return this.reliable('act', a)
  }

  host(a: any) {
    return this.reliable('host', a)
  }

  join(name: string, hostKey: string | null) {
    this.send({ t: 'join', name, host_key: hostKey })
  }

  rejoin(playerId: string, code: string) {
    this.send({ t: 'rejoin', player_id: playerId, code })
  }

  hello() {
    this.send({ t: 'hello', kind: this.kind, token: store.get(tokenKey(this.code)) })
  }
}

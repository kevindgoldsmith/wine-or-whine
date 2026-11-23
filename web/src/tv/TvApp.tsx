import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { GameView, RoomView, StateMsg } from '../types'
import { DEFAULT_THEME, errorText, loadTheme, onTheme, theme, ui } from '../theme'
import { Connection, type ConnStatus } from '../net'
import { lobbyMusic, playSfx, say, setMuted, unlockAudio } from '../audio'
import { beatsFor, type Beat } from './beats'
import { BeatOverlay, Board, Credit, TvLobby } from './board'
import { NapaScene } from '../scenery'
import { Icon } from '../icons'
import { createRoomAndGo } from '../newroom'
import { Lobby } from '../phone/lobby'

const MUTE_KEY = 'wow:tvmute'

export function TvApp(props: { code: string }) {
  const [msg, setMsg] = useState<StateMsg | null>(null)
  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [started, setStarted] = useState(false)
  const [muted, setMutedState] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [queue, setQueue] = useState<Beat[]>([])
  const [, force] = useState(0)
  const startedRef = useRef(false)
  const namesRef = useRef<string[]>([])

  useEffect(() => onTheme(() => force((x) => x + 1)) as any, [])
  useEffect(() => {
    loadTheme(DEFAULT_THEME).catch(() => {})
  }, [])
  useEffect(() => setMuted(muted), [muted])

  const [drawer, setDrawer] = useState(false)
  const [code, setCode] = useState<{ name: string; code: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const conn = useMemo(
    () =>
      new Connection(props.code, 'tv', (m) => {
        if (m.t === 'rejoin_code') {
          setCode({ name: m.name, code: m.code })
          return
        }
        if (m.t === 'error' && m.code !== 'room_missing') {
          setError(m.code)
          setTimeout(() => setError(null), 5000)
          return
        }
        if (m.t !== 'state') return
        setMsg(m)
        const room: RoomView = m.room
        const ids = room.seat_ids.length ? room.seat_ids : room.players.map((p) => p.id)
        namesRef.current = ids.map((id) => room.players.find((p) => p.id === id)?.name ?? '?')
        if (!startedRef.current) return
        if (m.events?.length) {
          const beats = beatsFor(m.events, namesRef.current, m.game)
          for (const b of beats.filter((b) => b.ms === 0)) if (b.sfx) void playSfx(b.sfx, 0.6)
          const visible = beats.filter((b) => b.ms > 0)
          if (visible.length) {
            const ending = visible.findIndex((b) => b.kind === 'reveal-chief' || b.kind.startsWith('win-'))
            // Game over: skip straight to the ending. Otherwise keep only the newest beats so the TV never lags far behind.
            setQueue((q) => (ending >= 0 ? visible.slice(ending) : [...q, ...visible].slice(-6)))
          }
        }
        if (m.say?.length && room.voice) say(m.say)
      }, setStatus),
    [props.code],
  )

  const room = msg?.room
  const g = msg?.game ?? null
  useEffect(() => {
    if (room?.theme) loadTheme(room.theme).catch(() => {})
  }, [room?.theme])

  // Beat queue: one at a time; speed up when events pile up. Never blocks the game.
  const current = queue[0]
  useEffect(() => {
    if (!current) return
    if (current.sfx) void playSfx(current.sfx)
    const speed = queue.length > 4 ? 0.35 : queue.length > 2 ? 0.6 : 1
    const t = setTimeout(() => setQueue((q) => q.slice(1)), current.ms * speed)
    return () => clearTimeout(t)
  }, [current?.id])

  const inLobby = !g || room?.status === 'lobby'
  useEffect(() => {
    if (started) lobbyMusic(inLobby && !muted)
  }, [started, inLobby, muted])

  if (!theme()) return <main class="tv-root" />
  if (!started) {
    return (
      <main class="tv-root tv-start" onClick={async () => {
        await unlockAudio()
        startedRef.current = true
        setStarted(true)
      }}>
        <div class="tv-start-card">
          <NapaScene class="tv-start-scene" />
          <h1 class="tv-title">{ui('app_title')}</h1>
          <button type="button" class="tv-tap">{ui('tv_tap')}</button>
          <p class="tv-tap-sub">{ui('tv_tap_sub')}</p>
        </div>
      </main>
    )
  }
  if (status === 'gone') {
    return (
      <main class="tv-root tv-start">
        <p class="tv-big">{ui('room_missing')}</p>
        <NewTripButton />
      </main>
    )
  }
  if (!msg || !room) return <main class="tv-root tv-start"><p class="tv-big">{ui('connecting')}</p></main>

  const toggleMute = () => {
    const m = !muted
    setMutedState(m)
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  const names = namesRef.current
  const tvAdmin = !!msg.tv_admin
  const tvHost = tvAdmin && room.host_id === 'tv'
  const hushed = !!g && ['pres_discard', 'chanc_enact', 'veto_response'].includes(g.phase)
  return (
    <main class={`tv-root ${hushed ? 'hushed' : ''}`}>
      {status !== 'open' ? <div class="conn-banner">{ui('reconnecting')}</div> : null}
      <div class="tv-corner">
        {tvAdmin ? <button type="button" class="tv-mute tv-host-btn" onClick={() => setDrawer(true)}><Icon name="chief" /> {ui('tv_host_button')}</button> : null}
        <button type="button" class="tv-mute" aria-pressed={muted} onClick={toggleMute}>{muted ? ui('tv_unmute') : ui('tv_mute')}</button>
      </div>
      {inLobby || !g ? <TvLobby room={room} conn={tvHost ? conn : null} /> : <Board g={g} names={names} code={room.code} newTrip={<NewTripButton />} />}
      {drawer && tvAdmin ? (
        <HostDrawer room={room} g={g} conn={conn} tvHost={tvHost} error={error} code={code} onCode={setCode}
          onClose={() => {
            setDrawer(false)
            setCode(null)
          }} />
      ) : null}
      {current ? <BeatOverlay beat={current} names={names} /> : null}
      {room.paused ? <div class="tv-paused"><h2>{ui('paused')}</h2><p>{ui('paused_body')}</p></div> : null}
      <Credit />
    </main>
  )
}

function NewTripButton() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  return (
    <>
      <button type="button" class="tv-new" disabled={busy} onClick={async () => {
        setBusy(true)
        try {
          await createRoomAndGo(true)
        } catch {
          setErr(true)
          setBusy(false)
        }
      }}>{ui('tv_new_trip')}</button>
      {err ? <p class="error">{ui('err_generic')}</p> : null}
    </>
  )
}

/** Host controls for the TV that created the room (opened from the 👑 Host button). */
function HostDrawer(props: {
  room: RoomView
  g: GameView | null
  conn: Connection
  tvHost: boolean
  error: string | null
  code: { name: string; code: string } | null
  onCode: (c: { name: string; code: string } | null) => void
  onClose: () => void
}) {
  const { room, conn, tvHost } = props
  const [hints, setHints] = useState(false)
  const [codeFor, setCodeFor] = useState('')
  useEffect(() => {
    if (!props.code) return
    const t = setTimeout(() => props.onCode(null), 20000) // codes vanish from the shared screen
    return () => clearTimeout(t)
  }, [props.code])
  const hostName = room.host_id === 'tv' ? ui('tv_the_tv') : room.players.find((p) => p.id === room.host_id)?.name ?? '?'
  return (
    <aside class="tv-drawer" role="dialog" aria-label={ui('tv_host_button')}>
      <div class="modal-head">
        <h2>{ui('tv_host_button')}</h2>
        <button type="button" class="ghost" onClick={props.onClose}>{ui('close')}</button>
      </div>
      {props.error ? <p class="error">{errorText(props.error)}</p> : null}
      <section>
        <h3>{ui('tv_current_host', { name: hostName })}</h3>
        {!tvHost ? (
          <button type="button" class="primary big" onClick={() => conn.host({ type: 'make_host', player_id: 'tv' })}>{ui('tv_take_host')}</button>
        ) : null}
        <label class="field">
          {ui('tv_make_host')}
          <select value="" onChange={(e) => {
            const id = (e.target as HTMLSelectElement).value
            if (id) conn.host({ type: 'make_host', player_id: id })
          }}>
            <option value="">—</option>
            {room.players.filter((p) => p.id !== room.host_id).map((p) => <option value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </section>
      {tvHost && room.status === 'lobby' ? (
        <Lobby conn={conn} room={room} meId="" isHost error={null} embedded />
      ) : null}
      {tvHost && room.status === 'active' ? (
        <section class="host-panel">
          <button type="button" class="primary big" onClick={() => conn.host({ type: room.paused ? 'resume' : 'pause' })}>
            {room.paused ? ui('resume') : ui('pause')}
          </button>
        </section>
      ) : null}
      {tvHost && room.status === 'over' ? (
        <section class="host-panel">
          <label class="toggle">
            <input type="checkbox" checked={hints} onChange={(e) => setHints((e.target as HTMLInputElement).checked)} />
            {ui('lobby_hints')}
          </label>
          <button type="button" class="primary big" onClick={() => conn.host({ type: 'play_again', hints })}>{ui('play_again')}</button>
          <button type="button" class="big" onClick={() => conn.host({ type: 'back_to_lobby' })}>{ui('new_players')}</button>
        </section>
      ) : null}
      {tvHost && room.status !== 'lobby' ? (
        <label class="toggle">
          <input type="checkbox" checked={room.voice} onChange={(e) => conn.host({ type: 'voice', on: (e.target as HTMLInputElement).checked })} />
          {ui('lobby_voice')}
        </label>
      ) : null}
      <section>
        <h3>{ui('tv_rejoin_title')}</h3>
        <p class="muted">{ui('tv_rejoin_hint')}</p>
        <div class="tv-code-row">
          <select value={codeFor} onChange={(e) => setCodeFor((e.target as HTMLSelectElement).value)}>
            <option value="">—</option>
            {room.players.map((p) => <option value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" class="big" disabled={!codeFor} onClick={() => conn.host({ type: 'rejoin_code', player_id: codeFor })}>{ui('tv_show_code')}</button>
        </div>
        {props.code ? <p class="tv-one-code">{props.code.name}: <code>{props.code.code}</code></p> : null}
      </section>
    </aside>
  )
}

import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { StateMsg } from '../types'
import { DEFAULT_THEME, errorText, loadTheme, onTheme, theme, ui } from '../theme'
import { Connection, type ConnStatus, store } from '../net'
import { buzz, GameCtx, Modal } from './common'
import { JoinScreen, Lobby, RejoinScreen } from './lobby'
import { CatchUp, GameOver, Header, OutScreen, RoleReveal, TurnArea } from './game'

const DISCREET_KEY = 'wow:discreet'

export function PhoneApp(props: { code: string }) {
  const [msg, setMsg] = useState<StateMsg | null>(null)
  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [kicked, setKicked] = useState(false)
  const [codes, setCodes] = useState<{ id: string; name: string; code: string }[] | null>(null)
  const [rejoinMode, setRejoinMode] = useState(false)
  const [catchUp, setCatchUp] = useState(false)
  const [menu, setMenu] = useState(false)
  const [discreet, setDiscreetState] = useState(store.get(DISCREET_KEY) === '1')
  const [, force] = useState(0)
  const errTimer = useRef<number>()

  useEffect(() => onTheme(() => force((x) => x + 1)) as any, [])
  useEffect(() => {
    loadTheme(DEFAULT_THEME).catch(() => {})
  }, [])

  const conn = useMemo(
    () =>
      new Connection(
        props.code,
        'player',
        (m) => {
          if (m.t === 'state') {
            setMsg(m)
            if (m.me) setKicked(false)
          } else if (m.t === 'error') {
            setError(m.code)
            clearTimeout(errTimer.current)
            errTimer.current = window.setTimeout(() => setError(null), 5000)
          } else if (m.t === 'kicked') {
            setKicked(true)
          } else if (m.t === 'welcome') {
            setError(null)
            setRejoinMode(false)
          } else if (m.t === 'rejoin_codes') {
            setCodes(m.codes)
          } else if (m.t === 'signed_out') {
            store.set(`wow:${props.code}:token`, null)
          }
        },
        setStatus,
      ),
    [props.code],
  )

  useEffect(() => {
    if (msg?.room.theme) loadTheme(msg.room.theme).catch(() => {})
  }, [msg?.room.theme])

  const setDiscreet = (v: boolean) => {
    store.set(DISCREET_KEY, v ? '1' : '0')
    setDiscreetState(v)
  }

  const g = msg?.game ?? null
  const room = msg?.room
  const me = msg?.me
  const mySeat = g?.me ?? null
  const myTurn = !!g && mySeat !== null && g.waiting_on.includes(mySeat) && g.phase !== 'reveal'
  const turnKey = g ? `${g.day}-${g.phase}-${myTurn}` : ''
  useEffect(() => {
    if (myTurn) buzz()
  }, [turnKey])

  useEffect(() => {
    document.documentElement.classList.toggle('discreet', discreet)
  }, [discreet])

  const names = useMemo(() => {
    if (!room) return []
    const ids = room.seat_ids.length ? room.seat_ids : room.players.map((p) => p.id)
    return ids.map((id) => room.players.find((p) => p.id === id)?.name ?? '?')
  }, [room])

  if (!theme()) return <main class="screen center"><p class="status-line">…</p></main>
  if (status === 'gone') return <main class="screen center"><h1 class="display">{ui('app_title')}</h1><p>{ui('room_missing')}</p><a class="primary big" href="/">{ui('back')}</a></main>
  if (!msg || !room) return <main class="screen center"><p class="status-line">{ui('connecting')}</p></main>

  const banner = status !== 'open' ? <div class="conn-banner">{ui('reconnecting')}</div> : null
  const ctx = { discreet, hints: room.hints, names, me: mySeat }
  const discreetToggle = (
    <button type="button" class={`small toggle-btn ${discreet ? 'on' : ''}`} aria-pressed={discreet} onClick={() => setDiscreet(!discreet)}>
      {ui('header_discreet')} {discreet ? '●' : '○'}
    </button>
  )

  if (kicked) return <main class="screen center"><p>{ui('kicked')}</p></main>

  if (!me) {
    const content =
      room.status === 'lobby' && !rejoinMode ? (
        <JoinScreen conn={conn} room={room} error={error} onRejoin={() => setRejoinMode(true)} />
      ) : (
        <RejoinScreen conn={conn} room={room} error={error} onBack={room.status === 'lobby' ? () => setRejoinMode(false) : undefined} />
      )
    return <GameCtx.Provider value={ctx}>{banner}{content}</GameCtx.Provider>
  }

  const isHost = me.host
  const hostMenu = isHost ? (
    <button type="button" class="small" aria-label="Host" onClick={() => setMenu(true)}>⋯</button>
  ) : null
  const menuModal = menu ? (
    <Modal title={ui('lobby_host_badge')} onClose={() => setMenu(false)}>
      {room.status === 'active' ? (
        <button type="button" class="big" onClick={() => {
          conn.host({ type: room.paused ? 'resume' : 'pause' })
          setMenu(false)
        }}>{room.paused ? ui('resume') : ui('pause')}</button>
      ) : null}
      <button type="button" class="big" onClick={() => conn.host({ type: 'rejoin_codes' })}>{ui('lobby_rejoin_codes')}</button>
      {codes ? (
        <>
          <p class="muted">{ui('lobby_rejoin_hint')}</p>
          <ul class="codes">{codes.map((c) => <li><span>{c.name}</span><code>{c.code}</code></li>)}</ul>
        </>
      ) : null}
      <label class="toggle">
        <input type="checkbox" checked={room.voice} onChange={(e) => conn.host({ type: 'voice', on: (e.target as HTMLInputElement).checked })} />
        {ui('lobby_voice')}
      </label>
    </Modal>
  ) : null

  let content: any
  if (room.status === 'lobby' || !g) {
    content = <Lobby conn={conn} room={room} meId={me.id} isHost={isHost} error={error} />
    return <GameCtx.Provider value={ctx}>{banner}{content}{isHost ? <div class="lobby-menu">{hostMenu}</div> : null}{menuModal}</GameCtx.Provider>
  }

  if (g.phase === 'game_over') {
    content = <GameOver g={g} room={room} isHost={isHost} conn={conn} />
  } else if (g.phase === 'reveal' && mySeat !== null && !g.acked.includes(mySeat) && !g.spectator) {
    content = <RoleReveal g={g} conn={conn} discreetToggle={discreetToggle} />
  } else {
    content = (
      <main class="screen game">
        <Header g={g} onCatchUp={() => setCatchUp(true)} discreetToggle={discreetToggle} hostMenu={hostMenu} />
        <PhoneReadBanner g={g} names={names} code={`${room.code}:${room.games_played}`} />
        {g.spectator ? <OutScreen g={g} /> : <TurnArea g={g} send={(a) => conn.act(a)} />}
        {error ? <p class="error toast">{errorText(error)}</p> : null}
      </main>
    )
  }
  return (
    <GameCtx.Provider value={ctx}>
      {banner}
      {content}
      {catchUp && g ? <CatchUp g={g} onClose={() => setCatchUp(false)} /> : null}
      {menuModal}
      {room.paused ? (
        <div class="paused-overlay">
          <h2>{ui('paused')}</h2>
          <p>{ui('paused_body')}</p>
          {isHost ? <button type="button" class="primary big" onClick={() => conn.host({ type: 'resume' })}>{ui('resume')}</button> : null}
        </div>
      ) : null}
    </GameCtx.Provider>
  )
}

function PhoneReadBanner(props: { g: any; names: string[]; code: string }) {
  const by: number[] = props.g.phone_read_by ?? []
  const key = `wow:${props.code}:readseen`
  const [seen, setSeen] = useState(Number(sessionStorage.getItem(key) ?? '0'))
  if (by.length <= seen) return null
  return (
    <div class="banner" role="status">
      <span>📱 {ui('result_phone_read', { name: props.names[by[by.length - 1]] })}</span>
      <button type="button" class="ghost" onClick={() => {
        sessionStorage.setItem(key, String(by.length))
        setSeen(by.length)
      }}>{ui('close')}</button>
    </div>
  )
}

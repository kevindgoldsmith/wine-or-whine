import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { GameView, RoomView, StateMsg } from '../types'
import { DEFAULT_THEME, cardName, icon, loadTheme, onTheme, powerName, roleName, term, theme, ui } from '../theme'
import { Connection, type ConnStatus } from '../net'
import { lobbyMusic, playSfx, say, setMuted, unlockAudio } from '../audio'
import { beatsFor, type Beat } from './beats'
import { createRoomAndGo } from '../newroom'

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

  useMemo(
    () =>
      new Connection(props.code, 'tv', (m) => {
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
        <h1 class="tv-title">{ui('app_title')}</h1>
        <button type="button" class="tv-tap">{ui('tv_tap')}</button>
        <p>{ui('tv_tap_sub')}</p>
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
  const hushed = !!g && ['pres_discard', 'chanc_enact', 'veto_response'].includes(g.phase)
  return (
    <main class={`tv-root ${hushed ? 'hushed' : ''}`}>
      {status !== 'open' ? <div class="conn-banner">{ui('reconnecting')}</div> : null}
      <button type="button" class="tv-mute" onClick={toggleMute}>{muted ? `🔇 ${ui('tv_unmute')}` : `🔊 ${ui('tv_mute')}`}</button>
      {inLobby || !g ? <TvLobby room={room} /> : <Board g={g} names={names} beat={current} />}
      {current ? <BeatOverlay beat={current} names={names} /> : null}
      {room.paused ? <div class="tv-paused"><h2>{ui('paused')}</h2><p>{ui('paused_body')}</p></div> : null}
      <footer class="tv-credit">{theme()!.credit}</footer>
    </main>
  )
}

function TvLobby(props: { room: RoomView }) {
  const r = props.room
  return (
    <section class="tv-lobby">
      <div class="tv-lobby-left">
        <h1 class="tv-title">{ui('app_title')}</h1>
        <p class="tv-tagline">{theme()!.tagline}</p>
        <p class="tv-join">{ui('tv_join_at')}</p>
        <p class="tv-url">{r.join_url.replace(/^https?:\/\//, '')}</p>
        <div class="tv-code">{r.code}</div>
        <p class="tv-sub">{ui('lobby_need_players', { n: r.players.length })}</p>
        {r.first_joiner_hosts && !r.host_id ? <p class="tv-sub">👑 {ui('tv_first_host')}</p> : null}
        <ul class="tv-names">
          {r.players.map((p) => <li class={p.online ? '' : 'off'}>{p.name}</li>)}
        </ul>
      </div>
      <img class="tv-qr" src={`/api/rooms/${r.code}/qr.svg`} alt="" />
    </section>
  )
}

function seatPos(i: number, n: number) {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
  return { x: 50 + 42 * Math.cos(a), y: 50 + 38 * Math.sin(a) }
}

function statusText(g: GameView, names: string[]) {
  const pres = names[g.president]
  switch (g.phase) {
    case 'reveal':
      return ui('tv_check_roles')
    case 'nominate':
      return ui('waiting_nominate', { name: pres })
    case 'vote':
      return ui('tv_waiting_votes', { n: g.waiting_on.length })
    case 'pres_discard':
    case 'chanc_enact':
      return ui('shh')
    case 'veto_response':
      return ui('waiting_veto', { pres, planner: names[g.chancellor!] })
    case 'power':
      return ui('waiting_power', { name: pres, power: powerName(g.power!) })
    case 'power_result':
      return ui('waiting_result', { name: pres })
    default:
      return ''
  }
}

function TrackRow(props: { kind: 'B' | 'O'; filled: number; board?: (string | null)[] }) {
  const th = theme()!
  const caps = props.kind === 'B' ? th.tracks.breezy : th.tracks.over
  const prev = useRef(props.filled)
  const fresh = props.filled > prev.current ? props.filled : 0
  useEffect(() => {
    prev.current = props.filled
  }, [props.filled])
  return (
    <div class={`tv-track tv-track-${props.kind}`}>
      <div class="tv-track-label">
        <span aria-hidden="true">{props.kind === 'B' ? icon('breezy') : icon('over')}</span>{' '}
        {props.kind === 'B' ? term('breezy_plural') : term('over_plural')}
      </div>
      <div class="tv-slots">
        {caps.map((c, i) => {
          const filled = i < props.filled
          const power = props.board?.[i]
          return (
            <div class={`tv-slot ${filled ? 'filled' : ''} ${fresh === i + 1 ? 'fresh' : ''}`}>
              <div class="tv-slot-card">{filled ? (props.kind === 'B' ? icon('breezy') : icon('over')) : power ? icon(power) : ''}</div>
              <div class="tv-slot-cap">{c}</div>
              {!filled && power ? <div class="tv-slot-power">{powerName(power)}</div> : null}
              {props.kind === 'O' && i === 4 && !filled ? <div class="tv-slot-power">✋ {term('veto')}</div> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Board(props: { g: GameView; names: string[]; beat?: Beat }) {
  const { g, names } = props
  const over = g.phase === 'game_over'
  const n = g.n
  const nom = g.nominee ?? (['pres_discard', 'chanc_enact', 'veto_response'].includes(g.phase) ? g.chancellor : null)
  const p1 = seatPos(g.president, n)
  const p2 = nom !== null ? seatPos(nom, n) : null
  return (
    <section class="tv-board">
      <header class="tv-top">
        <div class="tv-day">{over ? ui('game_over') : ui('header_day', { n: Math.max(g.day, 1) })}</div>
        <div class="tv-status">{over ? `${theme()!.winner_title[g.winner!]} ${theme()!.win[g.win_reason!]}` : statusText(g, names)}</div>
      </header>
      <div class="tv-main">
        <div class="tv-tracks">
          <TrackRow kind="B" filled={g.breezy} />
          <TrackRow kind="O" filled={g.over} board={g.board} />
          <div class="tv-meta">
            <div class="tv-meter">
              <span>{term('meter')}</span>
              {[1, 2, 3].map((i) => <span class={`tv-meter-dot ${i <= g.meter ? 'on' : ''}`}>{i}</span>)}
            </div>
            <div class="tv-piles">
              <span>{ui('tv_deck', { n: g.deck_count })}</span>
              <span>{ui('tv_discard', { n: g.discard_count })}</span>
            </div>
          </div>
          {over ? <TvAwards g={g} names={names} /> : null}
          {over ? <div class="tv-newtrip"><NewTripButton /><span>{ui('tv_new_trip_sub')}</span></div> : null}
        </div>
        <div class="tv-table">
          <div class="tv-oval" />
          {p2 && !over ? (
            <svg class="tv-arrow" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />
            </svg>
          ) : null}
          {names.map((name, i) => {
            const pos = seatPos(i, n)
            const role = g.roles?.[i]
            return (
              <div class={`tv-seat ${g.alive[i] ? '' : 'out'} ${over && role ? 'flip role-' + role : ''}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
                <div class="tv-badges">
                  {i === g.president && !over ? <span title={term('president')}>{icon('president')}</span> : null}
                  {(i === g.chancellor || i === g.nominee) && !over ? <span title={term('chancellor')}>{icon('chancellor')}</span> : null}
                  {g.term_limited.includes(i) && g.phase === 'nominate' ? <span title={term('sleeping_in')}>{icon('sleeping')}</span> : null}
                  {g.voted.includes(i) ? <span>{icon('voted')}</span> : null}
                  {g.phase === 'reveal' && g.acked.includes(i) ? <span>{icon('voted')}</span> : null}
                  {!g.alive[i] ? <span>{icon('execute')}</span> : null}
                </div>
                <div class="tv-name">{name}</div>
                {over && role ? <div class="tv-role">{role === 'chill' ? icon('chill') : role === 'chief' ? icon('chief') : icon('over_team')} {roleName(role)}</div> : null}
              </div>
            )
          })}
          {g.veto_unlocked && !over ? <div class="tv-veto-note">✋ {ui('veto_unlocked')}</div> : null}
          {['pres_discard', 'chanc_enact', 'veto_response'].includes(g.phase) ? <div class="tv-shh-note">{icon('handoff')}</div> : null}
        </div>
      </div>
    </section>
  )
}

function TvAwards(props: { g: GameView; names: string[] }) {
  const th = theme()!
  if (!props.g.superlatives.length) return null
  return (
    <div class="tv-awards">
      {props.g.superlatives.map((a) => (
        <div class="tv-award">
          <div class="tv-award-title">🏆 {th.superlatives[a.key]?.title}</div>
          <div class="tv-award-name">{a.seats.map((s) => props.names[s]).join(', ')}</div>
        </div>
      ))}
    </div>
  )
}

function BeatOverlay(props: { beat: Beat; names: string[] }) {
  const b = props.beat
  if (b.kind === 'vote') {
    const e = b.data
    return (
      <div class="tv-beat beat-vote" key={b.id}>
        <div class="tv-vote-grid">
          {e.votes.map((v: boolean | null, i: number) =>
            v === null ? null : (
              <div class="tv-flip">
                <div class={`tv-flip-inner ${v ? 'yes' : 'no'}`}>
                  <div class="tv-flip-front">{props.names[i]}</div>
                  <div class="tv-flip-back">
                    <span>{props.names[i]}</span>
                    <strong>{v ? `👍 ${term('yes')}` : `👎 ${term('no')}`}</strong>
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
        <div class={`tv-beat-title vote-result ${e.passed ? 'pass' : 'fail'}`}>{b.title}</div>
      </div>
    )
  }
  const cardClass = b.kind === 'card' || b.kind === 'forced' ? (b.data.card === 'B' ? 'card-B' : 'card-O') : ''
  return (
    <div class={`tv-beat beat-${b.kind} ${cardClass}`} key={b.id}>
      {b.kind === 'win-chill' ? <Confetti /> : null}
      {b.big ? <div class="tv-beat-big">{b.big}</div> : null}
      {b.kind === 'card' ? <div class="tv-beat-cardname">{cardName(b.data.card)}</div> : null}
      <div class="tv-beat-title">{b.title}</div>
      {b.sub ? <div class="tv-beat-sub">{b.sub}</div> : null}
    </div>
  )
}

function Confetti() {
  const bits = useMemo(
    () => Array.from({ length: 60 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      color: ['#E2A73E', '#4F9282', '#6E1F3C', '#F8F1E7', '#E0603C'][i % 5],
    })),
    [],
  )
  return (
    <div class="confetti" aria-hidden="true">
      {bits.map((c) => <i style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, background: c.color }} />)}
    </div>
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
      }}>📺 {ui('tv_new_trip')}</button>
      {err ? <p class="error">{ui('err_generic')}</p> : null}
    </>
  )
}

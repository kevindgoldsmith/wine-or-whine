// The TV board in the "Itinerary" style: a typed trip-journal sheet that fills in day by day, a Napa postcard
// carrying the live headline, ticket-stub tracks, and players as luggage tags hanging from a vine.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { GameEvent, GameView, RoomView } from '../types'
import { cardName, logT, powerName, roleName, term, theme, ui } from '../theme'
import type { Connection } from '../net'
import { CardSlip } from '../cardslip'
import { Icon } from '../icons'
import { CardBackdrop, NapaScene, Vine, VineRows } from '../scenery'
import type { Beat } from './beats'

// ------------------------------------------------------------------ shared bits

export function Credit() {
  return (
    <footer class="tv-credit">
      <VineRows class="tv-vinerows" />
      <span>{theme()!.credit}</span>
    </footer>
  )
}

function Postcard(props: { kicker: string; headline: string; sub?: string; children?: ComponentChildren; big?: boolean; won?: 'chill' | 'over' | null }) {
  return (
    <figure class={`tv-postcard ${props.big ? 'big' : ''} ${props.won ? 'won-' + props.won : ''}`}>
      <div class="tv-scene-wrap">
        <NapaScene class="tv-scene" label={ui('tv_scene_label')} />
        <span class="tv-greet">{ui('tv_greetings')}</span>
        {props.won ? <span class={`stamp huge stamp-${props.won === 'chill' ? 'B' : 'O'}`}>{ui('stamp_won_' + props.won)}</span> : null}
      </div>
      <figcaption>
        <span class="tv-caption-text">
          <span class="tv-kicker">{props.kicker}</span>
          <span class="tv-headline">{props.headline}</span>
          {props.sub ? <span class="tv-sub">{props.sub}</span> : null}
        </span>
        {props.children}
      </figcaption>
      <span class="tape tape-a" aria-hidden="true" />
    </figure>
  )
}

// ------------------------------------------------------------------ lobby

export function TvLobby(props: { room: RoomView; conn: Connection | null }) {
  const r = props.room
  // Test mode: a new scan id every few seconds, so every scan is a distinct link (and a new player).
  const [scanId, setScanId] = useState(() => Math.random().toString(36).slice(2, 8))
  useEffect(() => {
    if (!r.test_mode) return
    const t = setInterval(() => setScanId(Math.random().toString(36).slice(2, 8)), 4000)
    return () => clearInterval(t)
  }, [r.test_mode])
  return (
    <section class="tv-lobby">
      <div class="tv-lobby-left">
        <Postcard big kicker={theme()!.tagline} headline={ui('app_title')} />
        <div class="tv-join-row">
          <div class="tv-code-ticket">
            <span class="tv-ticket-label">{ui('tv_room_code')}</span>
            <span class="tv-code">{r.code}</span>
            {r.host_id === 'tv' ? <span class="stamp stamp-O tv-host-stamp">{ui('tv_is_host')}</span> : null}
          </div>
          <div class="tv-join-text">
            <span class="tv-ticket-label">{ui('tv_join_at')}</span>
            <span class="tv-url">{r.join_url.replace(/^https?:\/\//, '')}</span>
            <span class="tv-need">{r.players.length < 5 ? ui('lobby_count_need', { n: 5 - r.players.length }) : r.players.length >= 10 ? ui('lobby_count_full') : ui('lobby_count_ready', { n: r.players.length })}</span>
          </div>
        </div>
        {props.conn && r.players.length >= 5 && r.players.length <= 10 ? (
          <button type="button" class="tv-start-btn" onClick={() => props.conn!.host({ type: 'start' })}>{ui('lobby_start')}</button>
        ) : null}
      </div>
      <div class="tv-lobby-right">
        <div class="tv-qr-card">
          <img class="tv-qr" src={`/api/rooms/${r.code}/qr.svg${r.test_mode ? `?scan=${scanId}` : ''}`} alt="" />
          <span class="tv-qr-caption">{ui('tv_scan')}</span>
          {r.test_mode ? <span class="stamp stamp-O tv-test-stamp">{ui('tv_test_mode')}</span> : null}
          <span class="tape tape-b" aria-hidden="true" />
        </div>
        <div class="tv-travellers lobby">
          <Vine class="tv-vine" />
          <ul class="tv-tags">
            {r.players.map((p) => (
              <li class={`tv-tag ${p.online ? '' : 'off'} ${p.id === r.host_id ? 'host' : ''}`}>
                <span class="tv-tag-name">{p.name}</span>
                {p.id === r.host_id ? <span class="tv-tag-status">{ui('lobby_host_badge')}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ the board

function nm(names: string[], s: number | null | undefined) {
  return s === null || s === undefined ? '' : names[s] ?? ''
}

interface DayLine { day: number; parts: { text: string; tone?: 'breezy' | 'over' }[]; current: boolean }

/** Compact, typed itinerary entries, one per day, newest last. */
export function itineraryDays(history: GameEvent[], names: string[], g: GameView): DayLine[] {
  const days = new Map<number, DayLine>()
  for (const e of history) {
    if (e.day < 1) continue
    if (!days.has(e.day)) days.set(e.day, { day: e.day, parts: [], current: false })
    const d = days.get(e.day)!
    switch (e.type) {
      case 'nominated':
        d.parts.push({ text: logT('tv_pick', { pres: nm(names, e.president), nominee: nm(names, e.nominee) }) })
        break
      case 'vote_result':
        d.parts.push({ text: logT(e.passed ? 'tv_pass' : 'tv_fail', { yes: e.yes, no: e.no }) })
        break
      case 'enacted':
        if (!e.forced) d.parts.push({ text: logT(e.card === 'B' ? 'tv_breezy' : 'tv_over'), tone: e.card === 'B' ? 'breezy' : 'over' })
        break
      case 'forced':
        d.parts.push({ text: logT('tv_forced', { card: cardName(e.card) }), tone: e.card === 'B' ? 'breezy' : 'over' })
        break
      case 'veto_result':
        if (e.accepted) d.parts.push({ text: logT('tv_vetoed') })
        break
      case 'power_used':
        d.parts.push({ text: logT('power_' + e.power, { pres: nm(names, e.president), target: nm(names, e.target) }) })
        break
      case 'power':
        if (e.power === 'peek') d.parts.push({ text: logT('power_peek', { pres: nm(names, e.president) }) })
        break
    }
  }
  const out = [...days.values()]
  if (g.phase !== 'game_over' && g.day >= 1) {
    let today = out.find((d) => d.day === g.day)
    if (!today) {
      today = { day: g.day, parts: [], current: true }
      out.push(today)
    }
    today.current = true
    if (!today.parts.length) today.parts.push({ text: logT('tv_up_first', { pres: nm(names, g.president) }) })
  }
  return out
}

function headline(g: GameView, names: string[]): { kicker: string; headline: string; sub: string } {
  const pres = nm(names, g.president)
  const planner = nm(names, g.chancellor)
  const kicker = ui('tv_kicker', { n: Math.max(g.day, 1) })
  const th = theme()!
  switch (g.phase) {
    case 'reveal':
      return { kicker: ui('tv_kicker_start'), headline: ui('tv_check_roles'), sub: ui('role_waiting', { n: g.waiting_on.length }) }
    case 'nominate': {
      const sleeping = g.term_limited.map((s) => names[s]).join(', ')
      return { kicker, headline: ui('tv_h_up_first', { name: pres }), sub: [ui('tv_s_nominate'), sleeping ? ui('tv_sleeping', { names: sleeping }) : ''].filter(Boolean).join(' · ') }
    }
    case 'vote':
      return { kicker, headline: ui('tv_h_vote', { pres, nominee: nm(names, g.nominee) }), sub: ui('tv_s_vote', { n: g.waiting_on.length }) }
    case 'pres_discard':
    case 'chanc_enact':
      return { kicker, headline: ui('tv_h_shh'), sub: ui('waiting_discard', { pres, planner }) }
    case 'veto_response':
      return { kicker, headline: ui('tv_h_veto'), sub: ui('waiting_veto', { pres, planner }) }
    case 'power':
      return { kicker, headline: powerName(g.power!), sub: ui('waiting_power', { name: pres, power: powerName(g.power!) }) }
    case 'power_result':
      return { kicker, headline: powerName(g.power!), sub: ui('waiting_result', { name: pres }) }
    case 'game_over':
      return { kicker: ui('game_over'), headline: th.winner_title[g.winner!], sub: th.win[g.win_reason!] }
  }
}

function ItinerarySheet(props: { g: GameView; names: string[]; code: string }) {
  const { g, names } = props
  const days = itineraryDays(g.history, names, g)
  // Show as many recent days as fit; drop the oldest first.
  const [fit, setFit] = useState(7)
  const shown = days.slice(-fit)
  const listRef = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => {
    setFit(7)
  }, [days.length, g.history.length])
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && el.scrollHeight > el.clientHeight + 1 && fit > 1) setFit(fit - 1)
  })
  return (
    <section class="tv-sheet" aria-label={ui('tv_itinerary')}>
      <header class="tv-sheet-head">
        <h2>{ui('tv_itinerary')}</h2>
        <span>{ui('tv_sheet_sub', { code: props.code })}</span>
      </header>
      {days.length < 3 ? (
        <div class="tv-crib">
          <span class="tv-crib-title">{ui('tv_crib_title')}</span>
          <span>{ui('tv_crib_1')}</span>
          <span>{ui('tv_crib_2')}</span>
          <span>{ui('tv_crib_3')}</span>
        </div>
      ) : null}
      <ol class="tv-days" ref={listRef}>
        {shown.length < days.length ? <li class="tv-day-more">{ui('tv_earlier', { n: days.length - shown.length })}</li> : null}
        {shown.map((d) => (
          <li class={`tv-day ${d.current ? 'current' : ''}`}>
            <strong>{ui('tv_day_label', { n: d.day })}</strong>
            <span>
              {d.parts.map((p, i) => (
                <>
                  {i ? ' ' : ''}
                  <span class={p.tone ? `tone-${p.tone}` : ''}>{p.text}</span>
                </>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Rail(props: { kind: 'B' | 'O'; filled: number; board?: (string | null)[] }) {
  const th = theme()!
  const caps = props.kind === 'B' ? th.tracks.breezy : th.tracks.over
  const prev = useRef(props.filled)
  const fresh = props.filled > prev.current ? props.filled : 0
  useEffect(() => {
    prev.current = props.filled
  }, [props.filled])
  return (
    <section class={`tv-rail rail-${props.kind}`} aria-label={`${props.kind === 'B' ? term('breezy_plural') : term('over_plural')}: ${props.filled}/${caps.length}`}>
      <h3 class="tv-rail-label">
        <Icon name={props.kind === 'B' ? 'breezy' : 'over'} />
        {ui(props.kind === 'B' ? 'tv_rail_breezy' : 'tv_rail_over')}
        <span class="tv-rail-count">{props.filled}/{caps.length}</span>
      </h3>
      <div class="tv-tickets">
        {caps.map((c, i) => {
          const filled = i < props.filled
          const power = props.board?.[i]
          const last = i === caps.length - 1
          return (
            <div class={`tv-ticket ${filled ? 'filled' : ''} ${fresh === i + 1 ? 'fresh' : ''}`}>
              {filled ? <CardBackdrop card={props.kind} /> : null}
              {filled ? (
                <span class={`stamp stamp-${props.kind}`} style={{ transform: `rotate(${[-8, 5, -4, 7, -6, 4][i]}deg)` }}>
                  {ui(props.kind === 'B' ? 'stamp_breezy' : 'stamp_over')}
                </span>
              ) : (
                <span class="tv-ticket-power">
                  {power ? <span class="tv-power"><Icon name={power} /><span>{ui('power_short_' + power)}</span></span> : null}
                  {props.kind === 'O' && i === 4 ? <span class="tv-veto-mark"><Icon name="veto" /> {term('veto')}</span> : null}
                  {last ? <span class="tv-ticket-end">{ui(props.kind === 'B' ? 'tv_win' : 'tv_lose')}</span> : null}
                  {!power && !last ? <span class="tv-ticket-blank"><Icon name={props.kind === 'B' ? 'breezy' : 'over'} /></span> : null}
                </span>
              )}
              <span class="tv-ticket-no">{filled ? ui('tv_admit', { n: String(i + 1).padStart(2, '0') }) : String(i + 1).padStart(2, '0')}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export interface TagStatus { text: string; icon?: string; kind?: string; vote?: 'voted' | 'thinking' }

export function tagStatus(g: GameView, i: number): TagStatus | null {
  const st = baseStatus(g, i)
  // The First One Up and the nominee vote too: show their vote progress alongside their role.
  if (st && g.phase === 'vote' && g.alive[i] && (i === g.president || i === g.nominee)) {
    return { ...st, vote: g.voted.includes(i) ? 'voted' : 'thinking' }
  }
  return st
}

/** A vote-progress mark for a tag that also shows a role (First One Up, nominee). */
export function VoteMark(props: { st: TagStatus | null; class: string }) {
  const v = props.st?.vote
  if (!v) return null
  return (
    <span class={`${props.class} ${v}`}>
      {v === 'voted' ? <Icon name="voted" /> : null}
      {ui(v === 'voted' ? 'tv_tag_voted' : 'tv_tag_thinking')}
    </span>
  )
}

function baseStatus(g: GameView, i: number): TagStatus | null {
  const over = g.phase === 'game_over'
  if (over && g.roles) {
    const r = g.roles[i]
    return { text: roleName(r), icon: r === 'chill' ? 'chill' : r === 'chief' ? 'chief' : 'over_team', kind: r === 'chill' ? 'team-chill' : r === 'chief' ? 'team-over chief' : 'team-over' }
  }
  if (!g.alive[i]) return { text: ui('tv_tag_out'), icon: 'execute', kind: 'out' }
  if (i === g.president) return { text: term('president'), icon: 'president', kind: 'president' }
  if (i === g.chancellor) return { text: term('chancellor'), icon: 'chancellor', kind: 'planner' }
  if (i === g.nominee) return { text: ui('tv_tag_nominee'), icon: 'chancellor', kind: 'planner' }
  if (g.phase === 'vote') return g.voted.includes(i) ? { text: ui('tv_tag_voted'), icon: 'voted' } : { text: ui('tv_tag_thinking') }
  if (g.phase === 'reveal') return g.acked.includes(i) ? { text: ui('tv_tag_ready'), icon: 'voted' } : null
  if (g.phase === 'nominate' && g.term_limited.includes(i)) return { text: term('sleeping_in'), icon: 'sleeping', kind: 'sleeping' }
  return null
}

function Travellers(props: { g: GameView; names: string[] }) {
  const { g, names } = props
  return (
    <section class="tv-travellers" aria-label={ui('tv_travellers')}>
      <h3 class="tv-section-label">{ui('tv_travellers')}</h3>
      <Vine class="tv-vine" />
      <ul class={`tv-tags n${names.length}`}>
        {names.map((name, i) => {
          const st = tagStatus(g, i)
          return (
            <li class={`tv-tag ${st?.kind ?? ''} ${g.phase === 'game_over' ? 'flip' : ''}`}>
              <span class="tv-tag-name">{name}</span>
              {st ? (
                <span class="tv-tag-status">
                  {st.icon ? <Icon name={st.icon} /> : null}
                  {st.text}
                </span>
              ) : null}
              <VoteMark st={st} class="tv-tag-vote" />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function TvAwards(props: { g: GameView; names: string[] }) {
  const th = theme()!
  if (!props.g.superlatives.length) return null
  return (
    <section class="tv-awards" aria-label={ui('awards')}>
      {props.g.superlatives.map((a) => (
        <div class={`tv-award ${a.seats.length >= 3 ? 'many' : ''}`}>
          <span class="tape tape-c" aria-hidden="true" />
          <span class="tv-award-title">{th.superlatives[a.key]?.title}</span>
          <span class="tv-award-name">{a.seats.map((s) => props.names[s]).join(', ')}</span>
        </div>
      ))}
    </section>
  )
}

export function Board(props: { g: GameView; names: string[]; code: string; newTrip?: ComponentChildren }) {
  const { g, names } = props
  const over = g.phase === 'game_over'
  const h = headline(g, names)
  return (
    <section class={`tv-board ${over ? 'over' : ''}`}>
      <ItinerarySheet g={g} names={names} code={props.code} />
      <div class="tv-today">
        <Postcard kicker={h.kicker} headline={h.headline} sub={h.sub} won={over ? g.winner : null}>
          {over ? props.newTrip : null}
        </Postcard>
        <Rail kind="B" filled={g.breezy} />
        <Rail kind="O" filled={g.over} board={g.board} />
        {over ? (
          <TvAwards g={g} names={names} />
        ) : (
          <div class="tv-meter-row">
            <span class="tv-meter-label">{term('meter')} {g.meter}/3</span>
            <span class="tv-holes" aria-label={`${term('meter')}: ${g.meter}/3`}>
              {[0, 1, 2].map((i) => <span class={`tv-hole ${i < g.meter ? 'punched' : ''}`} />)}
            </span>
            <span class="tv-piles">{ui('tv_left', { n: g.deck_count })}</span>
          </div>
        )}
      </div>
      <Travellers g={g} names={names} />
    </section>
  )
}

// ------------------------------------------------------------------ beats

export function BeatOverlay(props: { beat: Beat; names: string[] }) {
  const b = props.beat
  if (b.kind === 'vote') {
    const e = b.data
    const voters = e.votes.map((v: boolean | null, i: number) => ({ v, i })).filter((x: { v: boolean | null }) => x.v !== null)
    return (
      <div class="tv-beat beat-vote" key={b.id}>
        <div class="tv-beat-card wide">
          <div class={`tv-vote-tags n${voters.length}`}>
            {voters.map((x: { v: boolean; i: number }, k: number) => (
              <div class={`tv-vote-tag ${x.v ? 'yes' : 'no'}`} style={{ animationDelay: `${0.5 + k * 0.12}s` }}>
                <span class="tv-vote-name">{props.names[x.i]}</span>
                <span class="tv-vote-q" aria-hidden="true" style={{ animationDelay: `${0.5 + k * 0.12}s` }}>?</span>
                <span class={`stamp tv-vote-stamp ${x.v ? 'stamp-B' : 'stamp-O'}`} style={{ animationDelay: `${0.5 + k * 0.12}s` }}>
                  <Icon name={x.v ? 'yes' : 'no'} /> {x.v ? term('yes') : term('no')}
                </span>
              </div>
            ))}
          </div>
          <span class={`stamp big tv-vote-result ${e.passed ? 'stamp-B' : 'stamp-O'}`} style={{ animationDelay: `${0.7 + voters.length * 0.12}s` }}>{b.title}</span>
        </div>
      </div>
    )
  }
  if (b.kind === 'card') {
    return (
      <div class="tv-beat beat-card" key={b.id}>
        <CardSlip m={{ id: b.id, card: b.data.card, count: b.data.count, day: b.data.day }} class="tv" />
      </div>
    )
  }
  const card = b.kind === 'card' || b.kind === 'forced' ? (b.data.card === 'B' ? 'B' : 'O') : ''
  return (
    <div class={`tv-beat beat-${b.kind} ${card ? 'card-' + card : ''}`} key={b.id}>
      {b.kind === 'win-chill' ? <Confetti /> : null}
      <div class="tv-beat-card">
        {b.icon ? <Icon name={b.icon} class="tv-beat-icon" /> : null}
        {card ? <span class={`stamp big stamp-${card}`}>{ui(card === 'B' ? 'stamp_breezy' : 'stamp_over')}</span> : null}
        <div class="tv-beat-title">{b.title}</div>
        {b.sub ? <div class="tv-beat-sub">{b.sub}</div> : null}
        {b.data?.stakes ? <div class="tv-beat-stakes">{b.data.stakes}</div> : null}
      </div>
    </div>
  )
}

function Confetti() {
  const bits = useMemo(
    () => Array.from({ length: 60 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      color: ['#E9A23B', '#3F6B4A', '#B0302A', '#FBF6EA', '#1F2A44'][i % 5],
    })),
    [],
  )
  return (
    <div class="confetti" aria-hidden="true">
      {bits.map((c) => <i style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, background: c.color }} />)}
    </div>
  )
}


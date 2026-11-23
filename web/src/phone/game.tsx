import { useState } from 'preact/hooks'
import type { Card, GameView, PrivateResult, RoomView } from '../types'
import { cardName, hint, powerName, roleName, teamName, term, theme, ui } from '../theme'
import { Icon } from '../icons'
import { MiniVineyard, VineyardBand, CardBackdrop } from '../scenery'
import { itineraryDays, tagStatus, VoteMark } from '../tv/board'
import { fullLog, noneYet } from '../history'
import type { Connection } from '../net'
import { ChoiceList, HoldReveal, Hint, Modal, type Option, tap, useGame } from './common'

// ------------------------------------------------------------------ role card

export function RoleCard(props: { g: GameView }) {
  const { discreet, names } = useGame()
  const g = props.g
  const me = g.me!
  const role = g.role!
  const known = g.known ?? {}
  const mates = Object.entries(known)
    .map(([s, r]) => [Number(s), r] as const)
    .filter(([s]) => s !== me)
  const chief = mates.find(([, r]) => r === 'chief')
  const overs = mates.filter(([, r]) => r === 'over')
  const team = role === 'chill' ? 'chill' : 'over'
  if (discreet) {
    return (
      <div class="role-plain">
        <p>{ui('role_plain_team', { team: teamName(team) })}</p>
        <p>{ui('role_plain_role', { role: roleName(role) })}</p>
        {overs.length ? <p>{ui('role_teammates')} {overs.map(([s]) => names[s]).join(', ')}</p> : null}
        {chief ? <p>{ui('role_chief_is', { name: names[chief[0]] })}</p> : null}
        {role === 'chief' && !overs.length ? <p>{ui('role_chief_alone')}</p> : null}
      </div>
    )
  }
  return (
    <div class={`role-card role-${role}`}>
      <span class="tag-hole" aria-hidden="true" />
      <p class="role-team"><Icon name={role === 'chill' ? 'chill' : role === 'chief' ? 'chief' : 'over_team'} /> {teamName(team)}</p>
      <h2>{ui('role_' + role)}</h2>
      <p>{ui('role_' + role + '_goal')}</p>
      {overs.length ? <p><strong>{ui('role_teammates')}</strong> {overs.map(([s]) => names[s]).join(', ')}</p> : null}
      {chief ? <p><strong>{ui('role_chief_is', { name: names[chief[0]] })}</strong></p> : null}
      {role === 'chief' && !overs.length ? <p>{ui('role_chief_alone')}</p> : null}
    </div>
  )
}

export function RoleReveal(props: { g: GameView; conn: Connection; discreetToggle: any }) {
  const g = props.g
  const acked = g.acked.includes(g.me!)
  const left = g.waiting_on.length
  return (
    <main class="screen center reveal">
      <h1 class="display">{ui('role_title')}</h1>
      <HoldReveal label={ui('role_hold')} class="role-hold">
        <RoleCard g={g} />
      </HoldReveal>
      <Hint k="reveal" text={hint('reveal')} />
      {acked ? (
        <p class="status-line">{ui('role_waiting', { n: left })}</p>
      ) : (
        <button type="button" class="primary big" onClick={() => {
          tap()
          props.conn.act({ type: 'ack_role' })
        }}>{ui('role_got_it')}</button>
      )}
      <div class="reveal-discreet">{props.discreetToggle}</div>
    </main>
  )
}

// ------------------------------------------------------------------ header

function Track(props: { kind: 'B' | 'O'; filled: number; mini?: boolean }) {
  const total = props.kind === 'B' ? 5 : 6
  return (
    <span class={`track track-${props.kind}`} aria-label={`${props.kind === 'B' ? term('breezy_plural') : term('over_plural')}: ${props.filled}/${total}`}>
      <span class="track-icon"><Icon name={props.kind === 'B' ? 'breezy' : 'over'} /></span>
      <span class="track-count">{props.filled}/{total}</span>
    </span>
  )
}

export function Header(props: { g: GameView; onCatchUp: () => void; discreetToggle: any; hostMenu: any }) {
  const g = props.g
  return (
    <header class="game-header">
      <div class="header-row">
        <strong class="day">{ui('header_day', { n: Math.max(g.day, 1) })}</strong>
        <Track kind="B" filled={g.breezy} />
        <Track kind="O" filled={g.over} />
        <span class="meter" aria-label={`${term('meter')}: ${g.meter}/3`}>
          {[0, 1, 2].map((i) => <span class={`hole ${i < g.meter ? 'punched' : ''}`} />)}
        </span>
      </div>
      <nav class="action-bar" aria-label={ui('header_catch_up')}>
        {g.role ? (
          <HoldReveal label={ui('header_hold_role')} class="hold-small">
            <RoleCard g={g} />
          </HoldReveal>
        ) : null}
        <button type="button" class="small" onClick={props.onCatchUp}>{ui('header_catch_up')}</button>
        {props.discreetToggle}
        {props.hostMenu}
      </nav>
    </header>
  )
}

// ------------------------------------------------------------------ prompts

function others(g: GameView) {
  return Array.from({ length: g.n }, (_, i) => i).filter((i) => i !== g.me)
}

export function NominatePrompt(props: { g: GameView; send: (a: any) => void }) {
  const { names } = useGame()
  const g = props.g
  const options: Option[] = others(g)
    .map((p) => {
      const reason = !g.alive[p] ? ui('eligible_reason_out') : g.term_limited.includes(p) ? ui('eligible_reason_sleeping') : ''
      return { key: String(p), label: names[p], sub: reason || undefined, disabled: !g.eligible.includes(p) }
    })
    .sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled))
  return <ChoiceList layout="tags" options={options} confirmLabel={ui('nominate_confirm')} onConfirm={(k) => props.send({ type: 'nominate', target: Number(k) })} />
}

export function VotePrompt(props: { send: (a: any) => void }) {
  const options: Option[] = [
    { key: 'yes', label: term('yes'), icon: 'yes', tone: 'yes' },
    { key: 'no', label: term('no'), icon: 'no', tone: 'no' },
  ]
  return <ChoiceList layout="pair" options={options} confirmLabel={ui('vote_confirm')} pickLabel={ui('vote_pick')} onConfirm={(k) => props.send({ type: 'vote', yes: k === 'yes' })} />
}

export function HandPrompt(props: { hand: Card[]; mode: 'discard' | 'enact'; vetoAvailable?: boolean; send: (a: any) => void }) {
  const { discreet } = useGame()
  const options: Option[] = props.hand.map((c, i) => ({
    key: String(i),
    label: cardName(c),
    kicker: ui('card_kicker'),
    sub: discreet ? undefined : ui(c === 'B' ? 'card_sub_breezy' : 'card_sub_over'),
    art: c === 'B' ? <MiniVineyard class="stub-art" /> : <span class="stub-over"><Icon name="over" /></span>,
    backdrop: <CardBackdrop card={c === 'B' ? 'B' : 'O'} fit />,
    tone: c === 'B' ? 'breezy' : 'over',
  }))
  if (props.vetoAvailable) options.push({ key: 'veto', label: ui('veto_button'), icon: 'veto', tone: 'neutral', wide: true })
  return (
    <ChoiceList
      layout="cards"
      options={options}
      confirmLabel={props.mode === 'discard' ? ui('discard_this') : ui('enact_this')}
      onConfirm={(k) => {
        if (k === 'veto') props.send({ type: 'propose_veto' })
        else props.send({ type: props.mode, index: Number(k) })
      }}
    />
  )
}

export function VetoPrompt(props: { send: (a: any) => void }) {
  const options: Option[] = [
    { key: 'yes', label: ui('veto_agree'), tone: 'neutral' },
    { key: 'no', label: ui('veto_refuse'), tone: 'neutral' },
  ]
  return <ChoiceList layout="pair" options={options} onConfirm={(k) => props.send({ type: 'veto', accept: k === 'yes' })} />
}

export function TargetPrompt(props: { g: GameView; send: (a: any) => void }) {
  const { names } = useGame()
  const g = props.g
  const options: Option[] = others(g).map((p) => {
    const reason = !g.alive[p]
      ? ui('eligible_reason_out')
      : g.power === 'investigate' && g.investigated.includes(p)
        ? ui('eligible_reason_read')
        : ''
    return { key: String(p), label: names[p], sub: reason || undefined, disabled: !g.power_targets.includes(p) }
  })
  return <ChoiceList layout="tags" options={options.sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled))} onConfirm={(k) => props.send({ type: 'power_target', target: Number(k) })} />
}

export function ResultBody(props: { r: PrivateResult }) {
  const { names, discreet } = useGame()
  const r = props.r
  if (r.type === 'investigate') {
    return <p class="result-text">{ui('result_investigate', { name: names[r.target!], team: teamName(r.team!) })}</p>
  }
  return (
    <div>
      <p>{ui('result_peek')}</p>
      <ol class="peek">
        {r.cards!.map((c) => <li class={discreet ? '' : `peek-${c}`}>{discreet ? null : <Icon name={c === 'B' ? 'breezy' : 'over'} />} {cardName(c)}</li>)}
      </ol>
    </div>
  )
}

export function ResultPrompt(props: { r: PrivateResult; send: (a: any) => void }) {
  const [done, setDone] = useState(false)
  return (
    <div class="result">
      <HoldReveal label={ui('result_hold')} class="result-hold">
        <ResultBody r={props.r} />
      </HoldReveal>
      <button type="button" class="confirm" disabled={done} onClick={() => {
        tap()
        setDone(true)
        props.send({ type: 'power_ack' })
      }}>{ui('result_done')}</button>
    </div>
  )
}

// ------------------------------------------------------------------ main turn area

function waitingText(g: GameView, names: string[]): string {
  const pres = names[g.president]
  const planner = g.chancellor !== null ? names[g.chancellor] : ''
  switch (g.phase) {
    case 'nominate':
      return ui('waiting_nominate', { name: pres })
    case 'vote':
      return ui('waiting_vote', { n: g.waiting_on.length })
    case 'pres_discard':
    case 'chanc_enact':
      return ui('waiting_discard', { pres, planner })
    case 'veto_response':
      return ui('waiting_veto', { pres, planner })
    case 'power':
      return ui('waiting_power', { name: pres, power: powerName(g.power!) })
    case 'power_result':
      return ui('waiting_result', { name: pres })
    case 'reveal':
      return ui('role_waiting', { n: g.waiting_on.length })
    default:
      return ''
  }
}

export function TurnArea(props: { g: GameView; send: (a: any) => void }) {
  const { names, discreet } = useGame()
  const g = props.g
  const me = g.me!
  const mine = g.waiting_on.includes(me)
  const shh = ['pres_discard', 'chanc_enact', 'veto_response'].includes(g.phase)
  let title = ''
  let sub = ''
  let kicker = ui('turn_kicker', { n: Math.max(g.day, 1) })
  let body: any = null
  let hintKey = g.phase as string
  if (mine) {
    switch (g.phase) {
      case 'nominate':
        title = ui('you_are_pres')
        kicker = ui('pres_kicker', { n: g.day })
        body = <NominatePrompt g={g} send={props.send} />
        break
      case 'vote':
        title = ui('vote_stamp')
        body = (
          <>
            {discreet ? <p class="prompt-sub">{ui('you_vote', { pres: names[g.president], nominee: names[g.nominee!] })}</p> : <BoardingPass pres={names[g.president]} nominee={names[g.nominee!]} day={g.day} />}
            <VotePrompt send={props.send} />
          </>
        )
        break
      case 'pres_discard':
        title = ui('you_discard')
        kicker = ui('pres_kicker', { n: g.day })
        sub = ui('you_discard_sub', { name: names[g.chancellor!] })
        body = g.hand ? <HandPrompt hand={g.hand} mode="discard" send={props.send} /> : null
        break
      case 'chanc_enact':
        title = ui('you_enact')
        kicker = ui('planner_kicker', { n: g.day })
        sub = g.veto_refused ? ui('veto_refused_note') : ui('you_enact_sub')
        body = g.hand ? <HandPrompt hand={g.hand} mode="enact" vetoAvailable={g.veto_unlocked && !g.veto_refused} send={props.send} /> : null
        break
      case 'veto_response':
        title = ui('you_veto_reply', { name: names[g.chancellor!] })
        body = <VetoPrompt send={props.send} />
        break
      case 'power':
        title = powerName(g.power!)
        kicker = ui('power_kicker', { n: g.day })
        sub = theme()?.power_desc[g.power!] ?? ''
        hintKey = 'power_' + g.power
        body = <TargetPrompt g={g} send={props.send} />
        break
      case 'power_result':
        title = ui('you_result')
        hintKey = 'power_' + g.power
        body = g.pending_result ? <ResultPrompt r={g.pending_result} send={props.send} /> : null
        break
    }
  }
  if (mine && body) {
    return (
      <section class="prompt turn" aria-live="polite">
        <p class="prompt-kicker">{kicker}</p>
        <h2 class="prompt-title">{title}</h2>
        {sub ? <p class="prompt-sub">{sub}</p> : null}
        {shh && g.phase === 'veto_response' ? <p class="shh">{ui('shh')}</p> : null}
        {/* key: remount (and reshuffle) each new day/phase */}
        <div key={`${g.day}-${g.phase}-${g.veto_refused}`}>{body}</div>
        <Hint k={hintKey} text={hint(hintKey)} />
      </section>
    )
  }
  const votedLine = g.phase === 'vote' && g.my_vote !== null && g.my_vote !== undefined
  return (
    <section class="prompt wait" aria-live="polite">
      <h2 class="prompt-title">
        {votedLine ? ui('vote_locked', { n: g.waiting_on.length }) : waitingText(g, names)}
      </h2>
      {shh ? <p class="shh">{ui('shh')}</p> : null}
      <Table g={g} />
      <Hint k="waiting" text={hint('waiting')} />
    </section>
  )
}

/** Compact public table: who's who right now. */
export function Table(props: { g: GameView }) {
  const { names, me } = useGame()
  const g = props.g
  return (
    <ul class="tag-grid" aria-label={ui('tv_travellers')}>
      {names.map((n, i) => {
        const st = tagStatus(g, i)
        return (
          <li class={`tag ${st?.kind ?? ''} ${i === me ? 'me' : ''}`}>
            <span class="tag-name">{n}{i === me ? <em> ({ui('lobby_you')})</em> : null}</span>
            {st ? <span class="tag-status">{st.icon ? <Icon name={st.icon} /> : null}{st.text}</span> : null}
            <VoteMark st={st} class="tag-status tag-vote" />
          </li>
        )
      })}
    </ul>
  )
}

/** The proposed pair as a boarding pass (vote screen, normal mode). */
function BoardingPass(props: { pres: string; nominee: string; day: number }) {
  return (
    <div class="pass">
      <div class="pass-head"><span>{ui('pass_title')}</span><span>{ui('header_day', { n: props.day })}</span></div>
      <VineyardBand class="pass-art" />
      <div class="pass-route">
        <div><span class="pass-label">{term('president')}</span><span class="pass-name">{props.pres}</span></div>
        <div class="pass-to">
          <Icon name="arrow" class="pass-arrow" />
          <div class="pass-right"><span class="pass-label">{term('chancellor')}</span><span class="pass-name">{props.nominee}</span></div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ catch me up

export function CatchUp(props: { g: GameView; onClose: () => void }) {
  const { names } = useGame()
  const recent = itineraryDays(props.g.history, names, props.g).slice(-3)
  const log = fullLog(props.g.history, names)
  const results = props.g.private_results ?? []
  return (
    <Modal title={ui('catchup_title')} onClose={props.onClose}>
      <h3>{ui('catchup_recent')}</h3>
      {recent.length ? (
        <ol class="recap-days">
          {recent.map((d) => (
            <li class={d.current ? 'current' : ''}>
              <strong>{ui('tv_day_label', { n: d.day })}</strong>
              <span>{d.parts.map((p, i) => <>{i ? ' ' : ''}<span class={p.tone ? `tone-${p.tone}` : ''}>{p.text}</span></>)}</span>
            </li>
          ))}
        </ol>
      ) : <p>{noneYet()}</p>}
      {results.length ? (
        <>
          <h3>{ui('my_results')}</h3>
          <HoldReveal label={ui('result_hold')} class="result-hold small">
            {results.map((r) => <ResultBody r={r} />)}
          </HoldReveal>
        </>
      ) : null}
      <details class="recap-all">
        <summary>{ui('catchup_full_n', { n: log.length })}</summary>
        <ol class="log">
          {log.map((l) => <li>{l.text}</li>)}
        </ol>
      </details>
    </Modal>
  )
}

// ------------------------------------------------------------------ out & game over

export function OutScreen(props: { g: GameView }) {
  const { names } = useGame()
  return (
    <section class="prompt wait out">
      <h2 class="prompt-title">{ui('out_title')}</h2>
      <p>{ui('out_body')}</p>
      <p class="status-line">{waitingText(props.g, names)}</p>
      <Table g={props.g} />
    </section>
  )
}

export function Awards(props: { g: GameView }) {
  const { names } = useGame()
  const th = theme()
  if (!props.g.superlatives.length) return null
  return (
    <section class="awards">
      <h3>{ui('awards')}</h3>
      {props.g.superlatives.map((a) => (
        <div class="award">
          <strong>🏆 {th?.superlatives[a.key]?.title}</strong>
          <span>{a.seats.map((s) => names[s]).join(', ')}</span>
          <small>{th?.superlatives[a.key]?.desc}</small>
        </div>
      ))}
    </section>
  )
}

export function GameOver(props: { g: GameView; room: RoomView; isHost: boolean; conn: Connection }) {
  const { names } = useGame()
  const g = props.g
  const th = theme()
  const [hints, setHints] = useState(false)
  const myTeam = g.role ? (g.role === 'chill' ? 'chill' : 'over') : null
  const order = g.roles!.map((r, i) => ({ r, i })).sort((x, y) => Number(y.i === g.me) - Number(x.i === g.me))

  return (
    <main class={`screen gameover win-${g.winner}`}>
      {myTeam ? <p class="you-result">{myTeam === g.winner ? ui('you_won') : ui('you_lost')}</p> : null}
      <h1 class="display">{myTeam ? teamName(g.winner!) : th?.winner_title[g.winner!]}</h1>
      <p class="win-line">{th?.win[g.win_reason!]}</p>
      <section>
        <h3>{ui('roles_revealed')}</h3>
        <ul class="roles">
          {order.map(({ r, i }) => (
            <li class={`role-${r} ${i === g.me ? 'me' : ''}`}>
              <span>{names[i]}{i === g.me ? <em> ({ui('lobby_you')})</em> : null}</span>
              <span class="role-line"><Icon name={r === 'chill' ? 'chill' : r === 'chief' ? 'chief' : 'over_team'} /> {roleName(r)}</span>
            </li>
          ))}
        </ul>
      </section>
      <Awards g={g} />
      {props.isHost ? (
        <div class="host-panel">
          <label class="toggle">
            <input type="checkbox" checked={hints} onChange={(e) => setHints((e.target as HTMLInputElement).checked)} />
            {ui('lobby_hints')}
          </label>
          <button type="button" class="primary big" onClick={() => props.conn.host({ type: 'play_again', hints })}>{ui('play_again')}</button>
          <button type="button" class="small" onClick={() => props.conn.host({ type: 'back_to_lobby' })}>{ui('new_players')}</button>
        </div>
      ) : (
        <p class="status-line">{ui('play_again_wait')}</p>
      )}
      <details class="recap-all gameover-log">
        <summary>{ui('catchup_full_n', { n: fullLog(g.history, names).length })}</summary>
        <ol class="log">
          {fullLog(g.history, names).map((l) => <li>{l.text}</li>)}
        </ol>
      </details>
    </main>
  )
}

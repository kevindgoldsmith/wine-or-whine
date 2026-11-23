import type { GameEvent } from './types'
import { cap, cardA, logT, teamName, theme, ui } from './theme'

export type Names = string[]

function nm(names: Names, seat: number | null | undefined) {
  return seat === null || seat === undefined ? '?' : names[seat] ?? '?'
}

function caption(card: string, count: number) {
  const th = theme()
  const list = card === 'B' ? th?.tracks.breezy : th?.tracks.over
  return list?.[count - 1] ?? ''
}

/** One plain-language line per public event (null for events we don't list). */
export function logLine(e: GameEvent, names: Names): string | null {
  switch (e.type) {
    case 'day_start':
      return logT('day_start', { day: e.day, pres: nm(names, e.president) })
    case 'nominated':
      return logT('nominated', { pres: nm(names, e.president), nominee: nm(names, e.nominee) })
    case 'vote_result': {
      const head = logT(e.passed ? 'vote_pass' : 'vote_fail', { yes: e.yes, no: e.no })
      const yes = e.votes.map((v: boolean | null, i: number) => (v === true ? names[i] : null)).filter(Boolean)
      const no = e.votes.map((v: boolean | null, i: number) => (v === false ? names[i] : null)).filter(Boolean)
      return `${head} ${logT('votes_detail', { yes_names: yes.join(', ') || '—', no_names: no.join(', ') || '—' })}`
    }
    case 'meter':
      return logT('meter', { value: e.value })
    case 'forced':
      return logT('forced', { card_a: cardA(e.card) })
    case 'term_reset':
      return logT('term_reset')
    case 'enacted':
      if (e.forced) return null
      return logT('enacted', { Card_a: cap(cardA(e.card)), caption: caption(e.card, e.count) })
    case 'veto_proposed':
      return logT('veto_proposed', { planner: nm(names, e.chancellor) })
    case 'veto_result':
      return logT(e.accepted ? 'veto_accepted' : 'veto_refused', { pres: nm(names, e.president) })
    case 'power':
      return e.power === 'peek' ? logT('power_peek', { pres: nm(names, e.president) }) : null
    case 'power_used':
      return logT('power_' + e.power, { pres: nm(names, e.president), target: nm(names, e.target) })
    case 'reshuffle':
      return logT('reshuffle')
    case 'game_over':
      return logT('game_over', { title: theme()?.winner_title[e.winner] ?? teamName(e.winner) })
    default:
      return null
  }
}

/** "Day 4: Tom (First One Awake) picked Priya (Day Planner). Vote passed 5–3. An Overscheduled Agenda was played. …" */
export function daySummaries(history: GameEvent[], names: Names, lastN = 3): { day: number; text: string }[] {
  const days = new Map<number, GameEvent[]>()
  for (const e of history) {
    if (e.day < 1) continue
    if (!days.has(e.day)) days.set(e.day, [])
    days.get(e.day)!.push(e)
  }
  const out: { day: number; text: string }[] = []
  for (const [day, evs] of days) {
    const start = evs.find((e) => e.type === 'day_start')
    const nom = evs.find((e) => e.type === 'nominated')
    const pres = nm(names, nom?.president ?? start?.president)
    const parts: string[] = []
    for (const e of evs) {
      if (e.type === 'vote_result') parts.push(logT(e.passed ? 'catchup_pass' : 'catchup_fail', { yes: e.yes, no: e.no }))
      else if (e.type === 'enacted' && !e.forced) parts.push(logT('catchup_played', { Card_a: cap(cardA(e.card)) }))
      else if (e.type === 'forced') parts.push(logT('catchup_forced', { card_a: cardA(e.card) }))
      else if (e.type === 'veto_result' && e.accepted) parts.push(logT('catchup_veto'))
      else if (e.type === 'power_used' || (e.type === 'power' && e.power === 'peek')) {
        const l = logLine(e, names)
        if (l) parts.push(l)
      } else if (e.type === 'game_over') {
        const l = logLine(e, names)
        if (l) parts.push(l)
      }
    }
    const text = nom
      ? logT('catchup_day', { day, pres, nominee: nm(names, nom.nominee), rest: parts.join(' ') })
      : `${logT('catchup_day_nonom', { day, pres })} ${parts.join(' ')}`
    out.push({ day, text: text.trim() })
  }
  return out.slice(-lastN)
}

export function fullLog(history: GameEvent[], names: Names): { seq: number; day: number; text: string }[] {
  const out: { seq: number; day: number; text: string }[] = []
  for (const e of history) {
    const text = logLine(e, names)
    if (text) out.push({ seq: e.seq, day: e.day, text })
  }
  return out
}

export function noneYet() {
  return ui('catchup_none')
}

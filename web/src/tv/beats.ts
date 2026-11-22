import type { GameEvent, GameView } from '../types'
import type { Slot } from '../audio'
import { beatT, cap, cardA, icon, powerName, theme } from '../theme'

export interface Beat {
  id: number
  kind: string
  title: string
  sub?: string
  big?: string // large emoji / glyph
  sfx?: Slot
  ms: number
  data?: any
}

let nextId = 1

function caption(card: string, count: number) {
  const th = theme()
  return (card === 'B' ? th?.tracks.breezy : th?.tracks.over)?.[count - 1] ?? ''
}

/** One animated beat per public event (vote_cast only plays a sound). */
export function beatsFor(events: GameEvent[], names: string[], g: GameView | null): Beat[] {
  const nm = (s: number | null | undefined) => (s === null || s === undefined ? '' : names[s] ?? '')
  const out: Beat[] = []
  const add = (b: Omit<Beat, 'id'>) => out.push({ id: nextId++, ...b })
  for (const e of events) {
    switch (e.type) {
      case 'day_start':
        add({ kind: 'sunrise', title: beatT('day_start', { day: e.day, pres: nm(e.president) }), big: icon('president'), sfx: 'day_start', ms: 2600 })
        break
      case 'nominated':
        add({ kind: 'nominate', title: beatT('nominated', { pres: nm(e.president), nominee: nm(e.nominee) }), sfx: 'nominate', ms: 2200, data: e })
        break
      case 'vote_cast':
        add({ kind: 'sound', title: '', sfx: 'vote_cast', ms: 0 })
        break
      case 'vote_result':
        add({ kind: 'vote', title: beatT(e.passed ? 'vote_pass' : 'vote_fail', { yes: e.yes, no: e.no }), sfx: 'vote_reveal', ms: 4000, data: e })
        break
      case 'meter':
        add({ kind: 'meter', title: beatT('meter', { value: e.value }), big: icon('meter'), sfx: 'meter_tick', ms: 1800, data: e })
        break
      case 'forced':
        add({ kind: 'forced', title: beatT('forced'), sub: cap(cardA(e.card)), big: '👶👶', sfx: 'babies_decide', ms: 2800, data: e })
        break
      case 'government':
        add({ kind: 'shh', title: beatT('shh'), sub: beatT('shh_sub'), big: icon('handoff'), sfx: 'shh', ms: 2600 })
        break
      case 'enacted':
        add({
          kind: 'card', title: `${caption(e.card, e.count)}…`, sub: cap(cardA(e.card)),
          big: e.card === 'B' ? icon('breezy') : icon('over'), sfx: e.card === 'B' ? 'card_breezy' : 'card_over', ms: 3800, data: e,
        })
        break
      case 'veto_proposed':
        add({ kind: 'veto', title: beatT('veto_proposed', { planner: nm(e.chancellor) }), big: '✋', sfx: 'veto', ms: 2400 })
        break
      case 'veto_result':
        add({ kind: 'veto', title: beatT(e.accepted ? 'veto_accepted' : 'veto_refused'), big: e.accepted ? '🗑️' : '🙅', sfx: 'veto', ms: 2400 })
        break
      case 'power':
        if (e.power === 'peek') add({ kind: 'power-peek', title: beatT('power_peek', { pres: nm(e.president) }), big: icon('peek'), sfx: 'power', ms: 3000 })
        else add({ kind: 'power', title: beatT('power_pending', { pres: nm(e.president), power: powerName(e.power) }), big: icon(e.power), sfx: 'power', ms: 2400 })
        break
      case 'power_used':
        add({
          kind: `power-${e.power}`, title: beatT('power_' + e.power, { pres: nm(e.president), target: nm(e.target) }),
          big: icon(e.power), sfx: e.power === 'execute' ? 'babysitter' : 'power', ms: e.power === 'execute' ? 3600 : 3000,
        })
        break
      case 'reshuffle':
        add({ kind: 'reshuffle', title: beatT('reshuffle'), big: '🔀', ms: 1500 })
        break
      case 'game_over': {
        if (e.reason === 'chief_elected' && g?.chancellor !== null && g?.chancellor !== undefined) {
          add({ kind: 'reveal-chief', title: beatT('chief_elected', { name: nm(g.chancellor) }), big: icon('chief'), sfx: 'win_over', ms: 3000 })
        }
        add({
          kind: e.winner === 'chill' ? 'win-chill' : 'win-over',
          title: theme()?.winner_title[e.winner] ?? '', sub: theme()?.win[e.reason] ?? '',
          big: e.winner === 'chill' ? '🥂' : '😭', sfx: e.winner === 'chill' ? 'win_chill' : 'win_over', ms: 4000,
        })
        break
      }
    }
  }
  return out
}

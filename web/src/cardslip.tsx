// The agenda moment: whenever a daily agenda is played, a slip drops in, a BREEZY / OVERSCHEDULED stamp slams onto it
// and a handwritten one-liner appears. Shown on the TV (as the card beat) and on every phone (as a short
// overlay). The line is picked from the card count, so the TV and all phones show the same one and the
// lines don't repeat within a game.
import { beatT, theme, ui } from './theme'

export interface CardMoment {
  id: number
  card: 'B' | 'O'
  count: number
  day: number
}

export function cardLine(card: 'B' | 'O', count: number): string {
  // One joke per slot: the theme's tracks (5 Breezy, 6 Overscheduled), also used in the log.
  const lines = (card === 'B' ? theme()?.tracks.breezy : theme()?.tracks.over) ?? []
  if (!lines.length) return ''
  return lines[(Math.max(1, count) - 1) % lines.length]
}

export function cardStakes(card: 'B' | 'O', count: number): string {
  const left = (card === 'B' ? 5 : 6) - count
  return left > 0 ? beatT('stakes_' + card, { n: left }) : ''
}

export function CardSlip(props: { m: CardMoment; class?: string }) {
  const m = props.m
  const stakes = cardStakes(m.card, m.count)
  return (
    <div class={`card-slip card-${m.card} ${props.class ?? ''}`} key={m.id}>
      <div class="slip-head">
        <span>{ui('header_day', { n: m.day })}</span>
        <span>{beatT('card_count_' + m.card, { n: m.count })}</span>
      </div>
      <span class={`stamp big slip-stamp stamp-${m.card}`} aria-hidden="true">{ui(m.card === 'B' ? 'stamp_breezy' : 'stamp_over')}</span>
      <p class="slip-line">{cardLine(m.card, m.count)}</p>
      {stakes ? <p class="slip-stakes">{stakes}</p> : null}
    </div>
  )
}

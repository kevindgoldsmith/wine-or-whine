// "Planning committee approved": a stamp slams onto a committee slip with a witty line. Shown on the TV
// (as a beat) and on every phone (as a short overlay) whenever a vote passes. The line is picked from the
// day number, so the TV and all phones show the same one.
import { theme, ui } from './theme'

export function approvedLine(day: number): string {
  const lines = theme()?.approved_lines ?? []
  if (!lines.length) return ''
  // 5 is coprime with any list length that isn't a multiple of 5, so consecutive days walk the whole list.
  return lines[(Math.max(1, day) * 5 + 2) % lines.length]
}

export interface Approval {
  id: number
  day: number
  pres: string
  planner: string
}

export function ApprovedSlip(props: { a: Approval; class?: string }) {
  const a = props.a
  return (
    <div class={`approved-slip ${props.class ?? ''}`} key={a.id}>
      <div class="approved-head">{ui('approved_kicker', { n: a.day })}</div>
      <div class="approved-names">
        <span>{a.pres}</span>
        <span class="approved-amp">&amp;</span>
        <span>{a.planner}</span>
      </div>
      <span class="stamp big approved-stamp" aria-hidden="true">{ui('approved_stamp')}</span>
      <p class="approved-line">{approvedLine(a.day)}</p>
    </div>
  )
}

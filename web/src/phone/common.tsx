import { createContext, type ComponentChildren } from 'preact'
import { useContext, useMemo, useRef, useState } from 'preact/hooks'
import { theme, ui } from '../theme'
import { playSfx } from '../audio'

export interface Ctx {
  discreet: boolean
  hints: boolean
  names: string[]
  me: number | null
}
export const GameCtx = createContext<Ctx>({ discreet: false, hints: false, names: [], me: null })
export const useGame = () => useContext(GameCtx)

/** Identical feedback for every private choice: one quiet tap sound and one short buzz. */
export function tap() {
  try {
    navigator.vibrate?.(15)
  } catch {
    /* unsupported */
  }
  playSfx('click', 0.25)
}

export function buzz() {
  try {
    navigator.vibrate?.([120, 60, 120])
  } catch {
    /* unsupported */
  }
}

export function shuffled<T>(items: T[]): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Discreet mode: words only, no emoji. */
export function plain(s: string): string {
  return s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim()
}

export interface Option {
  key: string
  label: string
  icon?: string
  tone?: 'yes' | 'no' | 'breezy' | 'over' | 'neutral' | 'danger'
  sub?: string
  disabled?: boolean
  /** Not one of the equal-size cards (e.g. the veto button): takes its own full-width row. */
  wide?: boolean
}

/**
 * Choose, then confirm. In discreet mode every option renders with the same class, size and colour,
 * no icons, and the on-screen order is shuffled each time the list appears.
 */
export function ChoiceList(props: {
  options: Option[]
  onConfirm: (key: string) => void
  confirmLabel?: string
  layout?: 'stack' | 'pair' | 'cards'
  discreetOverride?: boolean
}) {
  const ctx = useGame()
  const discreet = props.discreetOverride ?? ctx.discreet
  const [sel, setSel] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  // Shuffle once per mount (i.e. each time this choice is offered).
  const order = useMemo(() => (discreet ? shuffled(props.options) : props.options), [discreet, props.options.map((o) => o.key).join()])
  const layout = discreet ? 'stack' : props.layout ?? 'stack'
  const chosen = props.options.find((o) => o.key === sel)
  return (
    <div class={`choices layout-${layout}`}>
      <div class="choice-list" style={{ '--cols': String(Math.max(1, props.options.filter((o) => !o.wide).length)) } as any}>
        {order.map((o) => {
          const cls = discreet
            ? `choice${o.disabled ? ' disabled' : ''}${sel === o.key ? ' selected' : ''}`
            : `choice tone-${o.tone ?? 'neutral'}${o.wide ? ' wide' : ''}${o.disabled ? ' disabled' : ''}${sel === o.key ? ' selected' : ''}`
          return (
            <button
              type="button"
              class={cls}
              disabled={o.disabled || sent}
              aria-pressed={sel === o.key}
              onClick={() => {
                tap()
                setSel(o.key)
              }}
            >
              {!discreet && o.icon ? <span class="choice-icon" aria-hidden="true">{o.icon}</span> : null}
              <span class="choice-label">{discreet ? plain(o.label) : o.label}</span>
              {o.sub ? <span class="choice-sub">{discreet ? plain(o.sub) : o.sub}</span> : null}
            </button>
          )
        })}
      </div>
      <div class="confirm-row">
        <button
          type="button"
          class={discreet ? 'confirm' : 'confirm primary'}
          disabled={!chosen || sent}
          onClick={() => {
            if (!chosen) return
            tap()
            setSent(true)
            props.onConfirm(chosen.key)
          }}
        >
          {props.confirmLabel ?? ui('confirm')}
          {!discreet && chosen ? `: ${chosen.label}` : ''}
        </button>
      </div>
    </div>
  )
}

/** Press and hold to see; hides again on release so neighbours can't glance. */
export function HoldReveal(props: { label: string; children: ComponentChildren; class?: string }) {
  const [shown, setShown] = useState(false)
  const timer = useRef<number>()
  const show = (e: Event) => {
    e.preventDefault()
    clearTimeout(timer.current)
    setShown(true)
  }
  const hide = () => {
    timer.current = window.setTimeout(() => setShown(false), 80)
  }
  return (
    <div
      class={`hold ${shown ? 'shown' : ''} ${props.class ?? ''}`}
      role="button"
      tabIndex={0}
      aria-label={props.label}
      onPointerDown={show}
      onPointerUp={hide}
      onPointerLeave={hide}
      onPointerCancel={hide}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') show(e)
      }}
      onKeyUp={hide}
    >
      {shown ? <div class="hold-body">{props.children}</div> : <div class="hold-cover">{props.label}</div>}
    </div>
  )
}

export function Modal(props: { title: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <div class="modal" role="dialog" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <h2>{props.title}</h2>
          <button type="button" class="ghost" onClick={props.onClose}>
            {ui('close')}
          </button>
        </div>
        <div class="modal-body">{props.children}</div>
      </div>
    </div>
  )
}

export function Hint(props: { k: string; text: string }) {
  const { hints } = useGame()
  if (!hints || !props.text) return null
  return <p class="hint">💡 {props.text}</p>
}

export function Credit() {
  return <footer class="credit">{theme()?.credit}</footer>
}

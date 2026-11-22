import type { Theme } from './types'

// Every player-facing word comes from the theme JSON served by the backend (themes/*.json).
let current: Theme | null = null
const listeners = new Set<() => void>()
const cache = new Map<string, Promise<Theme>>()

export const DEFAULT_THEME = 'wine_or_whine'

export function loadTheme(id: string): Promise<Theme> {
  if (!cache.has(id)) {
    cache.set(
      id,
      fetch(`/api/themes/${encodeURIComponent(id)}`).then((r) => {
        if (!r.ok) throw new Error('theme')
        return r.json()
      }),
    )
  }
  return cache.get(id)!.then((th) => {
    if (current?.id !== th.id) {
      current = th
      document.title = th.name
      listeners.forEach((f) => f())
    }
    return th
  })
}

export function setThemeForTest(th: Theme) {
  current = th
}

export function theme(): Theme | null {
  return current
}

export function onTheme(f: () => void) {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** Fill ``{var}`` from vars and ``[term]`` from theme terms. */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  const terms = current?.terms ?? {}
  return template
    .replace(/\[(\w+)\]/g, (m, k) => (k in terms ? terms[k] : m))
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

function section(name: keyof Theme, key: string, vars?: Record<string, string | number>): string {
  const sec = (current?.[name] ?? {}) as Record<string, string>
  const s = sec[key]
  return s === undefined ? '' : fill(s, vars)
}

export const ui = (k: string, v?: Record<string, string | number>) => section('ui', k, v) || k
export const term = (k: string) => current?.terms[k] ?? k
export const icon = (k: string) => current?.icons[k] ?? ''
export const hint = (k: string) => section('hints', k)
export const logT = (k: string, v?: Record<string, string | number>) => section('log', k, v)
export const beatT = (k: string, v?: Record<string, string | number>) => section('beats', k, v)

export function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

export function roleName(r: string) {
  return r === 'chill' ? term('chill_one') : r === 'chief' ? term('chief') : term('over_one')
}

export function teamName(team: string) {
  return team === 'chill' ? term('chill_team') : term('over_team')
}

export function cardName(c: string) {
  return c === 'B' ? term('breezy') : term('over_card')
}

export function cardA(c: string) {
  return c === 'B' ? term('breezy_a') : term('over_a')
}

export function powerName(p: string) {
  return term(p)
}

export function errorText(code: string) {
  return section('ui', 'err_' + code) || section('ui', 'err_generic') || code
}

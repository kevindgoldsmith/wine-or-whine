import { useEffect, useState } from 'preact/hooks'
import { DEFAULT_THEME, errorText, loadTheme, onTheme, theme, ui } from './theme'
import { hostKeyKey, store } from './net'
import { Credit } from './phone/common'

export function Home() {
  const [, force] = useState(0)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => onTheme(() => force((x) => x + 1)) as any, [])
  useEffect(() => {
    loadTheme(DEFAULT_THEME).catch(() => {})
  }, [])
  if (!theme()) return <main class="screen center">…</main>
  const clean = code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || 'generic')
      store.set(hostKeyKey(body.code), body.host_key)
      location.href = `/${body.code}`
    } catch (e: any) {
      setError(e.message)
      setBusy(false)
    }
  }
  return (
    <main class="screen center home">
      <div class="hero" aria-hidden="true">🍷👶</div>
      <h1 class="display">{ui('app_title')}</h1>
      <p class="tagline">{theme()!.tagline}</p>
      <button type="button" class="primary big" disabled={busy} onClick={create}>{ui('home_new')}</button>
      {error ? <p class="error">{errorText(error)}</p> : null}
      <form class="card form" onSubmit={(e) => {
        e.preventDefault()
        if (clean.length === 4) location.href = `/${clean}`
      }}>
        <label for="code">{ui('home_code_label')}</label>
        <input id="code" class="code-input" autoCapitalize="characters" autoComplete="off" value={clean} maxLength={4}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
        <button type="submit" class="big" disabled={clean.length !== 4}>{ui('home_join')}</button>
        <button type="button" class="link" disabled={clean.length !== 4} onClick={() => (location.href = `/${clean}/tv`)}>
          📺 {ui('home_tv')}
        </button>
      </form>
      <Credit />
    </main>
  )
}

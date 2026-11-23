import { useEffect, useState } from 'preact/hooks'
import { DEFAULT_THEME, errorText, loadTheme, onTheme, theme, ui } from './theme'
import { createRoomAndGo } from './newroom'
import { NapaScene } from './scenery'
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
  const create = async (fromTv: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await createRoomAndGo(fromTv)
    } catch (e: any) {
      setError(e.message)
      setBusy(false)
    }
  }
  return (
    <main class="screen center home">
      <figure class="home-postcard">
        <NapaScene class="home-scene" />
        <figcaption>
          <span class="home-kicker">{ui('home_hero_kicker')}</span>
          <h1 class="display">{ui('app_title')}</h1>
          <p class="tagline">{theme()!.tagline}</p>
        </figcaption>
      </figure>
      <form class="card form" onSubmit={(e) => {
        e.preventDefault()
        if (clean.length === 4) location.href = `/${clean}`
        else setError('code')
      }}>
        <label for="code">{ui('home_code_label')}</label>
        <input id="code" class="code-input" autoCapitalize="characters" autoComplete="off" value={clean} maxLength={4} placeholder={ui('home_code_placeholder')}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
        <button type="submit" class="primary big">{ui('home_join')}</button>
        {error === 'code' ? <p class="error">{ui('home_code_error')}</p> : null}
      </form>
      <div class="host-choices">
      <button type="button" class="big" disabled={busy} onClick={() => create(false)}>{ui('home_new')}</button>
      <button type="button" class="big" disabled={busy} onClick={() => create(true)}>{ui('home_new_tv')}</button>
      <p class="muted">{ui('home_new_tv_hint')}</p>
      {error && error !== 'code' ? <p class="error">{errorText(error)}</p> : null}
      </div>
      <button type="button" class="link" onClick={() => (clean.length === 4 ? (location.href = `/${clean}/tv`) : setError('code'))}>
        {ui('home_tv')}
      </button>
      <Credit />
    </main>
  )
}

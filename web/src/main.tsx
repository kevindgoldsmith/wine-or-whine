import { render } from 'preact'
import '@fontsource/dm-serif-display/400.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/caveat/600.css'
import './styles.css'
import { Home } from './home'
import { PhoneApp } from './phone/App'
import { TvApp } from './tv/TvApp'

const m = location.pathname.match(/^\/([A-Za-z]{4})(\/tv)?\/?$/)
const root = document.getElementById('app')!
if (m) {
  const code = m[1].toUpperCase()
  if (m[1] !== code) history.replaceState(null, '', `/${code}${m[2] ?? ''}`)
  if (m[2]) {
    document.documentElement.classList.add('tv-mode')
    render(<TvApp code={code} />, root)
  } else {
    render(<PhoneApp code={code} />, root)
  }
} else {
  render(<Home />, root)
}

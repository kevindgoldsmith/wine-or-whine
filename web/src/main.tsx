import { render } from 'preact'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/crimson-text/600.css'
import '@fontsource/crimson-text/700.css'
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

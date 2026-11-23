import { createRequire } from 'node:module'
const require = createRequire('/home/user/wine-or-whine/scripts/')
const { chromium } = require('playwright')
const [,, html, out, ...times] = process.argv
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto('file://' + html)
await p.evaluate(() => window.ready)
for (const t of times) {
  await p.evaluate((ms) => window.setTime(ms), Number(t) * 1000)
  await p.screenshot({ path: `${out}/t${String(t).padStart(6, '0')}.png` })
}
console.log('errors:', errs.slice(0, 5))
await b.close()

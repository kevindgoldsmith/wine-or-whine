// Walkthrough capture: plays real games with phones at one size and saves one screenshot per distinct
// screen a player can see (plus a few TV shots), with a manifest for building a review page.
//
//   node scripts/walkthrough.mjs http://localhost:8000 ./walkthrough-out [players=7] [seed=1] [steer=over|mixed] [tag=a]
//
// steer=over: bots push Overscheduled Agendas (powers, veto). steer=mixed: Over until 3, then Breezy.
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const BASE = process.argv[2] || 'http://localhost:8000'
const OUT = process.argv[3] || './walkthrough-out'
const N = Number(process.argv[4] || 7)
let seed = Number(process.argv[5] || 1)
const STEER = process.argv[6] || 'over'
const TAG = process.argv[7] || 'a'
fs.mkdirSync(OUT, { recursive: true })
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (n) => Math.floor(rand() * n)
const NAMES = ['Sam', 'Priya', 'Jordan', 'Mia', 'Theo', 'Alex', 'Rosa', 'Kenji', 'Nora', 'Leo']
const PHONE = { width: 390, height: 844 }
const manifest = []
const seen = new Set()
let shots = 0
let overCount = 0

async function key(page) {
  return page.evaluate((names) => {
    const q = (s) => document.querySelector(s)
    const t = (s) => (q(s)?.textContent || '').trim()
    const scrub = (s) => names.reduce((a, n) => a.split(n).join('·'), s).replace(/\d+/g, '#').slice(0, 80)
    const turn = q('.prompt.turn')
    let screen = '?'
    if (q('.home')) screen = 'home'
    else if (q('#name')) screen = 'join'
    else if (q('.rejoin, #code')) screen = 'rejoin'
    else if (q('.seat-list') && !q('.game-header')) screen = 'lobby' + (q('.lobby-menu') ? '-host' : '') + (q('details[open]') ? '-adv' : '') + (q('.codes') ? '-codes' : '')
    else if (q('.reveal')) {
      const m = [...document.querySelectorAll('.reveal [class*=role-]')].map((e) => (e.className.baseVal ?? e.className).match(/\brole-(chill|over|chief)\b/)).find(Boolean)
      screen = 'reveal:' + (m ? m[1] : '?') + (q('.reveal .status-line') ? '-waiting' : '')
    } else if (q('.gameover')) screen = 'gameover:' + scrub(t('.gameover h1')) + ':' + scrub(t('.gameover .you-result, .gameover p'))
    else if (q('.prompt.out')) screen = 'out'
    else if (turn) screen = 'turn:' + scrub(t('.prompt.turn .prompt-title')) + '|' + scrub(t('.prompt.turn .prompt-kicker')) + (turn.querySelector('.result-hold') ? '|result' : '') + (/veto/i.test(turn.textContent) ? '|veto' : '')
    else if (q('.prompt.wait')) screen = 'wait:' + scrub((q('.prompt.wait').innerText || '').split('\n')[0])
    const extra = [
      document.documentElement.classList.contains('discreet') ? 'discreet' : '',
      q('.modal') ? 'modal:' + t('.modal h2') : '',
      q('.paused-overlay') ? 'paused' : '',
      q('.hold.shown') ? 'held' : '',
      q('.choice.selected') ? 'selected' : '',
      q('.banner') ? 'banner' : '',
    ].filter(Boolean)
    return [screen, ...extra].join('|')
  }, NAMES)
}

async function snap(page, who, note = '', force = false) {
  let k
  try { k = await key(page) } catch { return }
  if (seen.has(k) && !force) return
  seen.add(k)
  const file = `${TAG}-${String(++shots).padStart(3, '0')}.jpg`
  await page.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 82, fullPage: /^(gameover|lobby)/.test(k) }).catch(() => {})
  const text = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '')
  manifest.push({ file, key: k, who, note, text })
}

;(async () => {
  const browser = await chromium.launch()
  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 })
  const tv = await tvCtx.newPage()
  await tv.goto(BASE + '/')
  await tv.click('text=Host on a TV')
  await tv.waitForURL(/\/[A-Z]{4}\/tv$/)
  const code = tv.url().split('/').slice(-2)[0]
  await tv.click('text=Tap to start', { force: true })
  const tvSnap = async (note) => {
    const file = `${TAG}-tv-${String(++shots).padStart(3, '0')}.jpg`
    await tv.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 82 })
    manifest.push({ file, key: 'tv:' + note, who: 'TV', note, text: '' })
  }

  const phones = []
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
    const p = await ctx.newPage()
    if (i === 0) { await p.goto(BASE + '/'); await snap(p, NAMES[i], 'home') }
    await p.goto(`${BASE}/${code}`)
    await p.waitForSelector('#name')
    if (i === 0) { await p.fill('#name', NAMES[i]); await snap(p, NAMES[i], 'join') }
    await p.fill('#name', NAMES[i]); await p.click('button[type=submit]'); await p.waitForSelector('.seat-list')
    phones.push({ name: NAMES[i], page: p, role: '' })
  }
  await snap(phones[1].page, phones[1].name, 'lobby')
  await tvSnap('lobby')
  // Phone host view
  await tv.click('css=.tv-host-btn')
  await tv.locator('.tv-drawer label:has-text("Make a player the host") select').selectOption({ label: NAMES[0] })
  const h = phones[0].page
  await h.waitForSelector('text=Start the trip')
  await snap(h, NAMES[0], 'lobby host')
  await h.click('text=Advanced'); await snap(h, NAMES[0], 'lobby host advanced')
  await h.click('.lobby-menu button'); await h.click('text=Show rejoin codes'); await h.waitForSelector('.codes')
  await snap(h, NAMES[0], 'lobby host codes')
  await h.click('text=Give hosting back to the TV')
  await tv.waitForSelector('.tv-start-btn')
  await tv.click('.tv-drawer >> text=Close')
  await tv.click('.tv-start-btn')

  for (const [i, ph] of phones.entries()) {
    const p = ph.page
    await p.waitForSelector('text=Got it')
    ph.role = await p.evaluate(() => { const e = document.querySelector('.role-card'); const m = e && e.className.match(/role-(chill|over|chief)/); return m ? m[1] : '?' })
    await snap(p, ph.name, 'role reveal (covered)')
    const hold = p.locator('.role-hold'); const b = await hold.boundingBox()
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(150)
    await snap(p, ph.name, 'role reveal (held)'); await p.mouse.up()
    if (i === 1) { await p.click('text=Discreet'); await snap(p, ph.name, 'role reveal discreet') }
    await p.click('text=Got it')
    if (i === 0) { await p.waitForTimeout(200); await snap(p, ph.name, 'waiting for others to check roles') }
  }
  // A late phone: rejoin screen
  {
    const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
    const p = await ctx.newPage(); await p.goto(`${BASE}/${code}`); await p.waitForTimeout(1200)
    await snap(p, 'late phone', 'rejoin'); await ctx.close()
  }
  await tv.waitForTimeout(2500); await tvSnap('board')

  const chief = phones.find((x) => x.role === 'chief')?.name
  let paused = false, caught = false
  for (let step = 0; step < 700; step++) {
    if (await tv.locator('.tv-new').count()) break
    if (step === 10 && !caught) {
      caught = true
      for (const ph of [phones[0], phones[1]]) {
        const p = ph.page
        if (!(await p.locator('.game-header').count())) continue
        await p.click('text=Recap'); await p.waitForSelector('.modal'); await snap(p, ph.name, 'recap', true)
        const det = p.locator('.recap-all summary'); if (await det.count()) { await det.click(); await snap(p, ph.name, 'recap details', true) }
        await p.click('.modal button.ghost')
        const hs = p.locator('.hold-small'); const bb = await hs.boundingBox()
        if (bb) { await p.mouse.move(bb.x + 10, bb.y + 10); await p.mouse.down(); await p.waitForTimeout(120); await snap(p, ph.name, 'hold tag in header', true); await p.mouse.up() }
      }
    }
    if (step === 16 && !paused) {
      paused = true
      await tv.click('css=.tv-host-btn'); await tv.click('.tv-drawer >> text=Pause')
      await phones[2].page.waitForSelector('.paused-overlay'); await tv.click('.tv-drawer >> text=Close')
      await snap(phones[2].page, phones[2].name, 'paused', true)
      await tv.click('css=.tv-host-btn'); await tv.click('.tv-drawer >> text=Resume'); await tv.click('.tv-drawer >> text=Close')
      await phones[2].page.waitForSelector('.paused-overlay', { state: 'detached' })
    }
    const ready = []
    for (const ph of phones) {
      await snap(ph.page, ph.name)
      if (await ph.page.locator('.prompt.turn').count()) ready.push(ph)
    }
    if (!ready.length) { await tv.waitForTimeout(300); continue }
    // Act: presidents/planners before voters, so card screens are captured before the board moves on.
    const ph = ready[pick(ready.length)]
    const p = ph.page
    const turn = p.locator('.prompt.turn')
    const txt = await turn.innerText()
    if (await turn.locator('.result-hold').count()) {
      const rb = await turn.locator('.result-hold').boundingBox()
      await p.mouse.move(rb.x + 20, rb.y + 20); await p.mouse.down(); await p.waitForTimeout(150)
      await snap(p, ph.name, 'private result (held)', false); await p.mouse.up()
      await turn.locator('button.confirm').click()
    } else {
      const enabled = turn.locator('.choice:not([disabled])'); const n = await enabled.count()
      if (!n) { await tv.waitForTimeout(300); continue }
      let target = enabled.nth(pick(n))
      const wantOver = STEER === 'over' || (STEER === 'mixed' && overCount < 3)
      const discard = /Bin one|Throw one/i.test(txt)
      const enact = /Play one/i.test(txt)
      if (discard || enact) {
        const keep = wantOver ? 'over' : 'breezy'
        const other = wantOver ? 'breezy' : 'over'
        const pref = turn.locator(`.choice.tone-${discard ? other : keep}`)
        if (await pref.count()) target = pref.first()
        const veto = turn.locator('.choice:has-text("veto")')
        if (enact && (await veto.count()) && rand() < (STEER === 'over' ? 0.95 : 0.6)) target = veto.first()
      } else if (STEER === 'over' && chief && n > 2) {
        // Keep the Chief off the government and out of babysitter duty so the game runs long enough to veto.
        const others = turn.locator(`.choice:not([disabled]):not(:has-text("${chief}"))`)
        const m = await others.count(); if (m) target = others.nth(pick(m))
      } else if (/^\s*(Yes|No)/m.test(await enabled.first().innerText()) && n === 2 && !/veto/i.test(txt)) {
        target = enabled.nth(rand() < 0.75 ? 0 : 1)
      }
      await target.click({ timeout: 5000 })
      await snap(p, ph.name, 'selected')
      await turn.locator('button.confirm').click()
      if (enact) {
        const label = await target.innerText().catch(() => '')
        if (/Overscheduled/i.test(label)) overCount++
      }
    }
    await tv.waitForTimeout(350)
    if (step === 30) await tvSnap('board mid-game')
  }
  await tv.waitForTimeout(9000)
  for (const ph of phones) await snap(ph.page, ph.name, 'game over')
  await tvSnap('game over')
  fs.writeFileSync(`${OUT}/manifest-${TAG}.json`, JSON.stringify({ code, players: phones.map((p) => ({ name: p.name, role: p.role })), shots: manifest }, null, 1))
  console.log(`${TAG}: code ${code}, ${manifest.length} screens`)
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })

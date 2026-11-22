// Visual audit: plays real games in Chromium with phones and TVs at many sizes, and on every new screen
// state checks for overlapping text, clipped text, text pushed off-screen, sideways scroll and tiny tap
// targets. Screenshots every new state into OUT.
//
//   node scripts/visual_audit.mjs http://localhost:8000 ./audit-out [players=10] [seed=1] [longNames=1]
//
// Needs Playwright (preinstalled in the cloud container; elsewhere `npm i -D playwright`).
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const BASE = process.argv[2] || 'http://localhost:8000'
const OUT = process.argv[3] || './audit-out'
const N = Number(process.argv[4] || 10)
let seed = Number(process.argv[5] || 1)
const LONG = process.argv[6] !== '0'
fs.mkdirSync(OUT, { recursive: true })
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (n) => Math.floor(rand() * n)

const PHONES = [
  { name: 'p320', width: 320, height: 568 },
  { name: 'p360', width: 360, height: 740 },
  { name: 'p375', width: 375, height: 667 },
  { name: 'p390', width: 390, height: 844 },
  { name: 'p430', width: 430, height: 932 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'land', width: 740, height: 360 },
]
const TVS = [
  { name: 'tv1920', width: 1920, height: 1080 },
  { name: 'tv1440', width: 1440, height: 900 },
  { name: 'tv1280', width: 1280, height: 720 },
  { name: 'tv960', width: 960, height: 540 },
]
const LONG_NAMES = ['Bartholomew Jenkins', 'Alexandria', 'Maximiliano', 'Guinevere', 'Christopher', 'Anastasia',
  'Montgomery', 'Evangeline', 'Fitzgerald', 'Persephone']
const SHORT_NAMES = ['Sam', 'Jo', 'Ana', 'Tom', 'Bea', 'Kit', 'Dev', 'Lu', 'Max', 'Ivy']

// ------------------------------------------------------------------ in-page detector
function detect() {
  const OVER = '.tv-beat, .modal-backdrop, .tv-drawer, .paused-overlay, .tv-paused, .conn-banner, .toast, .test-badge, .hold.shown, .confetti, .tv-corner, .lobby-menu, .game-header'
  const tv = document.documentElement.classList.contains('tv-mode')
  const visible = (e) => {
    for (let x = e; x && x !== document.documentElement; x = x.parentElement) {
      const cs = getComputedStyle(x)
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false
    }
    return true
  }
  const items = []
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) {
    const n = w.currentNode
    const t = n.textContent.trim()
    if (!t) continue
    const el = n.parentElement
    if (!el || !visible(el) || el.closest('select, option, script, style, .tv-flip-front')) continue // flip fronts are face-down (backface hidden)
    const range = document.createRange()
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue
      items.push({ el, r, t: t.slice(0, 32), layer: el.closest(OVER) })
    }
  }
  const out = []
  const desc = (el) => (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : el.tagName.toLowerCase())
  // 1) overlapping text from different elements in the same layer
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]
      if (a.el === b.el || a.layer !== b.layer) continue
      const ow = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
      const oh = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
      if (ow > 3 && oh > 3) out.push(`overlap: "${a.t}" (${desc(a.el)}) × "${b.t}" (${desc(b.el)})`)
    }
  }
  // 2) text clipped by an overflow-hidden ancestor, or 3) off-screen
  for (const it of items) {
    for (let x = it.el; x && x !== document.body; x = x.parentElement) {
      const cs = getComputedStyle(x)
      const clipX = /hidden|clip/.test(cs.overflowX), clipY = /hidden|clip/.test(cs.overflowY)
      const scrollY = /auto|scroll/.test(cs.overflowY)
      if (!clipX && !clipY) { if (scrollY) break; continue }
      const b = x.getBoundingClientRect()
      if ((clipX && (it.r.right > b.right + 2 || it.r.left < b.left - 2)) || (clipY && (it.r.bottom > b.bottom + 2 || it.r.top < b.top - 2))) {
        out.push(`clipped: "${it.t}" by ${desc(x)}`)
        break
      }
    }
    if (it.r.right > innerWidth + 2 || it.r.left < -2) out.push(`offscreen-x: "${it.t}" (${desc(it.el)})`)
    if (tv && !it.el.closest('.tv-drawer, .tv-beat') && (it.r.bottom > innerHeight + 2 || it.r.top < -2)) out.push(`offscreen-y: "${it.t}" (${desc(it.el)})`)
  }
  // 1b) boxes that must never touch each other (seats around the TV table, track cards)
  for (const sel of ['.tv-seat', '.tv-slot', '.tv-award', '.choice']) {
    const boxes = [...document.querySelectorAll(sel)].filter(visible).map((e) => ({ e, r: e.getBoundingClientRect() }))
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r
      const ow = Math.min(a.right, b.right) - Math.max(a.left, b.left), oh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (ow > 2 && oh > 2 && !boxes[i].e.closest('.tv-beat')) out.push(`boxes collide: ${sel} "${boxes[i].e.innerText.split('\n')[0].slice(0, 20)}" × "${boxes[j].e.innerText.split('\n')[0].slice(0, 20)}"`)
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`)
  // 4) tap targets on phones
  if (!tv) {
    for (const b of document.querySelectorAll('button, [role=button], input, select')) {
      if (!visible(b) || b.closest('.tv-root')) continue
      const r = b.getBoundingClientRect()
      if (r.width < 1) continue
      if ((r.height < 40 || r.width < 40) && b.getAttribute('type') !== 'checkbox') out.push(`small tap target ${Math.round(r.width)}×${Math.round(r.height)}: "${(b.innerText || b.getAttribute('aria-label') || '').slice(0, 24)}"`)
    }
  }
  return [...new Set(out)]
}

// ------------------------------------------------------------------ harness
const issues = new Map() // key -> {pages:Set, states:Set}
const seenStates = new Set()
let shots = 0

async function stateKey(page, kind) {
  return page.evaluate((kind) => {
    const q = (s) => document.querySelector(s)
    const cls = (s) => (q(s)?.className || '').toString()
    if (kind === 'tv') {
      const beat = (cls('.tv-beat').match(/beat-[\w-]+/) || [''])[0]
      const phase = q('.tv-status')?.textContent?.slice(0, 18) || ''
      return ['tv', q('.tv-lobby') ? 'lobby' : q('.tv-start') ? 'start' : q('.tv-board') ? 'board' : '?', beat,
        q('.tv-drawer') ? 'drawer' : '', q('.tv-paused') ? 'paused' : '', q('.tv-awards') ? 'over' : '', /Shh/.test(phase) ? 'shh' : ''].join('|')
    }
    const turn = q('.prompt.turn')
    return ['phone', document.documentElement.classList.contains('discreet') ? 'discreet' : 'normal',
      q('.home') ? 'home' : q('#name') ? 'join' : q('.seat-list') && !q('.game-header') ? 'lobby' : q('.reveal') ? 'reveal' : q('.gameover') ? 'gameover' : q('.out') ? 'out' : turn ? 'turn:' + (turn.querySelector('.prompt-title')?.textContent || '').slice(0, 14) : q('.prompt.wait') ? 'wait' : '?',
      q('.modal') ? 'modal:' + (q('.modal h2')?.textContent || '') : '', q('.paused-overlay') ? 'paused' : '', q('.hold.shown') ? 'held' : '',
      turn?.querySelector('.layout-cards') ? 'cards' + turn.querySelectorAll('.choice').length : '', q('.banner') ? 'banner' : ''].join('|')
  }, kind)
}

async function audit(page, label, kind, force = false) {
  let key
  try {
    key = `${label}|${await stateKey(page, kind)}`
  } catch {
    return
  }
  if (seenStates.has(key) && !force) return
  seenStates.add(key)
  const found = await page.evaluate(detect).catch(() => [])
  const file = `${String(++shots).padStart(4, '0')}-${label}-${key.split('|').slice(2).filter(Boolean).join('_').replace(/[^\w-]+/g, '_').slice(0, 60)}.png`
  await page.screenshot({ path: `${OUT}/${file}` }).catch(() => {})
  for (const f of found) {
    const k = f.replace(/"[^"]*"/g, '"…"')
    if (!issues.has(k)) issues.set(k, { example: f, where: new Set() })
    issues.get(k).where.add(`${label} ${file}`)
  }
}

;(async () => {
  const browser = await chromium.launch()
  const errors = []
  // TVs: the first creates the room (and is host); the others watch the same room.
  const tvs = []
  for (const v of TVS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } })
    const p = await ctx.newPage()
    p.on('pageerror', (e) => errors.push(`${v.name}: ${e.message}`))
    tvs.push({ ...v, page: p })
  }
  const host = tvs[0].page
  await host.goto(BASE + '/')
  await host.click('text=Start a new trip on this TV')
  await host.waitForURL(/\/[A-Z]{4}\/tv$/)
  const code = host.url().split('/').slice(-2)[0]
  for (const t of tvs) {
    if (t.page !== host) await t.page.goto(`${BASE}/${code}/tv`)
    await audit(t.page, t.name, 'tv')
    await t.page.click('text=Tap to start', { force: true })
  }
  // Phones
  const names = LONG ? LONG_NAMES : SHORT_NAMES
  const phones = []
  for (let i = 0; i < N; i++) {
    const v = PHONES[i % PHONES.length]
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, hasTouch: true, isMobile: v.name !== 'tablet' })
    const p = await ctx.newPage()
    p.on('pageerror', (e) => errors.push(`${v.name}: ${e.message}`))
    if (i === 0) {
      await p.goto(BASE + '/')
      await audit(p, v.name + '#' + i, 'phone')
    }
    await p.goto(`${BASE}/${code}`)
    await p.waitForSelector('#name')
    await audit(p, v.name + '#' + i, 'phone')
    await p.fill('#name', names[i]); await p.click('button[type=submit]'); await p.waitForSelector('.seat-list')
    phones.push({ ...v, label: `${v.name}#${i}`, page: p })
  }
  for (const t of tvs) await audit(t.page, t.name, 'tv', true)
  // Host drawer in the lobby, incl. Advanced
  await host.click('text=👑 Host'); await host.waitForSelector('.tv-drawer')
  await host.click('.tv-drawer >> text=Advanced')
  await audit(host, 'tv1920', 'tv', true)
  await host.click('.tv-drawer >> text=Close')
  // A phone host view with Advanced open: hand hosting to phone 0, look, hand back.
  await host.click('text=👑 Host')
  await host.locator('.tv-drawer label:has-text("Make a player the host") select').selectOption({ label: names[0] })
  await phones[0].page.waitForSelector('text=Start the trip')
  await phones[0].page.click('text=Advanced')
  await audit(phones[0].page, phones[0].label + '-host', 'phone', true)
  await phones[0].page.click('.lobby-menu button')
  await phones[0].page.click('text=Show rejoin codes'); await phones[0].page.waitForSelector('.codes')
  await audit(phones[0].page, phones[0].label + '-host', 'phone', true)
  await phones[0].page.click('text=Give hosting back to the TV')
  await host.waitForSelector('.tv-start-btn')
  await host.locator('.tv-code-row select').selectOption({ index: 1 }); await host.click('.tv-code-row button'); await host.waitForSelector('.tv-one-code')
  await audit(host, 'tv1920', 'tv', true)
  await host.click('.tv-drawer >> text=Close')
  await host.click('.tv-start-btn')

  // Role reveal: audit every phone, held and released; half go discreet.
  for (const [i, ph] of phones.entries()) {
    const p = ph.page
    await p.waitForSelector('text=Got it')
    await audit(p, ph.label, 'phone')
    const hold = p.locator('.role-hold'); const b = await hold.boundingBox()
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(120)
    await audit(p, ph.label, 'phone', true); await p.mouse.up()
    if (i % 2) await p.click('text=Discreet')
    await p.click('text=Got it')
  }
  for (const t of tvs) await audit(t.page, t.name, 'tv')

  let paused = false, caught = false
  for (let step = 0; step < 600; step++) {
    for (const t of tvs) await audit(t.page, t.name, 'tv')
    if (await host.locator('.tv-new').count()) break
    // Occasional extra screens: catch-up modal, held header role, pause overlay
    if (step === 12 && !caught) {
      caught = true
      for (const ph of phones.slice(0, 7)) {
        const p = ph.page
        if (!(await p.locator('.game-header').count())) continue
        await p.click('text=Catch me up'); await p.waitForSelector('.modal'); await audit(p, ph.label, 'phone', true)
        await p.click('.modal button.ghost')
        const h = p.locator('.hold-small'); const bb = await h.boundingBox()
        if (bb) { await p.mouse.move(bb.x + 10, bb.y + 10); await p.mouse.down(); await p.waitForTimeout(100); await audit(p, ph.label, 'phone', true); await p.mouse.up() }
      }
    }
    if (step === 20 && !paused) {
      paused = true
      await host.click('text=👑 Host'); await host.click('.tv-drawer >> text=Pause')
      await phones[0].page.waitForSelector('.paused-overlay')
      await host.click('.tv-drawer >> text=Close'); await host.waitForTimeout(300)
      for (const t of tvs) await audit(t.page, t.name, 'tv', true)
      for (const ph of phones.slice(0, 7)) await audit(ph.page, ph.label, 'phone', true)
      await host.click('text=👑 Host'); await host.click('.tv-drawer >> text=Resume'); await host.click('.tv-drawer >> text=Close')
      await phones[0].page.waitForSelector('.paused-overlay', { state: 'detached' })
    }
    // Audit every phone, then one phone with a prompt acts.
    const ready = []
    for (const ph of phones) {
      await audit(ph.page, ph.label, 'phone')
      if (await ph.page.locator('.prompt.turn').count()) ready.push(ph)
    }
    if (!ready.length) { await host.waitForTimeout(250); continue }
    const ph = ready[pick(ready.length)]
    const turn = ph.page.locator('.prompt.turn')
    if (await turn.locator('.result-hold').count()) {
      const rb = await turn.locator('.result-hold').boundingBox()
      await ph.page.mouse.move(rb.x + 20, rb.y + 20); await ph.page.mouse.down(); await ph.page.waitForTimeout(100)
      await audit(ph.page, ph.label, 'phone', true); await ph.page.mouse.up()
      await turn.locator('button.confirm').click()
    } else {
      const ch = turn.locator('.choice:not([disabled])'); const n = await ch.count()
      if (n) {
        await ch.nth(pick(n)).click()
        await audit(ph.page, ph.label + '-selected', 'phone')
        await turn.locator('button.confirm').click()
      }
    }
    await host.waitForTimeout(450)
  }
  // Ending: let beats finish, then audit game over everywhere, including the host drawer.
  await host.waitForTimeout(9000)
  for (const t of tvs) await audit(t.page, t.name, 'tv', true)
  for (const ph of phones) await audit(ph.page, ph.label, 'phone', true)
  await host.click('text=👑 Host'); await audit(host, 'tv1920', 'tv', true)
  fs.writeFileSync(`${OUT}/issues.json`, JSON.stringify([...issues.entries()].map(([k, v]) => ({ issue: v.example, count: v.where.size, where: [...v.where].slice(0, 6) })), null, 1))
  console.log(`code ${code}: ${seenStates.size} states, ${shots} screenshots, ${issues.size} distinct issues, ${errors.length} page errors`)
  for (const [k, v] of issues) console.log(`- [${v.where.size}] ${v.example}  e.g. ${[...v.where][0]}`)
  for (const e of errors.slice(0, 5)) console.log('ERR', e)
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

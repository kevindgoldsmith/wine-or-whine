import { describe, expect, it } from 'vitest'
import { render } from 'preact-render-to-string'
import type { ComponentChildren } from 'preact'
import themeJson from '../../../themes/wine_or_whine.json'
import { setThemeForTest } from '../theme'
import { GameCtx } from '../phone/common'
import { HandPrompt, NominatePrompt, ResultBody, RoleCard, TargetPrompt, VetoPrompt, VotePrompt } from '../phone/game'
import type { GameView } from '../types'

setThemeForTest(themeJson as any)
const names = ['Sarah', 'Tom', 'Priya', 'Jess', 'Marco', 'Ana', 'Dev']
const noop = () => {}
const EMOJI = /\p{Extended_Pictographic}/u

function wrap(node: ComponentChildren, discreet = true) {
  return render(<GameCtx.Provider value={{ discreet, hints: false, names, me: 0 }}>{node}</GameCtx.Provider>)
}

/** class attribute + inner text of every button. */
function buttons(html: string) {
  return [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>(.*?)<\/button>/gs)].map((m) => ({
    cls: m[1],
    text: m[2].replace(/<[^>]+>/g, ''),
  }))
}

function choiceButtons(html: string) {
  return buttons(html).filter((b) => b.cls.split(' ').includes('choice'))
}

const baseGame: GameView = {
  n: 7, phase: 'power', day: 3, alive: [true, true, true, true, false, true, true], living: 6,
  president: 0, nominee: null, chancellor: 1, term_limited: [1], eligible: [2, 3, 5, 6], breezy: 1, over: 2,
  meter: 0, deck_count: 10, discard_count: 4, board: [null, 'investigate', 'special_election', 'execute', 'execute'],
  veto_unlocked: false, veto_refused: false, power: 'investigate', power_targets: [1, 2, 5, 6], investigated: [3],
  waiting_on: [0], acked: [], voted: [], last_vote: null, history: [], winner: null, win_reason: null, roles: null,
  superlatives: [], me: 0, role: 'chill', known: { '0': 'chill' }, hand: null, my_vote: null, pending_result: null,
  private_results: [], phone_read_by: [],
}

const privateScreens: Record<string, () => ComponentChildren> = {
  vote: () => <VotePrompt send={noop} />,
  discard_BOO: () => <HandPrompt hand={['B', 'O', 'O']} mode="discard" send={noop} />,
  discard_BBB: () => <HandPrompt hand={['B', 'B', 'B']} mode="discard" send={noop} />,
  discard_OOO: () => <HandPrompt hand={['O', 'O', 'O']} mode="discard" send={noop} />,
  enact_veto: () => <HandPrompt hand={['B', 'O']} mode="enact" vetoAvailable send={noop} />,
  veto: () => <VetoPrompt send={noop} />,
  target: () => <TargetPrompt g={baseGame} send={noop} />,
  nominate: () => <NominatePrompt g={{ ...baseGame, phase: 'nominate' }} send={noop} />,
}

describe('discreet mode', () => {
  it('renders every choice button on every private screen with one identical style and no icons', () => {
    const allClasses = new Set<string>()
    for (const [name, screen] of Object.entries(privateScreens)) {
      const html = wrap(screen())
      const choices = choiceButtons(html).filter((b) => !b.cls.includes('disabled'))
      expect(choices.length, name).toBeGreaterThan(0)
      for (const b of choices) {
        allClasses.add(b.cls)
        expect(b.text, `${name}: ${b.text}`).not.toMatch(EMOJI)
        expect(b.cls).not.toMatch(/tone-/)
      }
      for (const b of buttons(html)) expect(b.text).not.toMatch(EMOJI)
      expect(html).not.toMatch(/layout-(pair|cards|tags)/)
      expect(html).not.toMatch(/<svg/) // no icons or scenery on private screens in discreet mode
    }
    expect([...allClasses]).toEqual(['choice'])
  })

  it('looks the same whatever the cards are (only the words differ)', () => {
    const strip = (h: string) => h.replace(/Breezy Day|Overscheduled Day/g, 'CARD')
    const variants = ['BBB', 'BBO', 'BOO', 'OOO'].map((h) => strip(wrap(<HandPrompt hand={h.split('') as any} mode="discard" send={noop} />)))
    expect(new Set(variants).size).toBe(1)
    const votes = new Set(Array.from({ length: 20 }, () => wrap(<VotePrompt send={noop} />).replace(/>(Yes|No)</g, '>X<')))
    expect(votes.size).toBe(1)
  })

  it('shuffles on-screen positions of yes/no and cards', () => {
    const firsts = new Set<string>()
    for (let i = 0; i < 40; i++) firsts.add(choiceButtons(wrap(<VotePrompt send={noop} />))[0].text)
    expect(firsts).toEqual(new Set(['Yes', 'No']))
    const cardFirsts = new Set<string>()
    for (let i = 0; i < 40; i++) cardFirsts.add(choiceButtons(wrap(<HandPrompt hand={['B', 'O', 'O']} mode="discard" send={noop} />))[0].text)
    expect(cardFirsts.size).toBe(2)
  })

  it('shows roles and results as short plain text', () => {
    for (const role of ['chill', 'over', 'chief'] as const) {
      const g = { ...baseGame, role, known: role === 'chill' ? { '0': role } : { '0': role, '3': role === 'over' ? 'chief' : 'over' } } as GameView
      const html = wrap(<RoleCard g={g} />)
      expect(html).toContain('role-plain')
      expect(html).not.toMatch(EMOJI)
      expect(html).not.toMatch(/<svg/)
      expect(html).toMatch(/Team: (Chill Parents|Overschedulers)/)
    }
    const peek = wrap(<ResultBody r={{ type: 'peek', day: 1, cards: ['B', 'O', 'O'] }} />)
    expect(peek).not.toMatch(EMOJI)
    const inv = wrap(<ResultBody r={{ type: 'investigate', day: 1, target: 2, team: 'over' }} />)
    expect(inv).toContain('Priya is on Team Overschedulers')
  })

  it('normal mode lays cards out in equal grid columns; only the veto button gets its own row', () => {
    for (const hand of [['B', 'O', 'O'], ['O', 'O', 'O'], ['B', 'B', 'O']] as const) {
      const html = wrap(<HandPrompt hand={[...hand]} mode="discard" send={noop} />, false)
      expect(html).toContain('--cols:3')
      expect(html).toContain('layout-cards')
    }
    const veto = wrap(<HandPrompt hand={['B', 'O']} mode="enact" vetoAvailable send={noop} />, false)
    expect(veto).toContain('--cols:2')
    const wide = choiceButtons(veto).filter((b) => b.cls.split(' ').includes('wide'))
    expect(wide.map((b) => b.text)).toEqual([expect.stringContaining('veto')])
    // Discreet mode never uses the wide class (all buttons identical).
    expect(choiceButtons(wrap(<HandPrompt hand={['B', 'O']} mode="enact" vetoAvailable send={noop} />)).every((b) => b.cls === 'choice')).toBe(true)
  })

  it('normal mode keeps colours and icons (sanity check of the test itself)', () => {
    const html = wrap(<HandPrompt hand={['B', 'O', 'O']} mode="discard" send={noop} />, false)
    expect(html).toMatch(/tone-breezy/)
    expect(html).toMatch(/<svg/) // drawn icons and the vineyard stub
  })
})

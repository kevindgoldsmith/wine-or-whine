import { beforeEach, describe, expect, it } from 'vitest'

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}

const g = globalThis as any
let shared: MemStorage

function newTab(search: string) {
  // One browser: localStorage is shared, sessionStorage is per tab.
  g.localStorage = shared
  g.sessionStorage = new MemStorage()
  g.location = { search }
}

describe('test tabs', () => {
  beforeEach(() => {
    shared = new MemStorage()
  })

  it('normal tabs share the seat token (a reload or second tab resumes the same player)', async () => {
    const { seatStore, tokenKey } = await import('../net')
    newTab('')
    seatStore.set(tokenKey('ABCD'), 'tok-1')
    newTab('')
    expect(seatStore.get(tokenKey('ABCD'))).toBe('tok-1')
  })

  it('?test tabs each keep their own seat, and the flag survives navigation within the tab', async () => {
    const { isTestTab, seatStore, tokenKey } = await import('../net')
    newTab('?test')
    expect(isTestTab()).toBe(true)
    seatStore.set(tokenKey('ABCD'), 'tab-a')
    const tabA = g.sessionStorage
    g.location = { search: '' } // navigated to /ABCD without the query: still a test tab
    expect(isTestTab()).toBe(true)
    expect(seatStore.get(tokenKey('ABCD'))).toBe('tab-a')

    newTab('?test')
    expect(seatStore.get(tokenKey('ABCD'))).toBeNull() // a fresh tab starts a new login
    seatStore.set(tokenKey('ABCD'), 'tab-b')

    g.sessionStorage = tabA
    expect(seatStore.get(tokenKey('ABCD'))).toBe('tab-a')
    expect(shared.getItem(tokenKey('ABCD'))).toBeNull() // nothing leaked into the shared store
  })
})

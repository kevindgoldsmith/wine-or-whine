// Sound effects with synthesized WebAudio placeholders. Drop real files into static/sfx/<slot>.mp3 and
// list them in static/sfx/manifest.json to replace a placeholder.

export const SLOTS = [
  'day_start', 'nominate', 'vote_cast', 'vote_reveal', 'vote_pass', 'vote_fail',
  'meter_tick', 'babies_decide', 'shh', 'card_breezy', 'card_over', 'power',
  'veto', 'babysitter', 'win_chill', 'win_over', 'click',
] as const
export type Slot = (typeof SLOTS)[number]

type Note = [freq: number, start: number, dur: number, wave?: OscillatorType, gain?: number]

// Gentle, short synth recipes: [frequency Hz, start s, duration s, waveform, gain]
const RECIPES: Record<Slot, Note[]> = {
  day_start: [[523, 0, 0.18, 'sine'], [659, 0.15, 0.18, 'sine'], [784, 0.3, 0.35, 'sine']],
  nominate: [[440, 0, 0.12, 'triangle'], [587, 0.1, 0.2, 'triangle']],
  vote_cast: [[700, 0, 0.06, 'sine', 0.3]],
  vote_reveal: [[392, 0, 0.1, 'triangle'], [392, 0.12, 0.1, 'triangle'], [523, 0.24, 0.25, 'triangle']],
  vote_pass: [[523, 0, 0.15, 'sine'], [784, 0.12, 0.3, 'sine']],
  vote_fail: [[392, 0, 0.18, 'sawtooth', 0.25], [311, 0.15, 0.35, 'sawtooth', 0.25]],
  meter_tick: [[880, 0, 0.05, 'square', 0.15], [660, 0.08, 0.05, 'square', 0.15]],
  babies_decide: [[330, 0, 0.2, 'triangle'], [262, 0.2, 0.2, 'triangle'], [196, 0.4, 0.5, 'triangle']],
  shh: [[0, 0, 0.6, 'sine', 0.0]], // noise burst, see below
  card_breezy: [[523, 0, 0.12, 'sine'], [659, 0.1, 0.12, 'sine'], [784, 0.2, 0.12, 'sine'], [1047, 0.3, 0.4, 'sine']],
  card_over: [[294, 0, 0.2, 'sawtooth', 0.2], [277, 0.2, 0.2, 'sawtooth', 0.2], [262, 0.4, 0.45, 'sawtooth', 0.2]],
  power: [[660, 0, 0.1, 'triangle'], [880, 0.1, 0.1, 'triangle'], [660, 0.2, 0.25, 'triangle']],
  veto: [[440, 0, 0.12, 'square', 0.15], [330, 0.14, 0.25, 'square', 0.15]],
  babysitter: [[784, 0, 0.25, 'sine'], [659, 0.25, 0.25, 'sine'], [523, 0.5, 0.5, 'sine']],
  win_chill: [[523, 0, 0.15], [659, 0.15, 0.15], [784, 0.3, 0.15], [1047, 0.45, 0.6], [784, 0.45, 0.6]],
  win_over: [[220, 0, 0.3, 'sawtooth', 0.2], [208, 0.3, 0.3, 'sawtooth', 0.2], [196, 0.6, 0.3, 'sawtooth', 0.2], [147, 0.9, 0.8, 'sawtooth', 0.2]],
  click: [[1200, 0, 0.03, 'sine', 0.2]],
}

let ctx: AudioContext | null = null
let muted = false
let available: Set<string> | null = null
const buffers = new Map<string, AudioBuffer>()

export function audioContext(): AudioContext | null {
  if (!ctx) {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  return ctx
}

/** Call from a user gesture (the TV's "Tap to start") to unlock audio. */
export async function unlockAudio() {
  const c = audioContext()
  if (c && c.state === 'suspended') await c.resume()
  try {
    const r = await fetch('/sfx/manifest.json')
    available = new Set(r.ok ? await r.json() : [])
  } catch {
    available = new Set()
  }
}

export function setMuted(m: boolean) {
  muted = m
}
export function isMuted() {
  return muted
}

async function fileBuffer(slot: string): Promise<AudioBuffer | null> {
  if (!available?.has(slot)) return null
  if (buffers.has(slot)) return buffers.get(slot)!
  const c = audioContext()
  if (!c) return null
  try {
    const r = await fetch(`/sfx/${slot}.mp3`)
    if (!r.ok) return null
    const buf = await c.decodeAudioData(await r.arrayBuffer())
    buffers.set(slot, buf)
    return buf
  } catch {
    return null
  }
}

export async function playSfx(slot: Slot, volume = 1) {
  if (muted) return
  const c = audioContext()
  if (!c) return
  if (c.state === 'suspended') await c.resume().catch(() => {})
  if (c.state !== 'running') return
  const master = c.createGain()
  master.gain.value = volume
  master.connect(c.destination)
  const buf = await fileBuffer(slot)
  if (buf) {
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(master)
    src.start()
    return
  }
  const t0 = c.currentTime + 0.01
  if (slot === 'shh') {
    // Soft filtered noise "shhh".
    const len = Math.floor(c.sampleRate * 0.9)
    const noise = c.createBuffer(1, len, c.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len)
    const src = c.createBufferSource()
    src.buffer = noise
    const f = c.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 2500
    const g = c.createGain()
    g.gain.value = 0.25
    src.connect(f).connect(g).connect(master)
    src.start(t0)
    return
  }
  for (const [freq, start, dur, wave = 'sine', gain = 0.35] of RECIPES[slot]) {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = wave
    o.frequency.value = freq
    g.gain.setValueAtTime(0, t0 + start)
    g.gain.linearRampToValueAtTime(gain, t0 + start + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur)
    o.connect(g).connect(master)
    o.start(t0 + start)
    o.stop(t0 + start + dur + 0.05)
  }
}

// ------------------------------------------------------------------ voice (TV only)

const voiceQueue: { text: string; url?: string }[] = []
let speaking = false

export function say(items: { text: string; url?: string }[]) {
  voiceQueue.push(...items)
  if (!speaking) void nextLine()
}

function speakBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    if (!synth) return resolve()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.0
    u.onend = () => resolve()
    u.onerror = () => resolve()
    synth.speak(u)
    setTimeout(resolve, 8000)
  })
}

function playUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const a = new Audio(url)
    a.onended = () => resolve(true)
    a.onerror = () => resolve(false)
    a.play().catch(() => resolve(false))
    setTimeout(() => resolve(true), 12000)
  })
}

async function nextLine() {
  const item = voiceQueue.shift()
  if (!item) {
    speaking = false
    return
  }
  speaking = true
  if (!muted) {
    const ok = item.url ? await playUrl(item.url) : false
    if (!ok) await speakBrowser(item.text)
  }
  void nextLine()
}

// ------------------------------------------------------------------ lobby music (TV only)

let music: HTMLAudioElement | null = null
export function lobbyMusic(on: boolean) {
  if (on && !muted) {
    if (!music) {
      music = new Audio('/music/lobby.mp3')
      music.loop = true
      music.volume = 0.35
    }
    music.play().catch(() => {
      /* no file or not allowed: fine */
    })
  } else {
    music?.pause()
  }
}

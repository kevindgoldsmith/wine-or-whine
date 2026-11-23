export type Role = 'chill' | 'over' | 'chief'
export type Card = 'B' | 'O'
export type Power = 'investigate' | 'special_election' | 'peek' | 'execute'
export type Phase =
  | 'reveal' | 'nominate' | 'vote' | 'pres_discard' | 'chanc_enact'
  | 'veto_response' | 'power' | 'power_result' | 'game_over'

export interface GameEvent {
  type: string
  seq: number
  day: number
  [k: string]: any
}

export interface VoteResult {
  day: number
  president: number
  nominee: number
  votes: (boolean | null)[]
  yes: number
  no: number
  passed: boolean
}

export interface PrivateResult {
  type: 'investigate' | 'peek'
  day: number
  target?: number
  team?: 'chill' | 'over'
  cards?: Card[]
}

export interface Award { key: string; seats: number[]; count: number }

export interface GameView {
  n: number
  phase: Phase
  day: number
  alive: boolean[]
  living: number
  president: number
  nominee: number | null
  chancellor: number | null
  term_limited: number[]
  eligible: number[]
  breezy: number
  over: number
  meter: number
  deck_count: number
  discard_count: number
  board: (Power | null)[]
  veto_unlocked: boolean
  veto_refused: boolean
  power: Power | null
  power_targets: number[]
  investigated: number[]
  waiting_on: number[]
  acked: number[]
  voted: number[]
  last_vote: VoteResult | null
  history: GameEvent[]
  winner: 'chill' | 'over' | null
  win_reason: string | null
  roles: Role[] | null
  superlatives: Award[]
  // player-only fields
  me?: number
  role?: Role
  known?: Record<string, Role>
  hand?: Card[] | null
  my_vote?: boolean | null
  pending_result?: PrivateResult | null
  private_results?: PrivateResult[]
  phone_read_by?: number[]
  spectator?: boolean
}

export interface RoomPlayer { id: string; name: string; online: boolean }

export interface RoomView {
  code: string
  status: 'lobby' | 'active' | 'over'
  paused: boolean
  theme: string
  hints: boolean
  voice: boolean
  house: Record<string, (Power | null)[]>
  host_id: string | null
  tv_hosted?: boolean
  games_played: number
  join_url: string
  players: RoomPlayer[]
  seat_ids: string[]
}

export interface StateMsg {
  t: 'state'
  room: RoomView
  game: GameView | null
  events: GameEvent[]
  me?: { id: string; name: string; host: boolean }
  say?: { text: string; url?: string }[]
  tv_admin?: boolean
}

export interface Theme {
  id: string
  name: string
  tagline: string
  credit: string
  terms: Record<string, string>
  icons: Record<string, string>
  tracks: { breezy: string[]; over: string[] }
  power_desc: Record<string, string>
  win: Record<string, string>
  winner_title: Record<string, string>
  superlatives: Record<string, { title: string; desc: string }>
  ui: Record<string, string>
  hints: Record<string, string>
  log: Record<string, string>
  announce: Record<string, string>
  beats: Record<string, string>
  errors?: Record<string, string>
  approved_lines?: string[]
}

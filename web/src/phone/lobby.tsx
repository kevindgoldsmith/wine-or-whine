import { useEffect, useState } from 'preact/hooks'
import type { Power, RoomView } from '../types'
import { errorText, icon, term, ui } from '../theme'
import type { Connection } from '../net'
import { store, hostKeyKey } from '../net'
import { Credit } from './common'

export function JoinScreen(props: { conn: Connection; room: RoomView; error: string | null; onRejoin: () => void }) {
  const [name, setName] = useState(store.get('wow:name') ?? '')
  const submit = (e: Event) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    store.set('wow:name', n)
    props.conn.join(n, store.get(hostKeyKey(props.room.code)))
  }
  return (
    <main class="screen center">
      <h1 class="display">{ui('app_title')}</h1>
      <p class="tagline">{ui('lobby_code', { code: props.room.code })}</p>
      <form class="card form" onSubmit={submit}>
        <label for="name">{ui('home_name_label')}</label>
        <input id="name" value={name} maxLength={20} autoComplete="nickname" placeholder={ui('home_name_placeholder')}
          onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        {props.error ? <p class="error">{errorText(props.error)}</p> : null}
        <button class="primary big" type="submit" disabled={!name.trim()}>{ui('home_join_button')}</button>
      </form>
      {props.room.players.length ? (
        <ul class="names">
          {props.room.players.map((p) => <li>{p.name}</li>)}
        </ul>
      ) : null}
      <button class="link" type="button" onClick={props.onRejoin}>{ui('home_have_rejoin')}</button>
    </main>
  )
}

export function RejoinScreen(props: { conn: Connection; room: RoomView; error: string | null; onBack?: () => void }) {
  const [pid, setPid] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const players = props.room.seat_ids.length
    ? props.room.seat_ids.map((id) => props.room.players.find((p) => p.id === id)!).filter(Boolean)
    : props.room.players
  return (
    <main class="screen">
      <h1 class="display">{ui('rejoin_title')}</h1>
      <p>{ui('rejoin_seat_label')}</p>
      <div class="choice-list">
        {players.map((p) => (
          <button type="button" class={`choice ${pid === p.id ? 'selected' : ''}`} onClick={() => setPid(p.id)}>
            <span class="choice-label">{p.name}</span>
          </button>
        ))}
      </div>
      <form class="card form" onSubmit={(e) => {
        e.preventDefault()
        if (pid && code.length === 4) props.conn.rejoin(pid, code)
      }}>
        <label for="code">{ui('rejoin_code_label')}</label>
        <input id="code" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={code}
          onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, ''))} />
        {props.error ? <p class="error">{errorText(props.error)}</p> : null}
        <button class="primary big" type="submit" disabled={!pid || code.length !== 4}>{ui('rejoin_button')}</button>
      </form>
      {props.onBack ? <button class="link" type="button" onClick={props.onBack}>{ui('back')}</button> : null}
    </main>
  )
}

const POWERS: (Power | null)[] = [null, 'investigate', 'special_election', 'peek', 'execute']

export function Lobby(props: { conn: Connection; room: RoomView; meId: string; isHost: boolean; error: string | null }) {
  const { room, conn, isHost } = props
  const n = room.players.length
  const [themes, setThemes] = useState<{ id: string; name: string }[]>([])
  const [boards, setBoards] = useState<Record<string, (Power | null)[]> | null>(null)
  const [advanced, setAdvanced] = useState(false)
  useEffect(() => {
    if (!isHost) return
    fetch('/api/themes').then((r) => r.json()).then(setThemes).catch(() => {})
    fetch('/api/boards').then((r) => r.json()).then((b) => setBoards(b.official)).catch(() => {})
  }, [isHost])
  const move = (i: number, d: number) => {
    const ids = room.players.map((p) => p.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    conn.host({ type: 'reorder', order: ids })
  }
  const setSlot = (bracket: string, slot: number, value: Power | null) => {
    const base = room.house[bracket] ?? boards![bracket]
    const next = base.slice()
    next[slot] = value
    conn.host({ type: 'settings', house: { ...room.house, [bracket]: next } })
  }
  const tvUrl = `${location.origin}/${room.code}/tv`
  return (
    <main class="screen">
      <header class="lobby-head">
        <h1 class="display">{ui('lobby_title')}</h1>
        <div class="room-code" aria-label={ui('lobby_code', { code: room.code })}>{room.code}</div>
      </header>
      <p class="status-line">
        {n < 5 || n > 10 ? ui('lobby_need_players', { n }) : isHost ? ui('lobby_seat_hint') : ui('lobby_waiting_host')}
      </p>
      <img class="qr small" src={`/api/rooms/${room.code}/qr.svg`} alt={ui('lobby_scan', { url: room.join_url })} />
      <p class="muted center-text">{ui('lobby_scan', { url: room.join_url })}</p>
      <ol class="seat-list">
        {room.players.map((p, i) => (
          <li class={p.id === props.meId ? 'me' : ''}>
            <span class={`dot ${p.online ? 'on' : 'off'}`} aria-label={p.online ? '' : ui('lobby_offline')} />
            <span class="seat-name">
              {p.name}
              {p.id === props.meId ? <em> ({ui('lobby_you')})</em> : null}
              {p.id === room.host_id ? <span class="badge">{ui('lobby_host_badge')}</span> : null}
            </span>
            {isHost ? (
              <span class="seat-tools">
                <button type="button" class="icon-btn" aria-label={ui('lobby_up')} disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                <button type="button" class="icon-btn" aria-label={ui('lobby_down')} disabled={i === n - 1} onClick={() => move(i, 1)}>▼</button>
                {p.id !== room.host_id ? (
                  <button type="button" class="icon-btn danger" aria-label={ui('lobby_kick')} onClick={() => conn.host({ type: 'kick', player_id: p.id })}>✕</button>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {props.error ? <p class="error">{errorText(props.error)}</p> : null}
      {isHost ? (
        <section class="host-panel">
          <button type="button" class="primary big" disabled={n < 5 || n > 10} onClick={() => conn.host({ type: 'start' })}>
            {ui('lobby_start')}
          </button>
          <label class="toggle">
            <input type="checkbox" checked={room.hints} onChange={(e) => conn.host({ type: 'settings', hints: (e.target as HTMLInputElement).checked })} />
            {ui('lobby_hints')}
          </label>
          <label class="toggle">
            <input type="checkbox" checked={room.voice} onChange={(e) => conn.host({ type: 'settings', voice: (e.target as HTMLInputElement).checked })} />
            {ui('lobby_voice')}
          </label>
          {themes.length > 1 ? (
            <label class="field">
              {ui('lobby_theme')}
              <select value={room.theme} onChange={(e) => conn.host({ type: 'settings', theme: (e.target as HTMLSelectElement).value })}>
                {themes.map((t) => <option value={t.id}>{t.name}</option>)}
              </select>
            </label>
          ) : null}
          <p class="muted">{ui('home_tv_hint')}: <a href={tvUrl} target="_blank" rel="noopener">{tvUrl}</a></p>
          <button type="button" class="link" onClick={() => setAdvanced(!advanced)}>{ui('lobby_advanced')} {advanced ? '▴' : '▾'}</button>
          {advanced && boards ? (
            <div class="house">
              <h3>{ui('lobby_house_rules')}</h3>
              {Object.keys(boards).map((bracket) => {
                const slots = room.house[bracket] ?? boards[bracket]
                return (
                  <fieldset>
                    <legend>{bracket} · {room.house[bracket] ? '✎' : ''}</legend>
                    {slots.map((v, i) => (
                      <label class="field">
                        {ui('lobby_house_slot', { n: i + 1 })}
                        <select value={v ?? ''} onChange={(e) => setSlot(bracket, i, ((e.target as HTMLSelectElement).value || null) as Power | null)}>
                          {POWERS.map((p) => <option value={p ?? ''}>{p ? `${icon(p)} ${term(p)}` : ui('lobby_house_none')}</option>)}
                        </select>
                      </label>
                    ))}
                    {room.house[bracket] ? (
                      <button type="button" class="link" onClick={() => {
                        const h = { ...room.house }
                        delete h[bracket]
                        conn.host({ type: 'settings', house: h })
                      }}>{ui('lobby_house_reset')}</button>
                    ) : null}
                  </fieldset>
                )
              })}
            </div>
          ) : null}
        </section>
      ) : null}
      <Credit />
    </main>
  )
}

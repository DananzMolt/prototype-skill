// The comment layer's state, outside React so the shell's string-built chrome (the bar's button,
// the sidebar's counts, the pill) can read it and the two React roots (over the stage, in the
// rail) share it. Drafts and the unfinished comment are kept in localStorage per session, so a
// refresh (or the shell reloading itself) loses nothing.
import { useSyncExternalStore } from 'react'
import type { Inbox } from '../shell'
import type { CState, Held, Item, State } from './types'

type Saved = { items: Item[]; held: Held | null }

export function createStore(sessionId: string) {
  const key = `proto-comments-${sessionId}`
  const read = (): Saved => {
    try {
      const s = JSON.parse(localStorage.getItem(key) ?? 'null')
      return { items: Array.isArray(s?.items) ? s.items : [], held: s?.held ?? null }
    } catch { return { items: [], held: null } }
  }
  const saved = read()
  let state: State = { items: saved.items, held: saved.held, mode: { kind: 'idle' }, active: null, nudge: 0, pendingTag: null, place: null, sheet: false, sending: false, error: '' }
  const listeners = new Set<() => void>()
  let timer = 0
  const persist = () => {
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      const write = (s: Saved) => localStorage.setItem(key, JSON.stringify(s))
      try { write({ items: state.items, held: state.held }) } catch {
        // Over quota (screenshots are data URLs): keep the words, drop the pictures.
        try { write({ items: state.items.map(({ shot, ...i }) => i), held: state.held && (({ shot, ...h }) => h)(state.held) }) } catch { /* nothing more to do */ }
      }
    }, 250)
  }
  const store = {
    get: () => state,
    set(patch: Partial<State> | ((s: State) => Partial<State>)) {
      const next = typeof patch === 'function' ? patch(state) : patch
      const keep = next.items !== undefined || next.held !== undefined
      state = { ...state, ...next }
      if (keep) persist()
      listeners.forEach(l => l())
    },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
  }
  return store
}
export type Store = ReturnType<typeof createStore>

export function useStore(store: Store): State {
  return useSyncExternalStore(store.subscribe, store.get)
}

/** What became of a sent comment, from the inbox the server keeps. */
export type Said = { text: string; by: 'claude' | 'codex' }
export function progress(item: Item, inbox?: Inbox): { state: CState; reply: Said | null } {
  if (!item.sent) return { state: 'draft', reply: null }
  // Until the first status arrives there is nothing to say but that it was sent.
  if (!inbox) return { state: 'sent', reply: null }
  const b = inbox.batches.find(x => x.id === item.sent!.batch)
  // A batch the server no longer lists is an old one, long since answered.
  if (!b) return { state: 'done', reply: null }
  const c = b.comments.find(x => x.n === item.sent!.i)
  const said = c?.reply ?? b.reply
  const reply = said ? { text: said.text, by: said.by ?? 'claude' } : null
  if (c?.done) return { state: 'done', reply }
  return { state: b.state === 'sent' ? 'sent' : 'seen', reply }
}

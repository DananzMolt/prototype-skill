// What the comment layer can do, shared by the stage, the rail, the bar's button and the keys.
// The flow: Comment turns picking on; a pick opens a composer on the element; Add saves a draft;
// Send posts every draft as one batch. Whatever is being written when the composer is put away
// any way but Cancel or Add is held, and comes back with the next comment.
import type { CommentBatch } from '../shell'
import { find } from './dom'
import { plain } from './ui'
import type { Ctx, Host } from './ctx'
import type { Store } from './store'
import type { Draft, Item, Place, Target } from './types'
import { routeOf } from './types'

const uid = () => Math.random().toString(36).slice(2, 9)
const hasWords = (d: Draft) => d.body.some(s => typeof s !== 'string' || s.trim()) || d.tags.length > 0 || !!d.shot

export function createActions(store: Store, host: Host) {
  const get = store.get, set = store.set
  const here = (i: Item) => { const p = get().place; return !!p && i.proto === p.proto && i.variant === p.variant && (i.state ?? '') === (p.state ?? '') }
  const act = {
    here,
    /** Comments on what is on screen. */
    onScreen: () => get().items.filter(here),
    drafts: () => get().items.filter(i => !i.sent),

    /** The page moved (or stopped being somewhere comments can go). */
    setPlace(place: Place | null) {
      const was = get().place
      const same = !!place && !!was && place.proto === was.proto && place.variant === was.variant && (place.state ?? '') === (was.state ?? '')
      if (same) { if (place!.title !== was!.title || place!.phone !== was!.phone) set({ place }); return }
      // A comment half-written stays held (it was kept as it was typed); picking just stops.
      set({ place, mode: { kind: 'idle' }, active: null, pendingTag: null })
    },

    toggle() { if (get().place) set(s => ({ mode: s.mode.kind === 'pick' ? { kind: 'idle' } : { kind: 'pick' }, active: null })) },
    stop() { set({ mode: { kind: 'idle' } }) },
    close() { set({ mode: { kind: 'idle' }, active: null, pendingTag: null }) },
    begin(target: Target) { set({ mode: { kind: 'compose', target }, active: null }) },
    /** Pick an element to tag from the open composer; it comes back to it with the pick. */
    tagPick() { set(s => s.mode.kind === 'compose' ? { mode: { kind: 'tag', target: s.mode.target, id: s.mode.id } } : {}) },
    tagDone(picked: Target | null) {
      set(s => s.mode.kind === 'tag' ? { mode: { kind: 'compose', target: s.mode.target, id: s.mode.id }, pendingTag: picked } : {})
    },
    tagTaken() { set({ pendingTag: null }) },
    open(id: string) {
      const i = get().items.find(x => x.id === id)
      if (!i) return
      if (!here(i)) { host.go(i.proto, i.variant, i.state); set({ active: id }); return }
      set({ active: id, mode: i.sent ? { kind: 'idle' } : { kind: 'compose', target: i.target, id } })
      find(host.mount(), i.target)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    resume() { const h = get().held; if (h) set({ active: null, mode: { kind: 'compose', target: h.target } }) },
    discardHeld() { set({ held: null }) },
    /** Called as a new comment is written, so it survives being put away. */
    hold(d: Draft, target: Target) { set({ held: hasWords(d) ? { ...d, target } : null }) },
    /** Acting on the design while a comment is open: an empty one moves to the new element, a written one says no. */
    guard(el: Target) {
      const m = get().mode
      if (m.kind !== 'compose') return
      if (get().held || m.id) set(s => ({ nudge: s.nudge + 1 }))
      else set({ mode: { kind: 'compose', target: el } })
    },

    save(d: Draft, target: Target, id?: string) {
      const p = get().place
      if (!p) return
      if (id) set(s => ({ items: s.items.map(i => i.id === id ? { ...i, ...d } : i), held: null, mode: { kind: 'idle' }, active: null }))
      else {
        const n = Math.max(0, ...get().items.filter(i => i.proto === p.proto && i.variant === p.variant).map(i => i.n)) + 1
        const item: Item = { id: uid(), proto: p.proto, variant: p.variant, ...(p.state ? { state: p.state } : {}), n, ...d, target, at: Date.now() }
        set(s => ({ items: [...s.items, item], held: null, mode: { kind: 'idle' }, active: null }))
      }
    },
    cancel() { set({ held: null, mode: { kind: 'idle' }, active: null, pendingTag: null }) },
    remove(id: string) { set(s => ({ items: s.items.filter(i => i.id !== id), mode: { kind: 'idle' }, active: null })) },

    /** Every draft, as one batch. */
    async send() {
      const drafts = get().items.filter(i => !i.sent)
      if (!drafts.length || get().sending) return
      const phone = get().place?.phone ?? false
      const batch: CommentBatch = {
        theme: host.dark() ? 'dark' : 'light',
        viewport: { w: innerWidth, h: innerHeight, phone },
        comments: drafts.map(i => ({
          route: routeOf(i),
          text: plain(i),
          target: i.target,
          ...(i.tags.length ? { tags: i.tags } : {}),
          ...(i.shot ? { images: [{ dataUrl: i.shot, name: 'marked up' }] } : {}),
        })),
      }
      set({ sending: true, error: '' })
      try {
        const batchId = await host.send(batch)
        const at = new Map(drafts.map((d, k) => [d.id, k + 1]))
        set(s => ({ sending: false, items: s.items.map(i => at.has(i.id) ? { ...i, sent: { batch: batchId, i: at.get(i.id)! } } : i) }))
      } catch (e) {
        set({ sending: false, error: e instanceof Error ? e.message : 'Could not send' })
      }
    },
    clearError() { set({ error: '' }) },
    openSheet(open: boolean) { set({ sheet: open }) },
  }
  return act
}
export type Actions = ReturnType<typeof createActions>
export type { Ctx }

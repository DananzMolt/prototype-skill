// The comment layer, as the shell sees it: one store, one set of actions, and the React roots the
// shell places (over the stage, in the side panel, the phone's sheet, the bar's decision menu).
// Everything else the shell needs from it (counts for the bar, the key, Esc) is on what this returns.
import { createRoot } from 'react-dom/client'
import type { Inbox } from '../shell'
import { createActions } from './actions'
import { CommentsCtx, type Ctx, type Host } from './ctx'
import { Decide, DecidePop, type DecidePopProps, type Subject } from './decide'
import { Layer } from './layer'
import { PhoneSheet, Rail } from './rail'
import { createStore, progress } from './store'
import type { Place, State } from './types'

export type { DecidePopProps, Place, State, Subject }

export function createComments(host: Host, sessionId: string) {
  const store = createStore(sessionId)
  const act = createActions(store, host)
  const ctx: Ctx = { store, host, act }
  const wrap = (el: JSX.Element) => <CommentsCtx.Provider value={ctx}>{el}</CommentsCtx.Provider>
  createRoot(host.layer).render(wrap(<Layer />))
  return {
    store,
    act,
    mountRail(el: HTMLElement) { createRoot(el).render(wrap(<Rail />)) },
    mountSheet(el: HTMLElement) { createRoot(el).render(wrap(<PhoneSheet />)) },
    /** The bar's Pick, More and Build menu, mounted once; the returned function draws it with new props. */
    mountDecide(el: HTMLElement) { const root = createRoot(el); return (p: DecidePopProps) => root.render(wrap(<DecidePop {...p} />)) },
    /** The same choices for the phone's variant sheet, which renders them in its own root. */
    decideIn: (subject: Subject) => wrap(<Decide key={`${subject.proto}/${subject.variant}`} subject={subject} sheet />),
    setPlace: act.setPlace,
    setInbox(inbox: Inbox | undefined) { store.set({ inbox }) },
    /** Comments waiting to be sent, and open (sent, not yet done) ones, per variant: for the bar and the tree. */
    counts() {
      const s = store.get()
      const by = new Map<string, number>()
      let drafts = 0
      for (const i of s.items) {
        if (!i.sent) drafts++
        // A pick is made the moment it is sent; only what still needs Claude counts as open.
        if (progress(i, s.inbox).state === 'done' || i.action === 'pick' || i.action === 'unpick') continue
        const k = `${i.proto}/${i.variant}`
        by.set(k, (by.get(k) ?? 0) + 1)
      }
      return { drafts, total: s.items.length, by, picking: s.mode.kind === 'pick' || s.mode.kind === 'tag', held: !!s.held }
    },
    /** Esc, from the shell's own key handling: true when it put something away. */
    escape(): boolean {
      const s = store.get()
      if (s.sheet) { act.openSheet(false); return true }
      if (s.mode.kind === 'tag') { act.tagDone(null); return true }
      if (s.mode.kind !== 'idle' || s.active) { act.close(); return true }
      return false
    },
    /** The phone's comment button: the list if there is one, else straight to picking. */
    tap() {
      const s = store.get()
      if (s.mode.kind !== 'idle') return act.close()
      if (s.items.length || s.held) act.openSheet(true)
      else act.toggle()
    },
  }
}
export type Comments = ReturnType<typeof createComments>

// What a reviewer needs to get through a design: values to type, things to try, scenarios to
// switch, events to make happen and caveats. A variant reports them while it runs (src/hints.ts,
// useHints) and the page draws them in its Try it panel. Kept per mounted design, since a lobby
// runs several at once and only the one on the stage is shown.

/** What a thing to try asks for at its spot. */
export type Act = 'click' | 'drag' | 'right-click' | 'type' | 'hover' | 'key'
/** One step of a thing to try that takes several. */
export type Step = { at: string; act?: Act; label?: string }

export type Hint =
  /** Something to type. fill: a selector for the field inside the design that Fill in types it
   *  into. A function value is read again every second (a 2FA code that changes). */
  | { kind: 'value'; label: string; value: string | (() => string); fill?: string; note?: string }
  /** Something worth trying, ticked off when the design says it was done. Pointing at it in the
   *  panel lights where it happens on the design (shell/spotlight.ts): at, a selector for where
   *  you start, and to, where a drag ends. act: what you do there (from to, a drag; else a
   *  click). label: what the spot is called instead of the act's word. key: a shortcut to press
   *  ('⌘ K', keys apart by spaces). all: every match of at counts (any of these). steps: a thing
   *  done in order (open a menu, then pick in it); the last step on the page is the one lit. */
  | { kind: 'try'; text: string; done?: boolean; at?: string; to?: string; act?: Act; label?: string; key?: string; all?: boolean; steps?: Step[] }
  /** A scenario the design can be put in (Empty, Busy, Error, First visit). */
  | { kind: 'switch'; label: string; options: string[]; value: string; set: (option: string) => void }
  /** Something that would happen from outside (a message arrives, a payment fails). */
  | { kind: 'event'; label: string; run: () => void }
  /** What doesn't work in the prototype, so nobody reports it. */
  | { kind: 'caveat'; text: string }

const lists = new Map<Element, Hint[]>()
const keys = new Map<Element, string>()
const subs = new Set<() => void>()
// What the panel shows, without the callbacks: a design re-renders often and its callbacks are
// new each time, which alone is no reason to redraw the panel.
const keyOf = (list: Hint[]) => JSON.stringify(list.map(h => h.kind === 'value' && typeof h.value === 'function' ? { ...h, value: 0 } : h))

export const hints = {
  /** The design mounted in host reports its hints (on every render). */
  set(host: Element, list: Hint[]) {
    const k = keyOf(list), changed = keys.get(host) !== k
    lists.set(host, list)
    keys.set(host, k)
    if (changed) subs.forEach(f => f())
  },
  drop(host: Element) {
    keys.delete(host)
    if (lists.delete(host)) subs.forEach(f => f())
  },
  of: (host: Element | null | undefined) => (host && lists.get(host)) || [],
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
}

/** Types a value into a field the way a person would, so the design's own state sees it. */
export function fillField(el: Element, value: string) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const proto = Object.getPrototypeOf(el)
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  } else if (el instanceof HTMLElement && el.isContentEditable) el.textContent = value
  else return false
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

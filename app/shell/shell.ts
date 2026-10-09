// The session shell: a switcher whose dropdown is the session in columns (a prototype built from
// another one's variant comes after that variant), a sidebar with the same columns stacked, the
// variant your requests change on top, edge arrows, focus mode with a growing dock, and a
// crossfade between designs.
//
// One rule holds it together: the chrome re-renders freely, the designs never do. Each
// place (session lobby, prototype lobby, one variant) is a layer with its components
// mounted once; moving somewhere builds a new layer under the old one and fades the old
// one out. Live edits reach the mounted components through the framework's own HMR.

import { ic, esc, bd, ON, TAB_ON, TAB_OFF, IB, SEP, pulse, pop, ago, clock } from './ui'
import { dock, edge, smooth, runDock, restoreEdgeLabels, stageHover, installPointerTracking, fadeOut } from './motion'
import { hints, fillField, type Hint } from './hints'
import { createSheet, createMenuSheet } from './sheet'
import { createSpotlight, showable, showIcon, whereIs } from './spotlight'
import { createComments } from './comments/index'
import { tabIcon } from './favicon'

export type Variant = { id: string; name: string; file: string; load: () => Promise<unknown> }
/** Something behind clicks in a prototype's variants (a menu, a drawer, a dialog), reached by
 *  clicking its selectors in order. about: one line per variant; only: the variants that have it. */
export type State = { id: string; name: string; click: string[]; about?: Record<string, string>; only?: string[] }
export type Proto = { id: string; title: string; ask: string; kind: 'web' | 'phone'; created: string; archived: boolean; from?: { proto: string; variant: string }; picked?: string; screen: [number, number]; about: Record<string, string>; states: State[]; variants: Variant[] }
/** A variant of one prototype ("pricing" and "C"). */
export type Ref = { proto: string; variant: string }
/** work: the variant being changed now; before: the ones worked on before it (newest first);
 *  asks: what the user asked for on each variant ("pricing/C"), oldest first. */
export type Session = { id: string; name: string; path: string; createdAt: string; url?: string; localUrl?: string; work?: (Ref & { at?: string }) | null; before?: Ref[]; asks?: Record<string, { at: string; text: string }[]> }
type Mount = (el: HTMLElement, component: any) => () => void
// A variant can be shown in one of its states, or through a tool: all its states at once
// (all), playing through them (play), or next to another variant (compare).
type Tool = 'play' | 'all' | 'compare'
type Place = { view: 'session' } | { view: 'proto'; proto: string } | { view: 'variant'; proto: string; variant: string; state?: string; tool?: Tool }
type Layer = { el: HTMLElement; refs: unknown[]; ready: Promise<unknown>; dispose: () => void; player?: { toggle: () => void; jump: (i: number) => void } }
// Comments sent from the page to the agent running the session (`proto inbox`), and what came back.
export type Inbox = {
  new: number
  listening: boolean
  batches: { id: string; at: string; state: 'sent' | 'seen' | 'done'; reply: { text: string; at: string; by?: 'claude' | 'codex' } | null
    comments: { n: number; route: string; done: boolean; reply: { text: string; at: string; by?: 'claude' | 'codex' } | null }[] }[]
}
/** An element a comment is on or tags. Rect is in CSS px from the variant root's top left. */
export type Pinned = { selector?: string; shoot?: string; src?: string; tag?: string; text?: string; rect?: { x: number; y: number; w: number; h: number } }
/** One send: route is <slug>/<letter>[/<state>]; images are data URLs (png, jpeg, webp). */
export type CommentBatch = {
  comments: { route: string; text: string; point?: { x: number; y: number }; target?: Pinned; tags?: Pinned[]; images?: { dataUrl: string; name?: string }[] }[]
  viewport?: { w: number; h: number; phone?: boolean }
  theme?: 'light' | 'dark'
}
type Status = { lastEdit: number; keep: boolean; idleHours: number; deleteDays: number; inbox?: Inbox }

const PHONE = 'shrink-0 overflow-hidden rounded-[55px] border-[10px] border-zinc-900 bg-white text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-black dark:text-white'
// The phone scale: Fit (0) or a percentage. The menu offers these in a row and a slider for
// anything between, which lands on one of them within two points.
const SCALES = [0, 50, 75, 100]
const SCALE_MIN = 25
const SCALE_MAX = 100
const rangeAt = (v: number) => ((v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100
const segCls = (on: boolean) => `h-9 flex-1 rounded-md text-xs font-medium tabular-nums ${on ? TAB_ON : TAB_OFF}`
// A range input drawn the same in every browser (iOS Safari restyles its own): the track fills
// to --p, the thumb is a white disc.
const RANGE = 'h-11 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent px-1 outline-none [--fill:#18181b] [--rest:rgb(24_24_27/.1)] dark:[--fill:#fff] dark:[--rest:rgb(255_255_255/.15)] '
  + '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--fill)_var(--p),var(--rest)_var(--p))] '
  + '[&::-webkit-slider-thumb]:-mt-[9px] [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,.25),0_0_0_1px_rgba(0,0,0,.08)] focus-visible:[&::-webkit-slider-thumb]:shadow-[0_0_0_2px_#0ea5e9] '
  + '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-(--rest) [&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-(--fill) '
  + '[&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(0,0,0,.25),0_0_0_1px_rgba(0,0,0,.08)]'
// The sidebar's width: dragged between these, double-click resets it.
const SIDE_W = 320, SIDE_MIN = 260, SIDE_MAX = 480
const INTERACTIVE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="listbox"], [role="menu"]'
const TOOLS: Record<Tool, { name: string; icon: string; hint: string }> = {
  play: { name: 'Autoplay', icon: 'play', hint: 'Clicks through every state for you' },
  all: { name: 'All states', icon: 'grid', hint: 'Every state on one page' },
  compare: { name: 'Compare', icon: 'diff', hint: 'Side by side, in the same state' },
}

// ---------- reaching a state: click its selectors inside the design, in order ----------
const frame = () => new Promise(r => requestAnimationFrame(r))
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until<T>(get: () => T | null | undefined, ms: number): Promise<T | null> {
  const end = performance.now() + ms
  for (;;) {
    let x: T | null | undefined = null
    try { x = get() } catch { /* a bad selector: treated as not found */ }
    if (x) return x
    if (performance.now() > end) return null
    await frame()
  }
}
// The whole sequence a real click makes, so menus that open on pointerdown open too. Dispatched
// events reach the design's own handlers even inside an inert preview.
function press(el: Element) {
  const o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }
  const ptr = { ...o, pointerId: 1, isPrimary: true, pointerType: 'mouse' }
  el.dispatchEvent(new PointerEvent('pointerdown', ptr))
  el.dispatchEvent(new MouseEvent('mousedown', o))
  el.dispatchEvent(new PointerEvent('pointerup', ptr))
  el.dispatchEvent(new MouseEvent('mouseup', o))
  el.dispatchEvent(new MouseEvent('click', o))
}
/** Clicks each selector inside the host; returns the first one that matched nothing. */
async function replay(host: HTMLElement, steps: string[], alive: () => boolean, each?: (el: Element) => Promise<void>) {
  if (!await until(() => host.firstElementChild, 3000)) return steps[0] ?? null
  await frame(); await frame()
  for (const sel of steps) {
    const el = await until(() => host.querySelector(sel), 1500)
    if (!alive()) return null
    if (!el) return sel
    if (each) await each(el)
    if (!alive()) return null
    press(el)
    await frame(); await frame(); await wait(30)
  }
  return null
}

export function createShell(root: HTMLElement, opts: { mount: Mount; protos: Proto[]; session: Session }) {
  const { mount } = opts
  let protos = opts.protos
  let session = opts.session
  const q = new URLSearchParams(location.search)
  const stored = localStorage.getItem('proto-theme')
  const st = {
    place: { view: 'session' } as Place,
    focus: false,
    open: null as string | null,
    archived: false,
    side: q.has('side') ? q.get('side') !== '0' : localStorage.getItem('proto-side') !== '0',
    sideW: Math.min(SIDE_MAX, Math.max(SIDE_MIN, Number(localStorage.getItem('proto-side-w')) || SIDE_W)),
    drawer: false,
    // The phone's variant sheet, opened from the bottom pill.
    sheet: false,
    // The phone's bar opens its menus as sheets: the prototypes, or the session.
    menu: '' as '' | 'protos' | 'session',
    // On a phone the grid's phone cards open at half size; Fit leaves them tiny there.
    scale: matchMedia('(max-width: 639px)').matches ? 50 : 0,
    stack: q.has('stack') ? q.get('stack') !== '0' : localStorage.getItem('proto-lobby') === 'stack',
    dark: q.get('theme') ? q.get('theme') === 'dark' : stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches,
    copied: false,
    live: true,
    stopped: false,
    lastEdit: 0,
    editing: null as null | { proto: string; variant: string },
    status: null as Status | null,
    vs: new Map<string, string>(),
    playing: '' as string,
    // The working variant's strip: whether its requests are open, and the move Claude just made
    // (offered back for a few seconds).
    asks: false,
    moved: null as Ref | null,
    // The sidebar's level shown as columns (null: the last two), and the phone sheet's column.
    pairAt: null as number | null,
    drill: null as number | null,
  }

  // ---------- data helpers ----------
  const active = () => protos.filter(p => !p.archived)
  const archived = () => protos.filter(p => p.archived)
  const byId = (id: string) => protos.find(p => p.id === id)
  const editing = (p: string, v?: string) => !!st.editing && st.editing.proto === p && (!v || st.editing.variant === v)
  const cur = () => (st.place.view === 'session' ? undefined : byId(st.place.proto))

  // ---------- the working variant ----------
  // One per session, set by Claude (`proto work`, a pick), never by an edit. A target that was
  // archived or removed counts as none.
  const same = (a?: Ref | null, b?: Ref | null) => !!a && !!b && a.proto === b.proto && a.variant === b.variant
  const refOk = (r?: Ref | null) => { const p = r && byId(r.proto); const v = p && !p.archived && p.variants.find(x => x.id === r!.variant); return v ? { p: p!, v } : null }
  const workOf = () => refOk(session.work)
  const atWork = () => st.place.view === 'variant' && same(st.place, session.work) && !!workOf()
  const visible = (p: Proto) => p.variants
  const asksOf = (r: Ref) => session.asks?.[`${r.proto}/${r.variant}`] ?? []
  // States: those a variant has, the one a place points at, and whether a variant's note says
  // something changed. The first variant is the reference: its notes describe each state, the
  // others' notes say what they change, and a state they leave out is the same as there.
  const statesOf = (p: Proto, v: string) => p.states.filter(s => !s.only?.length || s.only.includes(v))
  const stateOf = (p: Proto, v: string, id?: string) => (id ? statesOf(p, v).find(s => s.id === id) : undefined)
  const refOf = (p: Proto) => p.variants[0]?.id ?? ''
  const changed = (p: Proto, v: string, s: State) => v !== refOf(p) && !!s.about?.[v]
  const toolOk = (p: Proto, v: string, t?: Tool) => !t || (t === 'compare' ? p.variants.length > 1 : statesOf(p, v).length > 0)
  const hashOf = (p: Place) => p.view === 'session' ? '#/' : p.view === 'proto' ? `#/${p.proto}` : `#/${p.proto}/${p.variant}${p.tool ? `/~${p.tool}` : ''}${p.state ? `/${encodeURIComponent(p.state)}` : ''}`
  const valid = (p: Place): boolean => {
    if (p.view === 'session') return true
    const proto = byId(p.proto)
    if (!proto) return false
    if (p.view === 'proto') return true
    return proto.variants.some(v => v.id === p.variant) && (!p.state || !!stateOf(proto, p.variant, p.state)) && toolOk(proto, p.variant, p.tool)
  }
  const parseHash = (hash = location.hash): Place | null => {
    const [proto, variant, a, b] = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
    const tool = a?.startsWith('~') ? a.slice(1) as Tool : undefined
    const state = tool ? b : a
    const p: Place = !proto ? { view: 'session' } : !variant ? { view: 'proto', proto } : { view: 'variant', proto, variant }
    if (!hash || !valid(p)) return null
    // A state or tool that isn't there (renamed, removed) falls back to the variant at rest.
    if (p.view === 'variant') {
      const q = byId(proto)!
      if (state && stateOf(q, variant, state)) p.state = state
      if (tool && TOOLS[tool] && toolOk(q, variant, tool)) p.tool = tool
    }
    return p
  }
  /** Moving to another variant keeps the state and tool, where that variant has them. */
  const keepIn = (proto: Proto, variant: string): Place => {
    const here = st.place.view === 'variant' && st.place.proto === proto.id ? st.place : null
    const state = here?.state && stateOf(proto, variant, here.state) ? here.state : undefined
    const tool = here?.tool && toolOk(proto, variant, here.tool) ? here.tool : undefined
    return { view: 'variant', proto: proto.id, variant, ...(state ? { state } : {}), ...(tool ? { tool } : {}) }
  }
  const defaultPlace = (): Place => {
    const newest = active().at(-1)
    return newest ? { view: 'proto', proto: newest.id } : { view: 'session' }
  }

  // ---------- nesting: a prototype built from another one's variant sits under it ----------
  const parentOf = (p: Proto) => { const a = p.from && byId(p.from.proto); return a && !a.archived && a.id !== p.id ? a : undefined }
  const isRoot = (p: Proto) => !parentOf(p)
  /** What a prototype was built from, oldest first, each with the variant the next one came from. */
  const lineage = (p: Proto) => {
    const out: { p: Proto; v: string }[] = []
    const seen = new Set([p.id])
    for (let q = p, a = parentOf(p); a && !seen.has(a.id); q = a, a = parentOf(a)) { seen.add(a.id); out.unshift({ p: a, v: q.from!.variant }) }
    return out
  }
  const kidsOf = (p: Proto, v?: string) => active().filter(k => k !== p && parentOf(k) === p && (v === undefined || k.from!.variant === v))
  // Built from the prototype as a whole, or from a variant that no longer exists.
  const looseKids = (p: Proto) => kidsOf(p).filter(k => !p.variants.some(v => v.id === k.from!.variant))
  const family = (p: Proto, depth = 1): { p: Proto; depth: number }[] =>
    [...p.variants.flatMap(v => kidsOf(p, v.id)), ...looseKids(p)].flatMap(k => [{ p: k, depth }, ...family(k, depth + 1)])
  // Nesting shows as one step in, then a small step per level, and stops at three, so a deep
  // chain doesn't squeeze its titles and asks; the branch icon carries the rest.
  const nestIndent = (depth: number) => depth ? 14 + 6 * (Math.min(depth, 3) - 1) : 0
  const treeOrder = () => active().filter(isRoot).flatMap(p => [{ p, depth: 0 }, ...family(p)])
  const editingUnder = (p: Proto): boolean => editing(p.id) || kidsOf(p).some(editingUnder)
  const nestKey = () => active().map(p => `${p.id}<${p.from?.proto ?? ''}/${p.from?.variant ?? ''}:${p.title}:${p.variants.length}:${pickOf(p)}`).join('|')
  // The variant the user chose ("go with A"); it's listed first and the rest stay reachable.
  const pickOf = (p: Proto) => p.picked && p.variants.some(v => v.id === p.picked) ? p.picked : ''
  const lobbyOrder = (p: Proto) => { const k = pickOf(p); return k ? [...p.variants.filter(v => v.id === k), ...p.variants.filter(v => v.id !== k)] : p.variants }
  const PICK = 'text-emerald-700 dark:text-emerald-400'
  const pickChip = (p: Proto, cls = '') => pickOf(p) ? `<span title="Picked ${esc(pickOf(p))} · ${esc(p.variants.find(v => v.id === pickOf(p))!.name)}" class="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 text-[11px] font-semibold ${PICK} ${cls}">${ic('check', 'size-3')}${esc(pickOf(p))}</span>` : ''
  const wide = () => matchMedia('(min-width: 1024px)').matches

  // ---------- the path, as columns ----------
  // The switcher's dropdown, the sidebar and the phone's sheet all draw these. The first column
  // is the prototypes that weren't built from anything; then each level is one prototype's
  // variants, the one on the way here lit. A variant that more than one prototype was built from
  // gets a column of those prototypes; with one, its variants come next directly. Past the place
  // shown, what was built from it comes next, so the way on is one click.
  type Col = { kind: 'protos'; list: Proto[]; sel: string; from?: Ref } | { kind: 'variants'; p: Proto; sel: string }
  function columns(): Col[] {
    const p = cur(), vid = st.place.view === 'variant' ? st.place.variant : ''
    const roots = active().filter(isRoot)
    if (!p) return [{ kind: 'protos', list: roots, sel: '' }]
    const chain = [...lineage(p), { p, v: vid }]
    const cols: Col[] = [{ kind: 'protos', list: chain[0].p.archived ? [...roots, chain[0].p] : roots, sel: chain[0].p.id }]
    chain.forEach(({ p: q, v }, i) => {
      const next = chain[i + 1], real = q.variants.some(x => x.id === v)
      cols.push({ kind: 'variants', p: q, sel: real ? v : '' })
      const kids = real ? kidsOf(q, v) : next ? looseKids(q) : []
      const from = { proto: q.id, variant: v }
      if (next) { if (kids.length > 1 || !real) cols.push({ kind: 'protos', list: kids, sel: next.p.id, from }) }
      else if (kids.length > 1) cols.push({ kind: 'protos', list: kids, sel: '', from })
      else if (kids.length === 1) cols.push({ kind: 'variants', p: kids[0], sel: '' })
    })
    return cols
  }
  const colName = (c: Col) => c.kind === 'variants' ? c.p.title : c.from ? `Built from ${c.from.variant || byId(c.from.proto)?.title || ''}` : 'Prototypes'
  const colKey = (c: Col) => c.kind === 'variants' ? `v:${c.p.id}` : `p:${c.from ? `${c.from.proto}/${c.from.variant}` : ''}`
  const colCount = (c: Col) => c.kind === 'variants' ? c.p.variants.length : c.list.length
  const ROWC = 'text-zinc-700 hover:bg-zinc-900/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]'
  const SELC = 'bg-zinc-900/[.06] font-medium text-zinc-900 dark:bg-white/[.09] dark:text-white'
  const rowCls = (big: boolean) => `flex w-full min-w-0 items-center text-left ${big ? 'h-11 gap-2.5 rounded-lg px-2.5 text-[15px]' : 'h-[30px] gap-1.5 rounded-md px-1.5'}`
  /** One variant in a column: the one shown is blue, the others on the way here are gray. */
  function vRow(q: Proto, v: Variant, sel: boolean, big = false) {
    const pl = st.place, here = pl.view === 'variant' && pl.proto === q.id && pl.variant === v.id
    const w = workOf(), kids = kidsOf(q, v.id).length > 0
    return `<button data-act="mv:${esc(q.id)}:${v.id}" aria-current="${sel}" class="${rowCls(big)} ${here ? 'bg-sky-500/15 font-medium text-sky-950 dark:text-sky-50' : sel ? SELC : ROWC}">
      <span class="w-3.5 shrink-0 text-center text-[11px] font-semibold ${sel ? '' : 'text-zinc-400'}">${v.id}</span><span dir="auto" class="min-w-0 flex-1 truncate">${esc(v.name)}</span>${v.id === pickOf(q) ? `<span title="Picked" class="shrink-0">${ic('check', `size-3 ${PICK}`)}</span>` : ''}${w?.p === q && w.v === v ? `<span title="Your requests change this one" class="shrink-0">${ic('pin', 'size-3 text-emerald-600 dark:text-emerald-400')}</span>` : ''}${openComments(q.id, v.id)}${editing(q.id, v.id) ? pulse('size-1.5') : ''}${kids ? ic('right', `size-3 shrink-0 ${sel ? 'text-sky-600 dark:text-sky-400' : 'text-zinc-400'}`) : ''}</button>`
  }
  /** One prototype in a column; choosing it opens its variants. */
  const pRow = (k: Proto, sel: boolean, big = false) => `<button data-act="mp:${esc(k.id)}" aria-current="${sel}" class="${rowCls(big)} ${sel ? SELC : k.archived ? 'text-zinc-400 hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]' : ROWC}">
      <span dir="auto" class="min-w-0 flex-1 truncate ${k.archived ? 'line-through decoration-zinc-300' : ''}">${esc(k.title)}</span>${k.kind === 'phone' ? ic('phone', 'size-3 shrink-0 text-zinc-400') : ''}${pickChip(k)}${editingUnder(k) ? pulse('size-1.5') : ''}<span class="shrink-0 text-[10px] tabular-nums text-zinc-400">${k.variants.length}</span>${ic('right', 'size-3 shrink-0 text-zinc-400')}</button>`
  function colRows(c: Col, big = false) {
    const none = (t: string) => `<p class="px-2 py-1.5 text-[11px] text-zinc-400">${t}</p>`
    if (c.kind === 'variants') return c.p.variants.map(v => vRow(c.p, v, c.sel === v.id, big)).join('') || none('No variants yet')
    const rows = c.list.map(k => pRow(k, c.sel === k.id, big)).join('') || none('None yet')
    // Archived prototypes fold under the first column.
    const gone = c.from ? [] : archived().filter(k => !c.list.includes(k))
    return rows + (gone.length ? `<button data-act="archived" aria-expanded="${st.archived}" class="${rowCls(big)} text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">${ic(st.archived ? 'chev' : 'right', 'size-3')}Archived<span class="ml-auto tabular-nums">${gone.length}</span></button>${st.archived ? gone.map(k => pRow(k, false, big)).join('') : ''}` : '')
  }
  /** A column's head: a prototype's opens its overview, the first column's the session's. */
  const colHead = (c: Col) => {
    const act = c.kind === 'variants' ? `lobby:proto:${esc(c.p.id)}` : c.from ? '' : 'lobby:session'
    const title = c.kind === 'variants' ? `All ${c.p.variants.length} variants of ${esc(c.p.title)}` : c.from ? '' : 'Overview of the session'
    const inner = `<span dir="auto" class="truncate">${esc(colName(c))}</span>${act ? ic('grid', 'size-3 shrink-0 opacity-0 group-hover/h:opacity-100') : ''}<span class="ml-auto shrink-0 tabular-nums">${colCount(c)}</span>`
    const cls = 'group/h flex h-7 w-full min-w-0 shrink-0 items-center gap-1 px-2.5 text-left text-[10px] font-medium text-zinc-400'
    return act ? `<button data-act="${act}" title="${title}" class="${cls} hover:text-zinc-900 dark:hover:text-white">${inner}</button>` : `<div class="${cls}">${inner}</div>`
  }

  // ---------- skeleton ----------
  root.innerHTML = `<div class="flex h-dvh bg-white text-[13px] text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    <aside data-side></aside>
    <div data-grip role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabindex="0" title="Drag to resize · double-click to reset" class="group relative z-40 -mx-1 hidden w-2 shrink-0 cursor-col-resize touch-none outline-none">
      <span class="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-sky-500/50 group-focus-visible:bg-sky-500 group-data-[dragging]:bg-sky-500"></span>
    </div>
    <div class="flex min-w-0 flex-1 flex-col">
      <header data-bar class="relative z-30 flex h-12 shrink-0 items-center gap-1 border-b border-black/[.07] px-2 dark:border-white/10"></header>
      <div data-zone>
        <div data-layers class="absolute inset-0 overflow-hidden" style="right:var(--hw,0px);bottom:var(--pill-h,0px)"></div>
        <div data-spot class="pointer-events-none absolute inset-0 z-[15] overflow-hidden" style="right:var(--hw,0px);bottom:var(--pill-h,0px)"></div>
        <div data-comments class="pointer-events-none absolute inset-0 z-[16]" style="right:var(--hw,0px);bottom:var(--pill-h,0px)"></div>
        <div data-overlay></div>
        <div data-pill></div>
        <div data-scale-card></div>
        <aside data-hints></aside>
      </div>
    </div>
    <div data-drawer></div>
    <div data-sheet></div>
    <div data-menu-sheet></div>
    <div data-comments-sheet></div>
  </div>`
  const side = root.querySelector<HTMLElement>('[data-side]')!
  const grip = root.querySelector<HTMLElement>('[data-grip]')!
  const drawer = root.querySelector<HTMLElement>('[data-drawer]')!
  const bar = root.querySelector<HTMLElement>('[data-bar]')!
  const zone = root.querySelector<HTMLElement>('[data-zone]')!
  const layers = root.querySelector<HTMLElement>('[data-layers]')!
  const overlay = root.querySelector<HTMLElement>('[data-overlay]')!
  const hintBox = root.querySelector<HTMLElement>('[data-hints]')!
  const pill = root.querySelector<HTMLElement>('[data-pill]')!
  const paintSheet = createSheet(root.querySelector<HTMLElement>('[data-sheet]')!)
  const paintMenu = createMenuSheet(root.querySelector<HTMLElement>('[data-menu-sheet]')!)
  const cardHost = root.querySelector<HTMLElement>('[data-scale-card]')!

  // ---------- layers ----------
  let layer: Layer | null = null

  const refsFor = (p: Place): unknown[] => {
    if (p.view === 'session') return [nestKey(), ...lobbyRoots().flatMap(q => [q.id, q.title, ...lobbyOrder(q).slice(0, 1).flatMap(v => [v.file, v.name])])]
    const proto = byId(p.proto)!
    if (p.view === 'proto') return [st.stack, nestKey(), proto.title, proto.kind, ...lobbyOrder(proto).flatMap(v => [v.id, v.name, v.file])]
    const v = proto.variants.find(v => v.id === p.variant)!
    return [proto.kind, v.file, p.state, p.tool, p.tool === 'compare' ? otherOf(proto, v.id) : '', JSON.stringify(proto.states), ...(p.tool === 'compare' ? proto.variants.map(x => x.file) : [])]
  }
  // What a variant is compared with: the one chosen, else the reference (else the next one).
  const otherOf = (p: Proto, v: string) => {
    const want = st.vs.get(p.id)
    if (want && want !== v && p.variants.some(x => x.id === want)) return want
    const ref = refOf(p)
    return ref !== v ? ref : p.variants.find(x => x.id !== v)?.id ?? v
  }

  // ---------- loading designs ----------
  // A variant's module loads the first time it is shown and is kept by file, so a session
  // with hundreds of variants (picked, archived, never opened) only pays for what is on
  // screen. A module that fails to load shows its error in place and is retried after edits.
  const loaded = new Map<string, unknown>()
  const loading = new Map<string, Promise<unknown>>()
  const failed = new Set<string>()
  // The browser keeps a failed import for good, so after an edit a broken file is fetched again
  // under a fresh URL.
  const retry = new Map<string, number>()
  function load(v: Variant) {
    if (loaded.has(v.file)) return Promise.resolve(loaded.get(v.file))
    const t = retry.get(v.file)
    const get = t ? () => import(/* @vite-ignore */ `${v.file}?t=${t}`).then(m => m.default) : v.load
    if (!loading.has(v.file)) loading.set(v.file, get().then(
      c => { loaded.set(v.file, c); loading.delete(v.file); failed.delete(v.file); return c },
      e => { loading.delete(v.file); failed.add(v.file); throw e }))
    return loading.get(v.file)!
  }
  // Every hot update leaves its old module in the browser's module map for good. After many,
  // the page reloads itself while its tab is hidden, which frees them; it comes back where it was.
  let updates = 0
  const reloadIfStale = () => { if (updates > 300 && document.visibilityState === 'hidden') location.reload() }
  document.addEventListener('visibilitychange', reloadIfStale)

  // The 10px bezel sits outside the screen, so the frame is the screen plus 20 each way.
  const scaleLabel = () => (st.scale ? `${st.scale}%` : 'Fit')
  const phoneSize = (proto: Proto) => `width:${proto.screen[0] + 20}px;height:${proto.screen[1] + 20}px`
  // A phone's card holds the phone itself, so the phone scale can size it (see fit).
  const thumb = (proto: Proto, aspect: string) => proto.kind === 'phone'
    ? `<div data-thumb data-pthumb class="relative flex w-full items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-900 ${aspect}"><div inert class="pointer-events-none ${PHONE} [contain:layout_paint]" style="${phoneSize(proto)}"><div data-mount class="h-full overflow-hidden"></div></div></div>`
    : `<div data-thumb class="relative w-full overflow-hidden bg-white dark:bg-zinc-950 ${aspect}"><div inert class="pointer-events-none overflow-hidden [contain:layout_paint]" style="width:1200px;height:750px"><div data-mount class="h-full"></div></div></div>`

  const frameOf = (proto: Proto) => proto.kind === 'phone'
    ? `<div data-phones class="flex min-h-full items-center justify-center p-6"><div data-phone class="${PHONE} [contain:layout_paint]" style="${phoneSize(proto)}"><div data-mount class="h-full overflow-y-auto"></div></div></div>`
    : '<div data-mount class="h-full"></div>'

  function buildLayer(p: Place): Layer {
    // The outer box doesn't scroll and is the containing block for the design's own
    // position:fixed (drawers, sheets, toasts), so they stay on the stage, pinned, instead
    // of covering the shell. The inner box scrolls.
    const el = document.createElement('div')
    el.className = 'absolute inset-0 [contain:layout_paint]'
    // Each host runs its design while it is mounted; lobbies mount a host only while it is on or
    // near the screen, so a long grid or the full-size list costs what is visible, not all of it.
    const live = new Map<HTMLElement, () => void>()
    let gone = false
    const pending: Promise<unknown>[] = []
    // A state that can't be reached says so where it would have been, instead of quietly
    // showing the design at rest.
    const missed = (host: HTMLElement, s: State, sel: string) => {
      console.warn(`[prototype] can't open "${s.name}": nothing matches ${sel}`)
      const box = host.closest<HTMLElement>('[data-chipbox]') ?? el
      box.insertAdjacentHTML('beforeend', `<div data-missed class="pointer-events-none absolute left-3 top-3 z-20 max-w-[calc(100%-1.5rem)] rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow ring-1 ring-amber-500/30 dark:bg-amber-950 dark:text-amber-100">Couldn’t open <b>${bd(s.name)}</b>: nothing matches <code>${esc(sel)}</code></div>`)
    }
    const start = (host: HTMLElement, v: Variant, s?: State): Promise<unknown> => {
      if (live.has(host)) return Promise.resolve()
      live.set(host, () => {})
      const here = () => !gone && live.has(host)
      return load(v).then(
        c => {
          if (!here()) return
          live.set(host, mount(host, c))
          if (s?.click.length) return replay(host, s.click, here).then(miss => { if (miss && here()) missed(host, s, miss) })
        },
        e => { if (here()) host.innerHTML = `<pre class="m-4 whitespace-pre-wrap rounded-lg bg-rose-50 p-4 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-200">${esc(e?.stack || e)}</pre>` })
    }
    const stop = (host: HTMLElement) => {
      const off = live.get(host)
      if (!off) return
      live.delete(host)
      try { off() } catch { /* already gone */ }
      host.replaceChildren()
    }
    let io: IntersectionObserver | null = null
    type Show = { v: Variant; s?: State }
    const mountAll = (list: Show[], lazy: boolean) => {
      const hosts = [...el.querySelectorAll<HTMLElement>('[data-mount]')]
      const of = new Map(hosts.map((h, i) => [h, list[i]]))
      if (!lazy) return hosts.forEach(h => pending.push(start(h, of.get(h)!.v, of.get(h)!.s)))
      io = new IntersectionObserver(entries => {
        for (const e of entries) { const h = e.target as HTMLElement, x = of.get(h)!; e.isIntersecting ? start(h, x.v, x.s) : stop(h) }
      }, { root: el.firstElementChild, rootMargin: '600px 0px' })
      hosts.forEach(h => io!.observe(h))
    }
    let player: Layer['player']
    let quit = () => {}
    if (p.view === 'variant') {
      const proto = byId(p.proto)!, v = proto.variants.find(x => x.id === p.variant)!, s = stateOf(proto, v.id, p.state)
      if (p.tool === 'all') {
        el.innerHTML = `<div class="h-full overflow-auto">${allStates(proto, v)}</div>`
        mountAll([{ v }, ...statesOf(proto, v.id).map(s => ({ v, s }))], true)
      } else if (p.tool === 'compare') {
        const o = proto.variants.find(x => x.id === otherOf(proto, v.id))!
        const pair = [o, v].sort((a, b) => proto.variants.indexOf(a) - proto.variants.indexOf(b))
        el.innerHTML = compareView(proto, v, o, s, pair)
        mountAll(pair.map(x => ({ v: x, s: stateOf(proto, x.id, p.state) })), false)
      } else if (p.tool === 'play') {
        el.innerHTML = playView(proto, v)
        ;({ player, quit } = autoplay(proto, v))
      } else {
        el.innerHTML = `<div class="h-full overflow-auto">${frameOf(proto)}</div>`
        mountAll([{ v, s }], false)
      }
    } else {
      el.innerHTML = `<div class="h-full overflow-auto">${p.view === 'proto' ? protoLobby(byId(p.proto)!) : sessionLobby()}</div>`
      if (p.view === 'proto') mountAll(lobbyOrder(byId(p.proto)!).map(v => ({ v })), true)
      else mountAll(lobbyRoots().flatMap(q => lobbyOrder(q).slice(0, 1)).map(v => ({ v })), true)
    }

    // ---------- autoplay: a cursor clicks through each state while a timeline fills ----------
    function autoplay(proto: Proto, v: Variant) {
      const MOVE = 800, HOLD = 2200
      const list = statesOf(proto, v.id)
      const host = el.querySelector<HTMLElement>('[data-mount]')!, box = el.querySelector<HTMLElement>('[data-play-box]')!
      const cursor = el.querySelector<HTMLElement>('[data-cursor]')!
      let at = 0, playing = false, done = false, run = 0, fill: Animation | null = null
      const paint = () => {
        const s = list[at]
        el.querySelector('[data-play-label]')!.innerHTML = `${at + 1}/${list.length} · ${bd(s.name)}`
        el.querySelector('[data-play-note]')!.textContent = s.about?.[v.id] ?? ''
        el.querySelector('[data-play-btn]')!.innerHTML = `${ic(playing ? 'pause' : done ? 'replay' : 'play', 'size-4')}${playing ? '' : `<span>${done ? 'Again' : 'Play'}</span>`}`
        el.querySelector('[data-play-btn]')!.setAttribute('aria-label', playing ? 'Pause' : 'Play')
        el.querySelectorAll<HTMLElement>('[data-seg]').forEach((b, i) => { if (i !== at || !playing) b.style.width = i < at || done || (i === at && !playing) ? '100%' : '0%' })
        if (st.playing !== s.id) { st.playing = s.id; render() }
      }
      const point = (x: number, y: number) => { cursor.hidden = false; cursor.style.transform = `translate(${x}px, ${y}px)` }
      // One state: start the design fresh, then click through to the state, the cursor leading.
      async function reach(i: number, glide: boolean, my: number) {
        at = i
        paint()
        stop(host)
        await start(host, v)
        if (my !== run || gone) return
        const s = list[i]
        const miss = await replay(host, s.click, () => my === run && !gone, glide ? async target => {
          const b = target.getBoundingClientRect(), o = box.getBoundingClientRect()
          point(b.left - o.left + Math.min(b.width / 2, 48), b.top - o.top + b.height / 2)
          await wait(MOVE)
          cursor.querySelector('[data-ripple]')?.animate([{ transform: 'scale(.4)', opacity: .8 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 450, easing: 'ease-out' })
        } : undefined)
        if (miss && my === run) missed(host, s, miss)
      }
      async function loop(my: number) {
        for (let i = at; i < list.length; i++) {
          fill?.cancel()
          fill = el.querySelector<HTMLElement>(`[data-seg="${i}"]`)!.animate([{ width: '0%' }, { width: '100%' }], { duration: MOVE * list[i].click.length + HOLD + 400, fill: 'forwards' })
          await reach(i, true, my)
          if (my !== run || gone) return
          await wait(HOLD)
          if (my !== run || gone) return
        }
        playing = false; done = true; paint()
      }
      const play = () => { if (done) { done = false; at = 0 } run++; playing = true; paint(); loop(run) }
      const pause = () => { run++; playing = false; fill?.pause(); paint() }
      box.addEventListener('pointerdown', e => { if (e.isTrusted && playing) pause() }, true)
      pending.push(start(host, v))
      cursor.style.transition = 'none'
      cursor.style.transform = `translate(${box.clientWidth * 0.6}px, ${box.clientHeight * 0.75}px)`
      requestAnimationFrame(() => { cursor.style.transition = '' })
      const first = setTimeout(play, 700)
      paint()
      return {
        player: { toggle: () => (playing ? pause() : play()), jump: (i: number) => { run++; playing = false; done = false; fill?.cancel(); reach(i, false, run).then(paint) } },
        quit: () => { clearTimeout(first); run++; st.playing = '' },
      }
    }

    const ready = Promise.all(pending)
    return { el, refs: refsFor(p), ready, player, dispose: () => { gone = true; quit(); io?.disconnect(); [...live.keys()].forEach(stop) } }
  }

  // ---------- the tools' views ----------
  const dot = (proto: Proto, v: string, s?: State, on = false) => `<span class="mt-[5px] size-1.5 shrink-0 rounded-full ${s && changed(proto, v, s) ? 'bg-amber-500' : on ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-300 dark:bg-zinc-600'}"></span>`
  const noteCls = (proto: Proto, v: string, s: State) => changed(proto, v, s) ? 'text-amber-700/85 dark:text-amber-300/70' : 'text-zinc-500'
  const closeTool = (proto: Proto, v: Variant, t: Tool, label: string) => `<button data-act="tool:${esc(proto.id)}:${v.id}:${t}" aria-label="${label}" title="${label} · Esc" class="${IB} shrink-0">${ic('x')}</button>`

  function allStates(proto: Proto, v: Variant) {
    const card = (s?: State) => {
      const note = s?.about?.[v.id]
      return `<div data-chipbox class="relative min-w-0"><button data-act="pvs:${esc(proto.id)}:${v.id}:${esc(s?.id ?? '')}" class="group block w-full min-w-0 text-left">
        <div class="overflow-hidden rounded-lg ring-1 ring-black/10 transition group-hover:ring-2 group-hover:ring-zinc-900 dark:ring-white/10 dark:group-hover:ring-white">${thumb(proto, 'aspect-[16/10]')}</div>
        <div class="mt-2 flex items-start gap-2">${s ? dot(proto, v.id, s) : dot(proto, v.id)}<div class="min-w-0"><div dir="auto" class="font-semibold">${esc(s?.name ?? 'At rest')}</div>${note && s ? `<p dir="auto" class="mt-0.5 text-xs ${noteCls(proto, v.id, s)}">${esc(note)}</p>` : ''}</div></div></button></div>`
    }
    return `<div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-5 sm:px-6"><h2 class="text-xl font-semibold tracking-tight">Every state of ${v.id} <span class="font-normal text-zinc-500">· ${bd(v.name)}</span></h2><p class="text-xs text-zinc-500">Click one to try it live</p><span class="ml-auto">${closeTool(proto, v, 'all', 'Close all states')}</span></div>
      <div class="${GRID} p-4 sm:p-6">${[undefined, ...statesOf(proto, v.id)].map(card).join('')}</div>`
  }

  function compareView(proto: Proto, v: Variant, o: Variant, s: State | undefined, pair: Variant[]) {
    const ref = refOf(proto)
    // The note shown is the one that says what changed: the non-reference side's.
    const side = v.id !== ref ? v : o
    const line = s ? (s.about?.[side.id] && side.id !== ref ? s.about[side.id] : '') : proto.about[side.id] ?? ''
    const others = proto.variants.filter(x => x.id !== v.id)
    const diffs = statesOf(proto, v.id).filter(x => changed(proto, v.id, x) || changed(proto, o.id, x))
    const pane = (x: Variant) => `<div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="flex h-9 shrink-0 items-center gap-2 border-b border-black/[.07] px-3 text-xs dark:border-white/10"><b>${x.id}</b><span dir="auto" class="truncate text-zinc-500">${esc(x.name)}</span>${x.id === v.id ? '' : `<button data-act="pvs:${esc(proto.id)}:${x.id}:${esc(s?.id ?? '')}" class="ml-auto shrink-0 rounded-md px-1.5 py-1 text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white">Open ${x.id}</button>`}</div>
        <div data-fit data-chipbox ${x.id !== ref ? 'data-compare' : ''} class="relative min-h-0 flex-1 [contain:layout_paint]"><div class="absolute inset-0 overflow-auto">${frameOf(proto)}</div></div></div>`
    return `<div class="flex h-full flex-col">
      <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-500/30 bg-amber-50 px-3 py-2 text-xs dark:bg-amber-500/10">
        <span class="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">${v.id} against${others.length > 1 ? `<span class="flex gap-0.5 rounded-md bg-amber-500/10 p-0.5">${others.map(x => `<button data-act="vs:${x.id}" aria-pressed="${x.id === o.id}" class="h-6 min-w-6 rounded px-1.5 ${x.id === o.id ? 'bg-white text-amber-900 shadow-sm dark:bg-amber-200 dark:text-amber-950' : 'text-amber-800 hover:bg-amber-500/15 dark:text-amber-200'}">${x.id}</button>`).join('')}</span>` : ` ${o.id}`}</span>
        <span class="min-w-0 flex-1 text-amber-900/80 dark:text-amber-200/80"><b class="font-medium">${bd(s?.name ?? 'At rest')}</b>${line ? ` · ${bd(line)}` : ''}</span>
        ${diffs.length ? `<button data-act="nextdiff" class="flex h-8 items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 font-medium text-amber-900 hover:bg-amber-500/25 dark:text-amber-200">Next difference${ic('right', 'size-3.5')}</button>` : ''}
        ${closeTool(proto, v, 'compare', 'Stop comparing')}
      </div>
      <div class="flex min-h-0 flex-1 flex-col divide-y divide-black/[.07] md:flex-row md:divide-x md:divide-y-0 dark:divide-white/10">${pair.map(pane).join('')}</div></div>`
  }

  function playView(proto: Proto, v: Variant) {
    const list = statesOf(proto, v.id)
    return `<div class="flex h-full flex-col">
      <div data-play-box class="relative min-h-0 flex-1">
        <div data-fit data-chipbox class="absolute inset-0 overflow-auto [contain:layout_paint]">${frameOf(proto)}</div>
        <div data-cursor hidden class="pointer-events-none absolute left-0 top-0 z-30 transition-transform duration-700 ease-in-out" style="transform:translate(60%,70%)"><span data-ripple class="absolute -left-4 -top-4 size-8 rounded-full bg-sky-400/50 opacity-0"></span><svg width="22" height="22" viewBox="0 0 24 24" class="drop-shadow-md"><path d="M4 2l16 9-7 2-3 7z" fill="#18181b" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg></div>
      </div>
      <div class="flex shrink-0 items-center gap-3 border-t border-black/[.07] bg-white px-3 py-2 dark:border-white/10 dark:bg-zinc-950">
        <button data-act="play:toggle" data-play-btn class="flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-zinc-900 px-3.5 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"></button>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 text-xs"><span data-play-label class="shrink-0 font-semibold"></span><span data-play-note dir="auto" class="truncate text-zinc-500"></span></div>
          <div class="mt-1 flex gap-1">${list.map((s, i) => `<button data-act="play:jump:${i}" title="${esc(s.name)}" aria-label="${esc(s.name)}" class="group flex-1 py-1.5"><span class="block h-1.5 overflow-hidden rounded-full bg-zinc-200 group-hover:bg-zinc-300 dark:bg-zinc-800 dark:group-hover:bg-zinc-700"><span data-seg="${i}" class="block h-full w-0 rounded-full ${changed(proto, v.id, s) ? 'bg-amber-500' : 'bg-sky-500'}"></span></span></button>`).join('')}</div>
        </div>
        ${closeTool(proto, v, 'play', 'Stop autoplay')}
      </div></div>`
  }

  function show(fade: boolean) {
    const next = buildLayer(st.place)
    const prev = layer
    layer = next
    layers.prepend(next.el)
    fit()
    if (!prev) return
    // The new design reaches its state under the old one, which then fades out on top.
    prev.el.inert = true
    const drop = () => { prev.el.remove(); prev.dispose() }
    Promise.race([next.ready, wait(1500)]).then(() => (fade ? fadeOut(prev.el, drop) : drop()))
  }

  function fit() {
    // At Fit a phone card stays 16:10 with the phone as it would sit in a 1200px-wide frame. At a
    // set scale the card grows to the phone at that size, kept within the card's width.
    const scale = st.place.view === 'session' ? 0 : st.scale
    for (const t of layers.querySelectorAll<HTMLElement>('[data-thumb]')) {
      if (!t.clientWidth) continue
      const inner = t.firstElementChild as HTMLElement
      if (!t.hasAttribute('data-pthumb')) { inner.style.zoom = String(t.clientWidth / 1200); continue }
      t.style.aspectRatio = scale ? 'auto' : ''
      t.style.paddingBlock = scale ? '20px' : ''
      inner.style.zoom = String(scale ? Math.min(scale / 100, (t.clientWidth - 24) / parseFloat(inner.style.width)) : .78 * t.clientWidth / 1200)
    }
    if (layer) fitBox(layer.el)
  }
  function fitBox(box: HTMLElement) {
    box.style.setProperty('--stage-h', `${box.clientHeight}px`)
    for (const phone of box.querySelectorAll<HTMLElement>('[data-phone]')) {
      const room = phone.closest<HTMLElement>('[data-fit]') ?? box
      const w = parseFloat(phone.style.width), h = parseFloat(phone.style.height)
      const auto = [100, 75, 50].find(s => h * s / 100 <= room.clientHeight - 48 && w * s / 100 <= room.clientWidth - 24) ?? 40
      phone.style.zoom = String((st.scale || auto) / 100)
    }
  }
  new ResizeObserver(fit).observe(zone)

  // ---------- navigation ----------
  function go(p: Place) {
    if (!valid(p)) p = defaultPlace()
    if (location.hash !== hashOf(p)) location.hash = hashOf(p)
    else arrive(p, true)
  }
  // Choosing a variant something was built from, or a prototype, inside the switcher's columns
  // (or the phone's sheet) keeps them open on what comes next.
  let keepOpen = false, recenter = true
  function arrive(p: Place, fade: boolean) {
    recenter = true
    const moved = JSON.stringify(p) !== JSON.stringify(st.place) || !layer
    st.place = p
    if (!keepOpen) { st.open = null; st.menu = ''; st.drawer = false }
    keepOpen = false
    st.pairAt = null
    st.drill = null
    st.sheet = false
    closeCard(true)
    if (p.view !== 'variant') st.focus = false
    localStorage.setItem(`proto-place-${session.id}`, hashOf(p))
    if (moved) show(fade && !!layer)
    render()
    if (moved) side.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }
  addEventListener('hashchange', () => {
    const p = parseHash() ?? defaultPlace()
    if (location.hash !== hashOf(p)) history.replaceState(null, '', hashOf(p))
    arrive(p, true)
  })

  function step(d: number) {
    const proto = cur()
    if (!proto || !proto.variants.length) return
    const ids = visible(proto).map(v => v.id)
    const i = st.place.view === 'variant' ? ids.indexOf(st.place.variant) : -1
    go(keepIn(proto, ids[(i + d + ids.length) % ids.length]))
  }
  const openProto = (id: string) => {
    const proto = byId(id)!
    const w = workOf()
    const v = w?.p === proto ? w.v.id : editing(id) ? st.editing!.variant : proto.variants[0]?.id
    go(v ? { view: 'variant', proto: id, variant: v } : { view: 'proto', proto: id })
  }

  // ---------- lobbies ----------
  function lifecycle() {
    const s = st.status
    if (st.stopped) return 'Server stopped. Ask Claude to start it again.'
    if (!s) return ''
    const until = new Date(s.lastEdit + s.deleteDays * 864e5).toLocaleDateString([], { month: 'short', day: 'numeric' })
    return `Idle stop ${s.idleHours}h · ${s.keep ? 'Kept' : `Deletes ${until}`}`
  }

  const newestFirst = () => active().slice().reverse()
  // The session lobby has a card per top-level prototype; what was built from it is listed in it.
  const lobbyRoots = () => newestFirst().filter(isRoot)
  const GRID = 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4'
  const NEST = 'bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300'
  const fromChip = (p: Proto) => {
    const a = parentOf(p)
    if (!a) return ''
    const v = p.from!.variant
    return `<button data-act="${v && a.variants.some(x => x.id === v) ? `pv:${esc(a.id)}:${esc(v)}` : `lobby:proto:${esc(a.id)}`}" class="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${NEST}">${ic('from', 'size-3.5')}<span class="truncate">Built from ${esc(a.title)}${v ? ` · ${esc(v)}` : ''}</span></button>`
  }
  const kidChips = (p: Proto, v: string) => kidsOf(p, v).map(k => `<button data-act="lobby:proto:${esc(k.id)}" class="mt-1.5 flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-xs font-medium ${NEST}">${ic('branch', 'size-3.5')}<span class="truncate">${esc(k.title)}</span><span class="ml-auto tabular-nums opacity-70">${k.variants.length}</span></button>`).join('')

  function sessionLobby() {
    const list = lobbyRoots()
    if (!list.length) return `<div class="grid min-h-full place-items-center p-8 text-center"><div><div class="mx-auto mb-4 grid size-10 place-items-center">${pulse('size-2.5', st.live)}</div><h2 dir="auto" class="text-base font-semibold">${esc(session.name)}</h2><p class="mt-1 text-zinc-500">Waiting for the first prototype. This page updates by itself.</p></div></div>`
    const all = active().length
    const nested = all - list.length
    return `<div class="p-4 sm:p-6"><div class="mb-5 flex flex-wrap items-end justify-between gap-2"><div><h2 dir="auto" class="text-xl font-semibold tracking-tight">${esc(session.name)}</h2><p class="text-xs text-zinc-500">${all} prototype${all === 1 ? '' : 's'}${nested ? `, ${nested} built from others` : ''} · started ${clock(session.createdAt)}</p></div><p data-lifecycle class="text-xs text-zinc-400">${esc(lifecycle())}</p></div>
      <div class="${GRID}">${list.map(p => `<div class="min-w-0 rounded-xl p-2 ring-1 ring-black/[.07] has-[[data-card]:hover]:bg-zinc-50 has-[[data-card]:hover]:ring-black/20 dark:ring-white/10 dark:has-[[data-card]:hover]:bg-white/5"><button data-card data-act="lobby:proto:${esc(p.id)}" class="block w-full min-w-0 text-left">
        ${p.variants.length ? `<div class="overflow-hidden rounded-md ring-1 ring-black/5 dark:ring-white/10">${thumb(p, 'aspect-[16/10]')}</div>` : '<div class="aspect-[16/10] rounded-md bg-zinc-900/[.03] dark:bg-white/[.04]"></div>'}
        <div class="mt-3 flex items-center gap-2 px-1"><span dir="auto" class="truncate font-semibold">${esc(p.title)}</span>${editing(p.id) ? pulse('size-1.5') : ''}<span class="ml-auto shrink-0 text-xs text-zinc-400">${p.variants.length} variant${p.variants.length === 1 ? '' : 's'} · ${pickOf(p) ? `<span class="inline-flex items-center gap-0.5 align-top font-medium ${PICK}">${ic('check', 'size-3')}Picked ${esc(pickOf(p))}</span>` : clock(p.created)}</span></div>
        <div dir="auto" class="truncate px-1 pb-1 text-xs text-zinc-500">${p.ask ? `“${esc(p.ask)}”` : ''}</div></button>
        ${family(p).map(({ p: k, depth }) => `<button data-act="lobby:proto:${esc(k.id)}" class="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg pr-1 text-left text-xs text-zinc-600 hover:bg-zinc-900/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]" style="padding-left:${4 + nestIndent(depth) - nestIndent(1)}px">${ic('branch', 'size-3.5 text-sky-500')}<span dir="auto" class="truncate">${esc(k.title)}</span>${pickChip(k)}${editingUnder(k) ? pulse('size-1.5') : ''}${k.from!.variant ? `<span class="shrink-0 text-zinc-400">from ${esc(k.from!.variant)}</span>` : ''}<span class="ml-auto shrink-0 tabular-nums text-zinc-400">${k.variants.length}</span></button>`).join('')}</div>`).join('')}</div></div>`
  }

  function protoLobby(p: Proto) {
    const grid = protoGrid(p)
    const tab = (on: boolean, act: string, icon: string, label: string) => `<button data-act="${act}" aria-pressed="${on}" title="${label}" class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs ${on ? TAB_ON : TAB_OFF}">${ic(icon, 'size-3.5')}<span class="hidden sm:inline">${label}</span></button>`
    const layoutToggle = `<div class="flex gap-0.5 rounded-lg bg-zinc-900/[.04] p-0.5 dark:bg-white/[.06]">${tab(!st.stack, 'stack:0', 'grid', 'Grid')}${tab(st.stack, 'stack:1', 'rows', 'Full size')}</div>`
    return `<div class="flex flex-wrap items-end justify-between gap-2 px-4 pt-5 sm:px-6"><div class="min-w-0">${parentOf(p) ? `<div class="mb-2">${fromChip(p)}</div>` : ''}<h2 class="flex items-center gap-2 text-xl font-semibold tracking-tight">${bd(p.title)}${pickOf(p) ? `<span class="inline-flex h-6 items-center gap-1 rounded-full bg-emerald-500/10 px-2 text-xs font-semibold tracking-normal ${PICK}">${ic('check', 'size-3.5')}Picked ${esc(pickOf(p))}</span>` : ''}</h2><p class="text-xs text-zinc-500">${p.ask ? `<bdi>“${esc(p.ask)}”</bdi> · ` : ''}${p.variants.length} variant${p.variants.length === 1 ? '' : 's'} · ${clock(p.created)}</p></div>${p.variants.length ? layoutToggle : '<p class="text-xs text-zinc-400">No variants yet</p>'}</div>
      ${st.stack ? stack(p) : grid}`
  }

  function protoGrid(p: Proto) {
    // Once a variant is picked, the others fade back until hovered.
    const k = pickOf(p)
    return `<div class="${GRID} p-4 sm:p-6">${lobbyOrder(p).map(v => `<div class="min-w-0 ${k && v.id !== k ? 'opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100' : ''}"><button data-act="pv:${esc(p.id)}:${v.id}" class="group block w-full min-w-0 text-left">
        <div class="overflow-hidden rounded-lg transition ${v.id === k ? 'ring-2 ring-emerald-500' : 'ring-1 ring-black/10 group-hover:ring-2 group-hover:ring-zinc-900 dark:ring-white/10 dark:group-hover:ring-white'}">${thumb(p, 'aspect-[16/10]')}</div>
        <div class="mt-2 flex items-center gap-2"><span class="font-semibold">${v.id}</span><span class="truncate text-zinc-500">${esc(v.name)}</span>${v.id === k ? `<span class="inline-flex shrink-0 items-center gap-1 text-xs font-medium ${PICK}">${ic('check', 'size-3.5')}Picked</span>` : ''}${editing(p.id, v.id) ? `<span class="ml-auto inline-flex items-center gap-1.5 text-xs text-emerald-600">${pulse('size-1.5')}editing</span>` : ''}</div></button>${kidChips(p, v.id)}</div>`).join('')}</div>`
  }

  // Every variant at full size, one after another, live. Each frame is at least as tall as the
  // stage (a grid, so a root with h-full fills it) and contains its own position:fixed.
  function stack(p: Proto) {
    const head = (v: Variant) => `<div class="mb-3 flex h-8 min-w-0 items-center gap-2 ${p.kind === 'phone' ? 'justify-center' : ''}"><button data-act="pv:${esc(p.id)}:${v.id}" title="Open ${v.id}" class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md hover:underline hover:decoration-zinc-400 hover:underline-offset-4"><span class="font-semibold">${v.id}</span><span dir="auto" class="truncate text-zinc-500">${esc(v.name)}</span></button>${v.id === pickOf(p) ? `<span class="inline-flex shrink-0 items-center gap-1 text-xs font-medium ${PICK}">${ic('check', 'size-3.5')}Picked</span>` : ''}${editing(p.id, v.id) ? pulse('size-1.5') : ''}${kidsOf(p, v.id).map(k => `<button data-act="lobby:proto:${esc(k.id)}" class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${NEST}">${ic('branch', 'size-3.5')}${bd(k.title)}</button>`).join('')}</div>`
    if (p.kind === 'phone') return `<div class="flex flex-wrap justify-center gap-x-10 gap-y-8 p-4 sm:p-6">${lobbyOrder(p).map(v => `<section data-stack-item class="min-w-0">${head(v)}<div data-phone class="${PHONE} [contain:layout_paint]" style="${phoneSize(p)}"><div data-mount class="h-full overflow-y-auto"></div></div></section>`).join('')}</div>`
    return `<div class="space-y-8 py-4 sm:py-6">${lobbyOrder(p).map(v => `<section data-stack-item><div class="px-4 sm:px-6">${head(v)}</div><div class="grid min-h-[var(--stage-h)] border-y border-black/[.07] bg-white [contain:layout_paint] dark:border-white/10 dark:bg-zinc-950"><div data-mount class="min-w-0"></div></div></section>`).join('')}</div>`
  }

  // ---------- chrome ----------
  function render() {
    // Scrolled lists in the chrome keep their place when it is redrawn (a status ping, an edit).
    const keepScroll = (host: HTMLElement, html: string) => {
      const was = new Map([...host.querySelectorAll<HTMLElement>('[data-k]')].map(el => [el.dataset.k!, [el.scrollTop, el.scrollLeft]]))
      host.innerHTML = html
      for (const el of host.querySelectorAll<HTMLElement>('[data-k]')) { const at = was.get(el.dataset.k!); if (at) [el.scrollTop, el.scrollLeft] = at }
    }
    const p = cur()
    const view = st.place.view
    const vid = st.place.view === 'variant' ? st.place.variant : ''
    const vs = p ? visible(p) : []
    const many = vs.length > 7
    const at = Math.max(0, vs.findIndex(v => v.id === vid))
    const from = many ? Math.min(Math.max(0, at - 2), vs.length - 5) : 0
    const shown = many ? vs.slice(from, from + 5) : vs
    const phones = p?.kind === 'phone' && view !== 'session'
    const scaleStep = (d: number, icon: string, label: string) => `<button data-act="scalestep:${d}" aria-label="${label}" title="${label}" class="grid size-10 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white">${ic(icon)}</button>`
    const scaleMenu = `<div class="space-y-1.5 p-2"><div class="flex gap-0.5 rounded-lg bg-zinc-900/[.04] p-0.5 dark:bg-white/[.06]">${SCALES.map(s => `<button data-act="scale:${s}" data-scale-seg="${s}" aria-pressed="${st.scale === s}" class="${segCls(st.scale === s)}">${s ? s + '%' : 'Fit'}</button>`).join('')}</div>
      <div class="flex items-center">${scaleStep(-5, 'minus', 'Smaller')}<input data-scale-range type="range" min="${SCALE_MIN}" max="${SCALE_MAX}" step="1" value="${st.scale || 50}" aria-label="Phone scale" class="${RANGE} ${st.scale ? '' : 'opacity-40'}" style="--p:${rangeAt(st.scale || 50)}%">${scaleStep(5, 'plus', 'Bigger')}</div></div>`

    const row = (lead: string, body: string, end = '') => `<div class="flex min-h-10 items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-zinc-700 dark:text-zinc-300">${lead}<div class="min-w-0 flex-1">${body}</div>${end}</div>`

    const keep = !!st.status?.keep
    const sessionHead = `<div class="px-4 pb-2.5 pt-4"><div dir="auto" class="text-[15px] font-semibold">${esc(session.name)}</div><div class="mt-0.5 truncate text-xs text-zinc-500">${esc(session.path)} · started ${clock(session.createdAt)}</div></div>`
    const sessionBody = `<div class="space-y-0.5 px-1.5 pb-1.5">
        ${row(`<span class="grid size-4 place-items-center">${pulse('size-2', st.live && !st.stopped)}</span>`, st.stopped ? 'Stopped' : st.live ? `Live <span class="ml-1 text-xs text-zinc-400">${st.lastEdit ? `edited <span data-ago="${st.lastEdit}">${ago(st.lastEdit)}</span>` : 'waiting for edits'}</span>` : 'Reconnecting…')}
        ${row(ic('link', 'size-4 text-zinc-400'), `<span class="block truncate">${esc((session.url || location.origin).replace(/^https?:\/\//, ''))}</span>`, `<button data-act="copy" class="h-7 shrink-0 rounded-md px-2 text-xs text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">${st.copied ? 'Copied' : 'Copy'}</button>`)}
        ${lifecycle() ? row(ic('clock', 'size-4 self-start mt-0.5 text-zinc-400'), esc(lifecycle()).replace(' · ', '<span class="block text-xs leading-5 text-zinc-400">') + '</span>') : ''}
      </div>${SEP}
      <div class="flex h-14 items-center justify-between px-4"><span class="text-zinc-700 dark:text-zinc-300">Appearance</span><div class="flex rounded-lg bg-zinc-900/[.04] p-0.5 dark:bg-white/[.06]">${([['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']] as const).map(([m, i, l]) => { const on = st.dark === (m === 'dark'); return `<button data-act="theme:${m}" aria-pressed="${on}" class="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs ${on ? TAB_ON : TAB_OFF}">${ic(i, 'size-3.5')}${l}</button>` }).join('')}</div></div>${SEP}
      <div class="flex gap-2 p-3"><button data-act="keep" ${st.stopped ? 'disabled' : ''} class="h-9 flex-1 rounded-lg border border-black/10 text-xs font-medium hover:bg-zinc-900/[.03] disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5">${keep ? 'Don’t keep' : 'Keep forever'}</button><button data-act="stop" ${st.stopped ? 'disabled' : ''} class="h-9 flex-1 rounded-lg text-xs text-zinc-500 hover:bg-zinc-900/5 disabled:opacity-40 dark:hover:bg-white/10">Stop server</button></div>`
    const sessionMenu = sessionHead + sessionBody

    const protoRow = ({ p: q, depth }: { p: Proto; depth: number }) => { const on = q.id === p?.id && view !== 'session'; return `<button data-act="proto:${esc(q.id)}" aria-current="${on}" class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${on ? 'bg-zinc-900/[.05] dark:bg-white/[.08]' : 'hover:bg-zinc-900/[.03] dark:hover:bg-white/5'}" style="padding-left:${10 + nestIndent(depth)}px">
        <span class="mt-[7px] flex size-1.5 shrink-0">${editing(q.id) ? pulse('size-1.5') : ''}</span>
        <span class="min-w-0 flex-1"><span class="flex items-center gap-1.5 ${on ? 'font-semibold text-zinc-900 dark:text-white' : 'font-medium text-zinc-800 dark:text-zinc-200'}">${depth ? ic('branch', 'size-3.5 shrink-0 text-sky-500') : ''}${bd(q.title)}${q.kind === 'phone' ? ic('phone', 'size-3.5 text-zinc-400') : ''}</span>${q.ask ? `<span dir="auto" class="block truncate text-xs leading-5 text-zinc-500">“${esc(q.ask)}”</span>` : ''}</span>
        <span class="shrink-0 pt-px text-right text-[11px] leading-5 tabular-nums text-zinc-400">${q.variants.length} variant${q.variants.length === 1 ? '' : 's'}<br>${editing(q.id) ? '<span class="text-emerald-600">editing now</span>' : pickOf(q) ? `<span class="${PICK}">picked ${esc(pickOf(q))}</span>` : clock(q.created)}</span></button>` }
    const protoList = `<div class="max-h-[min(26rem,60vh)] space-y-px overflow-y-auto p-1">${treeOrder().map(protoRow).join('') || '<p class="px-3 py-4 text-xs text-zinc-400">None yet</p>'}</div>
      ${archived().length ? `${SEP}<div class="p-1.5"><button data-act="archived" class="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-xs text-zinc-400 hover:bg-zinc-900/[.03] hover:text-zinc-600 dark:hover:bg-white/5 dark:hover:text-zinc-200">${ic(st.archived ? 'chev' : 'right', 'size-3')}Archived<span class="ml-auto tabular-nums">${archived().length}</span></button>${st.archived ? archived().map(q => `<button data-act="proto:${esc(q.id)}" class="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-zinc-400 hover:bg-zinc-900/[.03] dark:hover:bg-white/5"><span class="size-1.5"></span><span dir="auto" class="line-through decoration-zinc-300">${esc(q.title)}</span><span class="ml-auto text-[11px] tabular-nums">${q.variants.length} variants</span></button>`).join('') : ''}</div>` : ''}`
    const protoMenu = `<div class="px-3.5 pb-0.5 pt-3 text-[11px] font-medium text-zinc-400">Prototypes in this session</div>${protoList}`

    const v = vs.find(v => v.id === vid)
    // Where in the variant: its state, and the tool it is shown through.
    const pv = st.place.view === 'variant' ? st.place : null
    const stateName = p && pv ? stateOf(p, pv.variant, pv.tool === 'play' ? st.playing : pv.state)?.name ?? '' : ''
    const toolName = pv?.tool ? pv.tool === 'compare' ? `vs ${otherOf(p!, pv.variant)}` : TOOLS[pv.tool].name : ''
    const where = pv ? [toolName, stateName].filter(Boolean).join(' · ') : ''
    // A state name alone takes its own direction; after the tool's name it is isolated in the line.
    const whereHtml = toolName ? `${esc(toolName)}${stateName ? ` · ${bd(stateName)}` : ''}` : esc(stateName)
    const initial = esc((session.name.trim()[0] || 'P').toUpperCase())
    // What this prototype was built from, oldest first.
    const line = p && view !== 'session' ? lineage(p) : []
    // On a phone the bar is back, title and session: back goes one level up (to the variant this
    // was built from, else the session), the title opens the prototypes, ⋯ the session. The
    // variant and the scale are in the pill.
    const up = view === 'session' ? null : line.length
      ? (a => ({ act: a.p.variants.some(x => x.id === a.v) ? `pv:${esc(a.p.id)}:${esc(a.v)}` : `lobby:proto:${esc(a.p.id)}`, label: a.p.title }))(line.at(-1)!)
      : { act: 'lobby:session', label: session.name }
    const phoneBar = `<div class="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-1 sm:hidden">
        <div class="flex min-w-0">${up ? `<button data-act="${up.act}" class="flex h-9 min-w-0 items-center gap-0.5 rounded-lg pr-2 text-zinc-600 active:bg-zinc-900/5 dark:text-zinc-400 dark:active:bg-white/10">${ic('left', 'size-5')}<span dir="auto" class="truncate">${esc(up.label)}</span></button>` : ''}</div>
        <button data-act="menu:protos" aria-haspopup="dialog" class="flex h-10 min-w-0 max-w-[13rem] items-center gap-1 rounded-lg px-2 active:bg-zinc-900/5 dark:active:bg-white/10"><span class="min-w-0 leading-tight"><span dir="auto" class="block truncate font-semibold">${esc(view === 'session' ? session.name : p!.title)}</span>${where ? `<span dir="auto" class="block truncate text-[11px] font-medium text-sky-700 dark:text-sky-300">${whereHtml}</span>` : v ? `<span dir="auto" class="block truncate text-[11px] text-zinc-500">${v.id} · ${esc(v.name)}</span>` : ''}</span>${ic('chev', 'size-3.5 shrink-0 text-zinc-400')}</button>
        <div class="flex justify-end"><button data-act="menu:session" aria-label="Session" aria-haspopup="dialog" class="${IB} relative">${ic('dots')}<span class="absolute right-1 top-1 flex rounded-full ring-2 ring-white dark:ring-zinc-950">${pulse('size-1.5', st.live && !st.stopped)}</span></button></div>
      </div>`
    // The switcher: where you are on two lines (the prototype and variant, then the session and
    // what it was built from), opening the whole session as columns.
    const sub = view === 'session' ? `${active().length} prototype${active().length === 1 ? '' : 's'}`
      : [session.name, ...line.map(a => `${a.p.title} ${a.v}`)].map(t => `<span dir="auto" class="min-w-0 max-w-[12rem] shrink truncate">${esc(t)}</span>`).join(ic('right', 'size-3 shrink-0 text-zinc-400'))
    const switcher = `<div class="relative flex min-w-0">
        <button data-act="open:switch" data-shoot="switcher" aria-haspopup="dialog" aria-expanded="${st.open === 'switch'}" title="Every prototype and variant" class="flex h-10 min-w-0 items-center gap-2 rounded-lg px-2.5 text-left hover:bg-zinc-900/5 dark:hover:bg-white/10 ${st.open === 'switch' ? ON : ''}">
          <span class="min-w-0 leading-tight">
            <span class="flex min-w-0 items-center gap-1.5 font-semibold">${view === 'session' ? `<span dir="auto" class="truncate">${esc(session.name)}</span>` : `<span dir="auto" class="truncate">${esc(p!.title)}</span><span class="shrink-0 font-normal text-zinc-400">·</span>${v ? `<b class="shrink-0">${v.id}</b><span dir="auto" class="min-w-0 truncate">${esc(v.name)}</span>` : '<span class="shrink-0 font-normal text-zinc-500">All variants</span>'}`}${p && pickOf(p) && v?.id === pickOf(p) ? ic('check', `size-3.5 shrink-0 ${PICK}`) : ''}</span>
            <span class="flex min-w-0 items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">${sub}${where ? `<span class="shrink-0 text-zinc-300 dark:text-zinc-600">·</span><span dir="auto" class="min-w-0 truncate font-medium text-sky-700 dark:text-sky-300">${whereHtml}</span>` : ''}</span>
          </span>${ic('chev', `size-3.5 shrink-0 text-zinc-400 transition-transform ${st.open === 'switch' ? 'rotate-180' : ''}`)}</button>
        ${pop(st.open === 'switch', miller(), 'left-0 top-11')}</div>`
    const stepper = v && vs.length > 1 ? `<button data-act="step:-1" aria-label="Previous variant" title="Previous variant · ←" class="${IB} shrink-0">${ic('left')}</button><span class="w-9 shrink-0 text-center text-xs tabular-nums text-zinc-500">${at + 1}<span class="text-zinc-400 dark:text-zinc-600">/${vs.length}</span></span><button data-act="step:1" aria-label="Next variant" title="Next variant · →" class="${IB} shrink-0">${ic('right')}</button>` : ''
    keepScroll(bar, `${phoneBar}<div class="hidden min-w-0 flex-1 items-center gap-1 sm:flex"><button data-act="side:1" class="${IB} shrink-0 ${st.side ? 'lg:hidden' : ''}" title="Show sidebar · ⌘\\" aria-label="Show sidebar">${ic('sidebar')}</button>
      <div class="relative shrink-0"><button data-act="open:session" aria-label="Session" aria-expanded="${st.open === 'session'}" title="${esc(session.name)}" class="${IB} ${st.open === 'session' ? ON : ''}"><span class="relative grid size-5 shrink-0 place-items-center rounded bg-zinc-900 text-[10px] font-bold text-white dark:bg-white dark:text-zinc-900">${initial}<span class="absolute -right-1 -top-1 flex rounded-full ring-2 ring-white dark:ring-zinc-950">${pulse('size-2', st.live && !st.stopped)}</span></span></button>${pop(st.open === 'session', sessionMenu, 'left-0 top-11 w-[22rem] max-w-[calc(100vw-1rem)]')}</div>
      ${switcher}
      <div class="ml-auto flex shrink-0 items-center gap-1">
        ${stepper}${stepper && commentHost() ? '<span class="mx-1 h-5 w-px bg-black/10 dark:bg-white/10"></span>' : ''}
        ${commentBtn()}
        ${phones ? `<div class="relative"><button data-act="open:scale" aria-expanded="${st.open === 'scale'}" class="${IB} text-xs tabular-nums ${st.open === 'scale' ? 'bg-zinc-900/5 text-zinc-900 dark:bg-white/10 dark:text-white' : ''}">${ic('phone')}<span data-scale-label>${scaleLabel()}</span></button>${pop(st.open === 'scale', scaleMenu, 'right-0 top-11 w-72')}</div>` : ''}
      </div></div>`)
    menus = { protos: drill(), session: sessionBody }

    // The switcher's dropdown: one column per level, scrolled to the last, and what is shown
    // described beside them.
    function miller() {
      const cols = columns()
      const q = p && pv ? p.variants.find(x => x.id === pv.variant) : undefined
      const kids = p && q ? kidsOf(p, q.id) : []
      const about = !p ? `<div dir="auto" class="font-semibold">${esc(session.name)}</div><p class="mt-1 text-xs text-zinc-500">${active().length} prototypes · started ${clock(session.createdAt)}</p>`
        : `<div class="text-[11px] text-zinc-500"><span dir="auto">${esc(p.title)}</span></div><div class="mt-0.5 flex items-center gap-1.5 font-semibold">${q ? `<b>${q.id}</b><span dir="auto" class="truncate">${esc(q.name)}</span>` : 'All variants'}</div>
          ${q && p.about[q.id] ? `<p dir="auto" class="mt-2 text-xs leading-[18px] text-zinc-600 dark:text-zinc-400">${esc(p.about[q.id])}</p>` : !q && p.ask ? `<p dir="auto" class="mt-2 text-xs leading-[18px] text-zinc-600 dark:text-zinc-400">“${esc(p.ask)}”</p>` : ''}
          <p class="mt-2 text-[11px] text-zinc-400">${[q && q.id === pickOf(p) ? 'Picked' : '', q && same(session.work, { proto: p.id, variant: q.id }) ? 'Your requests change it' : '', kids.length ? `${kids.length} built from it` : '', line.length ? `${line.length + 1} levels deep` : ''].filter(Boolean).join(' · ')}</p>
          ${q ? `<button data-act="lobby:proto:${esc(p.id)}" class="mt-auto flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium ring-1 ring-inset ring-black/10 hover:bg-zinc-900/[.04] dark:ring-white/15 dark:hover:bg-white/[.06]">${ic('grid', 'size-3.5')}All ${p.variants.length} variants</button>` : ''}`
      return `<div data-fitw="${cols.length * 200 + 224}" class="flex h-[26rem] max-h-[calc(100dvh-5rem)]">
        <div data-mcols data-k="mcols" class="flex min-w-0 flex-1 overflow-x-auto overscroll-contain">${cols.map(c => `<div class="flex w-[12.5rem] shrink-0 flex-col border-r border-black/[.06] pt-1 dark:border-white/10">${colHead(c)}<div data-vlist data-k="${esc(colKey(c))}" class="relative min-h-0 flex-1 space-y-px overflow-y-auto overscroll-contain px-1.5 pb-2">${colRows(c)}</div></div>`).join('')}</div>
        <div class="flex w-56 shrink-0 flex-col bg-zinc-900/[.02] p-4 dark:bg-white/[.02]">${about}</div></div>`
    }

    // The phone's sheet: the same columns, one at a time. It opens on the last; back steps left,
    // and the chips jump to any level on the way.
    function drill() {
      const cols = columns(), i = Math.min(st.drill ?? cols.length - 1, cols.length - 1), c = cols[i], back = i > 0 ? cols[i - 1] : null
      const chips = cols.map((x, j) => ({ x, j })).filter(({ x }) => x.kind === 'variants' && x.sel)
      return `<div class="pb-3">
        <div class="flex h-10 items-center px-1">${back ? `<button data-act="drill:${i - 1}" class="flex h-10 min-w-0 items-center gap-0.5 rounded-lg pr-2 text-zinc-600 active:bg-zinc-900/5 dark:text-zinc-400 dark:active:bg-white/10">${ic('left', 'size-5')}<span dir="auto" class="truncate">${esc(colName(back))}${back.kind === 'variants' && back.sel ? ` <b>${esc(back.sel)}</b>` : ''}</span></button>` : ''}</div>
        <div class="flex items-end gap-2 px-3 pb-2"><div class="min-w-0 flex-1"><div dir="auto" class="truncate text-xl font-semibold leading-tight">${esc(colName(c))}</div><div class="mt-0.5 text-xs text-zinc-500">${colCount(c)} ${c.kind === 'variants' ? 'variants' : 'prototypes'}</div></div>
          ${c.kind === 'variants' ? `<button data-act="lobby:proto:${esc(c.p.id)}" class="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-inset ring-black/10 dark:ring-white/15">${ic('grid', 'size-3.5')}All</button>` : c.from ? '' : '<button data-act="lobby:session" class="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-inset ring-black/10 dark:ring-white/15">Overview</button>'}</div>
        ${chips.length > 1 ? `<div data-mcols class="flex gap-1.5 overflow-x-auto px-3 pb-3 [scrollbar-width:none]">${chips.map(({ x, j }) => `<button data-act="drill:${j}" class="h-8 shrink-0 rounded-full px-3 text-xs ${j === i ? 'bg-sky-500/15 font-semibold text-sky-800 dark:text-sky-200' : 'bg-zinc-900/[.05] text-zinc-600 dark:bg-white/[.07] dark:text-zinc-300'}"><span dir="auto">${esc(colName(x))}</span> <b>${esc(x.sel)}</b></button>`).join('')}</div>` : ''}
        <div class="space-y-px px-2">${colRows(c, true)}</div></div>`
    }
    side.className = st.side ? 'hidden shrink-0 flex-col border-r border-black/[.07] lg:flex dark:border-white/10' : 'hidden'
    side.style.width = `${st.sideW}px`
    grip.classList.toggle('lg:block', st.side)
    grip.setAttribute('aria-valuenow', String(st.sideW))
    keepScroll(side, st.side ? sideNav(false) : '')
    keepScroll(drawer, st.drawer ? `<div class="fixed inset-0 z-50 lg:hidden"><div data-act="drawer:0" class="absolute inset-0 bg-black/30"></div><div class="absolute inset-y-0 left-0 flex w-[19rem] max-w-[85%] flex-col bg-white shadow-2xl dark:bg-zinc-950">${sideNav(true)}</div></div>` : '')

    // Focus mode restyles the zone to cover the page; the mounted design stays put. On a phone
    // the variant pill takes a strip at the bottom of the stage, so it never covers the design.
    zone.className = st.focus ? 'fixed inset-0 z-[100] bg-white text-[13px] dark:bg-zinc-950' : `relative min-h-0 flex-1 ${pillOn() ? 'max-sm:[--pill-h:calc(4.25rem+env(safe-area-inset-bottom))]' : ''}`
    document.documentElement.style.overflow = st.focus ? 'hidden' : ''

    const edgeBtn = (side: 'prev' | 'next') => {
      const d = side === 'prev' ? -1 : 1, t = vs[(at + d + vs.length) % vs.length]
      const k = `${st.focus ? 'focus' : 'main'}-${side}`, e = smooth(edge.t[k] || 0), open = !!edge.hover[k]
      return `<button data-edge="${k}" data-act="step:${d}" aria-label="${d < 0 ? 'Previous' : 'Next'} variant: ${t.id} ${esc(t.name)}" class="absolute top-1/2 z-10 -mt-6 hidden h-12 items-center rounded-full bg-white/90 px-3 text-zinc-900 shadow-lg shadow-black/10 ring-1 ring-black/10 backdrop-blur [@media(hover:hover)]:flex dark:bg-zinc-900/90 dark:text-white dark:ring-white/15 ${d < 0 ? 'left-3' : 'right-[calc(var(--hw,0px)+0.75rem)] flex-row-reverse'}" style="opacity:${e};pointer-events:${e > 0.3 ? 'auto' : 'none'}">${ic(d < 0 ? 'left' : 'right', 'size-5')}<span data-edge-label class="overflow-hidden whitespace-nowrap text-[13px]" style="width:${open ? edge.w[k] || 0 : 0}px;opacity:${open ? 1 : 0};margin-${d < 0 ? 'left' : 'right'}:${open ? 8 : 0}px;transition:width .32s cubic-bezier(.22,1,.36,1),opacity .2s,margin .32s cubic-bezier(.22,1,.36,1)"><span class="inline-block"><b>${t.id}</b> · ${bd(t.name)}</span></span></button>`
    }
    const dockBtn = 'grid size-9 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white'
    const dockSep = '<span class="mx-1 h-5 w-px shrink-0 bg-white/15"></span>'
    overlay.innerHTML = view !== 'variant' || !p ? '' : `
      ${vs.length > 1 ? edgeBtn('prev') + edgeBtn('next') : ''}
      ${!st.focus ? `<button data-act="focus" data-focus-btn title="Focus mode · F" class="absolute right-[calc(var(--hw,0px)+1rem)] top-3 z-10 hidden h-9 [@media(hover:hover)]:inline-flex items-center gap-1.5 rounded-full bg-zinc-900/80 px-3 text-xs font-medium text-white shadow-lg backdrop-blur transition-opacity duration-200 focus-visible:!opacity-100" style="opacity:${stageHover.on ? 1 : 0}">${ic('grow', 'size-3.5')}Focus</button>` : `
      ${st.open === 'fproto' ? `<div data-pop class="fixed bottom-[76px] left-1/2 z-20 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-900">${protoMenu}</div>` : ''}
      <div class="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center pb-[env(safe-area-inset-bottom)]">
        <div data-dock data-locked="${st.open === 'fproto' ? 1 : 0}" class="pointer-events-auto relative overflow-hidden rounded-full shadow-xl shadow-black/20 ring-1 ring-white/10 backdrop-blur" style="width:72px;height:6px;margin-bottom:4px;background-color:rgb(24 24 27/.35)">
          <div data-dock-full class="absolute left-1/2 top-1/2 flex w-max items-center gap-0.5 px-1 text-white" style="opacity:0;transform:translate(-50%,-50%)">
            <button data-act="unfocus" class="${dockBtn}" aria-label="Exit focus (Esc)" title="Exit focus · Esc">${ic('shrink')}</button>${dockSep}
            <button data-act="open:fproto" aria-label="Prototypes" class="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2 hover:bg-white/10 sm:px-3">${ic('menu', 'size-4 sm:hidden')}<span dir="auto" class="hidden max-w-48 truncate font-medium sm:inline">${esc(p.title)}</span>${ic('chev', 'hidden size-3.5 rotate-180 text-white/50 sm:block')}</button>${dockSep}
            ${many ? `<button data-act="step:-1" class="${dockBtn} w-7" aria-label="Previous">${ic('left', 'size-3.5')}</button>` : ''}
            ${shown.map(x => `<button data-act="variant:${x.id}" title="${esc(x.name)}" class="relative grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${vid === x.id ? 'bg-white text-zinc-900' : 'text-white/70 hover:bg-white/10'}">${x.id}${editing(p.id, x.id) ? `<span class="absolute right-1 top-1">${pulse('size-1.5')}</span>` : ''}</button>`).join('')}
            ${many ? `<button data-act="step:1" class="${dockBtn} w-7" aria-label="Next">${ic('right', 'size-3.5')}</button><span class="px-1.5 text-xs tabular-nums text-white/60">${at + 1}/${vs.length}</span>` : ''}${dockSep}
            ${phones ? `<button data-act="scale:${[0, 100, 75, 50][([0, 100, 75, 50].indexOf(st.scale) + 1) % 4]}" class="h-9 shrink-0 rounded-full px-2 text-xs tabular-nums text-white/70 hover:bg-white/10" title="Phone scale">${scaleLabel()}</button>` : ''}
            <button data-act="theme:${st.dark ? 'light' : 'dark'}" class="${dockBtn}" aria-label="Theme">${ic(st.dark ? 'sun' : 'moon')}</button>
          </div>
        </div>
      </div>`}`

    if (st.focus) requestAnimationFrame(runDock)
    restoreEdgeLabels()
    // The dropdown is as wide as its columns, up to the window's edge (the columns scroll).
    for (const el of bar.querySelectorAll<HTMLElement>('[data-fitw]')) el.style.width = `${Math.min(Number(el.dataset.fitw), innerWidth - el.getBoundingClientRect().left - 12)}px`
    // On arrival (or a menu or level opening) each column centers what is lit, and the
    // dropdown's columns scroll to the last one.
    if (recenter) requestAnimationFrame(() => {
      recenter = false
      for (const list of root.querySelectorAll<HTMLElement>('[data-vlist]')) {
        const on = list.querySelector<HTMLElement>('[aria-current="true"]')
        if (on) list.scrollTop = on.offsetTop - list.clientHeight / 2 + on.clientHeight / 2
      }
      for (const m of root.querySelectorAll<HTMLElement>('[data-mcols]')) m.scrollLeft = m.scrollWidth
    })
    document.title = [where, v && `${v.id} · ${v.name}`, p?.title, session.name].filter(Boolean).join(' – ')
    paintIcon()
    paintHints()
    paintPill()
  }

  // ---------- the variant pill (phones) ----------
  // Below 640px the variants live in one floating pill at the bottom of the stage: it names
  // the variant, its arrows step, a tap opens the sheet of all of them, and a drag along it
  // moves through them, one variant per short stretch of finger. While the finger moves, the
  // stage slides with it: the design next in line comes in beside this one, one phone apart at
  // the phone scale (or one stage width for a web prototype), so at 50% the neighbour shows
  // early and at 100% it is a full page away. It is mounted only for the drag.
  const STEP = 34
  const pillOn = () => { const p = cur(); return !!p && st.place.view !== 'session' && !st.focus && visible(p).length > 0 }
  type Peek = { layer: Layer; place: Place }
  type PillDrag = {
    id: number; x0: number; lastX: number; lastT: number; v: number; moved: boolean
    proto: Proto; ids: string[]; base: number; pos: number
    real: Layer | null; peeks: Map<number, Peek>; pitch: number; raf: number; target: number
  }
  let pd: PillDrag | null = null
  let pillKey = ''
  const pillBtn = 'grid size-10 shrink-0 place-items-center rounded-full text-white/70 active:bg-white/10'

  function paintPill() {
    const p = cur()
    if (pd) return
    const vs = p ? visible(p) : []
    const vid = st.place.view === 'variant' ? st.place.variant : ''
    const at = vs.findIndex(v => v.id === vid)
    const key = pillOn() ? JSON.stringify([p!.id, p!.kind, vid, vs.map(v => [v.id, v.name]), p!.variants.length, editing(p!.id, vid), st.sheet, pillComments()]) : ''
    if (key !== pillKey) {
      pillKey = key
      if (!key) { pill.innerHTML = ''; closeCard(true) }
      else {
        const v = vs[at]
        const prev = vs[at <= 0 ? vs.length - 1 : at - 1], next = vs[at < 0 || at === vs.length - 1 ? 0 : at + 1]
        pill.innerHTML = `<div class="absolute inset-x-0 bottom-0 z-10 flex h-[var(--pill-h,0px)] items-start justify-center pt-2 sm:hidden">
          <div data-pill-bar class="relative flex h-12 items-center gap-0.5 rounded-full bg-zinc-900/90 p-1 text-white shadow-xl shadow-black/20 ring-1 ring-white/10 backdrop-blur dark:bg-zinc-800/90">
            <div data-ruler hidden class="pointer-events-none absolute bottom-full left-1/2 mb-2 h-9 w-56 -translate-x-1/2 overflow-hidden rounded-full bg-zinc-900/90 shadow-lg ring-1 ring-white/10 [mask-image:linear-gradient(90deg,transparent,#000_25%,#000_75%,transparent)] dark:bg-zinc-800/90"></div>
            <button data-act="lobby:proto" aria-label="All variants" aria-pressed="${st.place.view === 'proto'}" class="${pillBtn} ${st.place.view === 'proto' ? '!bg-white !text-zinc-900' : ''}">${ic('grid')}</button>
            <span class="mx-0.5 h-5 w-px shrink-0 bg-white/15"></span>
            <button data-act="variant:${prev.id}" aria-label="Previous variant: ${prev.id} ${esc(prev.name)}" class="${pillBtn}">${ic('left')}</button>
            <div data-pill-handle role="button" tabindex="0" aria-label="${v ? `${v.id} ${esc(v.name)}, ${at + 1} of ${vs.length}. ` : ''}Show all variants" class="flex h-10 ${commentHost() ? 'w-28' : 'w-40'} min-w-0 cursor-grab touch-none select-none items-center justify-center gap-1.5 rounded-full px-2 active:bg-white/10">
              ${v ? `<b data-pill-id class="shrink-0 text-[15px]">${v.id}</b><span data-pill-name dir="auto" class="min-w-0 truncate text-white/70">${esc(v.name)}</span><span data-pill-n class="shrink-0 text-[11px] tabular-nums text-white/40">${at + 1}/${vs.length}</span>${editing(p!.id, v.id) ? pulse('size-1.5') : ''}`
                : `<span class="truncate font-medium">All variants</span><span class="shrink-0 text-[11px] tabular-nums text-white/40">${vs.length}</span>`}
            </div>
            <button data-act="variant:${next.id}" aria-label="Next variant: ${next.id} ${esc(next.name)}" class="${pillBtn}">${ic('right')}</button>
            ${commentHost() ? (c => `<span class="mx-0.5 h-5 w-px shrink-0 bg-white/15"></span><button data-act="comment:tap" data-shoot="comment" aria-label="Comments" aria-pressed="${c.picking}" class="${pillBtn} relative ${c.picking ? '!bg-proto-primary !text-proto-primary-fg' : ''}">${ic(c.picking ? 'x' : 'comment', 'size-5')}${c.drafts && !c.picking ? `<span class="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-proto-primary text-[10px] font-semibold text-proto-primary-fg ring-2 ring-zinc-900">${c.drafts}</span>` : ''}</button>`)(comments.counts()) : ''}
            ${p!.kind === 'phone' ? `<span class="mx-0.5 h-5 w-px shrink-0 bg-white/15"></span><button data-pill-scale aria-label="Phone scale" aria-expanded="false" class="h-10 min-w-12 shrink-0 rounded-full px-2.5 text-xs font-medium tabular-nums text-white/70 transition-colors duration-200 active:bg-white/10"><span data-scale-label>${scaleLabel()}</span></button>` : ''}
          </div>
        </div>`
      }
    }
    if (card) pill.querySelector('[data-pill-scale]')?.setAttribute('aria-expanded', String(card.phase !== 'exit'))
    syncScale()
    paintMenu({
      open: !!st.menu,
      title: st.menu === 'session' ? session.name : 'Find a design',
      html: st.menu ? menus[st.menu] : '',
      onClose: () => { st.menu = ''; render() },
    })
    paintSheet({
      open: st.sheet && !!key,
      title: p?.title ?? '',
      rows: vs.map(v => ({ id: v.id, name: v.name, on: v.id === vid, picked: v.id === (p ? pickOf(p) : ''), editing: !!p && editing(p.id, v.id) })),
      lobby: st.place.view === 'proto',
      onClose: () => { st.sheet = false; render() },
      onPick: id => { st.sheet = false; if (p) go(keepIn(p, id)); render() },
      onLobby: () => { st.sheet = false; if (p) go({ view: 'proto', proto: p.id }); render() },
    })
  }

  let menus = { protos: '', session: '' }

  // ---------- the phone scale, in the pill ----------
  // The pill's scale opens the same controls as the bar's scale menu (Fit and the sizes, then
  // a slider), in the pill's dark. The card grows out of the button: it starts as the button,
  // same place, size and round corners, opens into the card, and its controls fade in once
  // there is room; closing folds it back. Turning it around halfway plays the running
  // animation back from where it is.
  const DARK_SEG = (on: boolean) => `h-9 flex-1 rounded-full text-xs font-medium tabular-nums ${on ? 'bg-white text-zinc-900' : 'text-white/70 hover:bg-white/10'}`
  const cardHtml = () => `<div data-scale-backdrop class="fixed inset-0 z-20"></div>
    <div data-card class="absolute z-30 w-[17.5rem] space-y-1 rounded-3xl bg-zinc-900/95 p-1.5 text-white shadow-xl shadow-black/20 ring-1 ring-white/10 backdrop-blur dark:bg-zinc-800/95" style="transform-origin:0 0">
      <div class="flex gap-0.5 rounded-full bg-white/[.06] p-0.5">${SCALES.map(s => `<button data-act="scale:${s}" data-scale-seg="${s}" data-dark aria-pressed="${st.scale === s}" class="${DARK_SEG(st.scale === s)}">${s ? s + '%' : 'Fit'}</button>`).join('')}</div>
      <div class="flex items-center">${['minus', 'plus'].map((n, i) => `<button data-act="scalestep:${i ? 5 : -5}" aria-label="${i ? 'Bigger' : 'Smaller'}" class="${i ? 'order-3' : ''} grid size-10 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">${ic(n)}</button>`).join('')}<input data-scale-range type="range" min="${SCALE_MIN}" max="${SCALE_MAX}" step="1" value="${st.scale || 50}" aria-label="Phone scale" class="order-2 ${RANGE} ${st.scale ? '' : 'opacity-40'}" style="--p:${rangeAt(st.scale || 50)}%;--fill:#fff;--rest:rgb(255 255 255/.15)"></div>
    </div>`
  let card: { el: HTMLElement; phase: 'enter' | 'open' | 'exit'; anims: Animation[] } | null = null
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  const CARD_EASE_OUT = 'cubic-bezier(0.32, 0.72, 0, 1)', CARD_EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'

  // Everything that shows the scale, updated in place so an open menu or a drag isn't rebuilt.
  function syncScale(except?: HTMLInputElement) {
    for (const l of root.querySelectorAll('[data-scale-label]')) l.textContent = scaleLabel()
    for (const b of root.querySelectorAll<HTMLElement>('[data-scale-seg]')) { const on = Number(b.dataset.scaleSeg) === st.scale; b.setAttribute('aria-pressed', String(on)); b.className = b.hasAttribute('data-dark') ? DARK_SEG(on) : segCls(on) }
    for (const r of root.querySelectorAll<HTMLInputElement>('[data-scale-range]')) {
      if (r === except) continue
      r.value = String(st.scale || 50)
      r.style.setProperty('--p', `${rangeAt(st.scale || 50)}%`)
      r.classList.toggle('opacity-40', !st.scale)
    }
  }
  // Where the button sits, as the transform that turns the card into it.
  function asButton(el: HTMLElement, btn: HTMLElement) {
    const c = el.getBoundingClientRect(), b = btn.getBoundingClientRect()
    const sx = b.width / c.width, sy = b.height / c.height, r = b.height / 2
    return { transform: `translate(${b.left - c.left}px, ${b.top - c.top}px) scale(${sx}, ${sy})`, borderRadius: `${r / sx}px / ${r / sy}px` }
  }
  function settleCard(c: NonNullable<typeof card>, phase: 'enter' | 'exit', done: () => void) {
    const anims = c.anims
    Promise.all(anims.map(a => a.finished)).then(() => { if (card === c && c.anims === anims && c.phase === phase) done() }, () => {})
  }
  function openCard() {
    const btn = pill.querySelector<HTMLElement>('[data-pill-scale]'), bar = btn?.closest<HTMLElement>('[data-pill-bar]')
    if (!btn || !bar) return
    btn.setAttribute('aria-expanded', 'true')
    btn.classList.add('!bg-white', '!text-zinc-900')
    if (card?.phase === 'exit') { card.el.style.pointerEvents = ''; cardHost.querySelector<HTMLElement>('[data-scale-backdrop]')!.style.pointerEvents = ''; card.anims.forEach(a => a.reverse()); card.phase = 'enter'; const c = card; settleCard(c, 'enter', () => { c.phase = 'open'; c.anims.forEach(a => a.cancel()); c.anims = [] }); return }
    if (card) return
    cardHost.innerHTML = cardHtml()
    const el = cardHost.querySelector<HTMLElement>('[data-card]')!
    const z = zone.getBoundingClientRect(), b = bar.getBoundingClientRect()
    el.style.right = `${z.right - b.right}px`
    el.style.bottom = `${z.bottom - b.top + 8}px`
    card = { el, phase: 'open', anims: [] }
    if (reduceMotion()) return
    const from = asButton(el, btn)
    card.phase = 'enter'
    card.anims = [
      el.animate([{ ...from, opacity: 0.6 }, { transform: 'none', borderRadius: '24px', opacity: 1 }], { duration: 340, easing: CARD_EASE_OUT }),
      ...[...el.children].map(r => r.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], { duration: 340 })),
    ]
    const c = card
    settleCard(c, 'enter', () => { c.phase = 'open'; c.anims = [] })
  }
  function closeCard(now = false) {
    if (!card) return
    const btn = pill.querySelector<HTMLElement>('[data-pill-scale]')
    btn?.setAttribute('aria-expanded', 'false')
    btn?.classList.remove('!bg-white', '!text-zinc-900')
    const drop = () => { cardHost.innerHTML = ''; card = null }
    if (now || reduceMotion() || !btn) { card.anims.forEach(a => a.cancel()); return drop() }
    const c = card
    if (c.phase === 'exit') return
    if (c.phase === 'enter') {
      // Held at its start once played back, so the card doesn't flash open before it goes.
      c.anims.forEach(a => { a.effect?.updateTiming({ fill: 'both' }); a.reverse() })
    } else {
      const to = asButton(c.el, btn)
      c.anims = [
        c.el.animate([{ transform: 'none', borderRadius: '24px', opacity: 1 }, { ...to, opacity: 0 }], { duration: 240, easing: CARD_EASE_IN, fill: 'forwards' }),
        ...[...c.el.children].map(r => r.animate([{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], { duration: 240, fill: 'forwards' })),
      ]
    }
    c.phase = 'exit'
    // While it folds away, a tap goes through to the pill, so the button can open it again.
    c.el.style.pointerEvents = 'none'
    cardHost.querySelector<HTMLElement>('[data-scale-backdrop]')!.style.pointerEvents = 'none'
    settleCard(c, 'exit', drop)
  }
  pill.addEventListener('click', e => {
    if (!(e.target as Element).closest('[data-pill-scale]')) return
    card && card.phase !== 'exit' ? closeCard() : openCard()
  })
  cardHost.addEventListener('click', e => { if ((e.target as Element).closest('[data-scale-backdrop]')) closeCard() })
  // The phone's sheets and scale card belong to the phone layout; widening past it closes them.
  matchMedia('(min-width: 640px)').addEventListener('change', e => {
    if (!e.matches || !(st.menu || st.sheet || card)) return
    st.menu = ''; st.sheet = false; closeCard(true); render()
  })

  // The letters around the finger, above the pill, while it drags.
  function paintRuler(d: PillDrag) {
    const r = pill.querySelector<HTMLElement>('[data-ruler]')
    if (!r) return
    r.hidden = false
    r.innerHTML = d.ids.map((id, i) => ({ id, off: i - d.pos })).filter(x => Math.abs(x.off) < 4).map(({ id, off }) =>
      `<span class="absolute top-0 grid h-9 w-8 place-items-center text-[13px] font-semibold text-white" style="left:${112 - 16 + off * 32}px;opacity:${1 - Math.min(1, Math.abs(off)) * 0.55}">${id}</span>`).join('')
      + '<span class="absolute left-1/2 top-1 h-7 w-8 -translate-x-1/2 rounded-full ring-1 ring-white/40"></span>'
    const i = Math.min(d.ids.length - 1, Math.max(0, Math.round(d.pos))), v = d.proto.variants.find(x => x.id === d.ids[i])!
    const set = (sel: string, text: string) => { const el = pill.querySelector(sel); if (el) el.textContent = text }
    set('[data-pill-id]', v.id); set('[data-pill-name]', v.name); set('[data-pill-n]', `${i + 1}/${d.ids.length}`)
  }

  // The stage follows pos: this design moves off by its distance from pos, and the variants on
  // either side of pos are mounted beside it (inert) while they are in reach.
  function slide(d: PillDrag) {
    if (!d.real || d.real !== layer || !d.pitch) return
    d.real.el.style.transform = `translate3d(${(d.base - d.pos) * d.pitch}px,0,0)`
    const want = new Set([Math.floor(d.pos), Math.ceil(d.pos)].filter(i => i >= 0 && i < d.ids.length && i !== d.base))
    for (const [i, k] of d.peeks) if (!want.has(i)) { k.layer.el.remove(); k.layer.dispose(); d.peeks.delete(i) }
    for (const i of want) {
      if (!d.peeks.has(i)) {
        const place = keepIn(d.proto, d.ids[i]), l = buildLayer(place)
        l.el.inert = true
        l.el.style.pointerEvents = 'none'
        layers.append(l.el)
        fitBox(l.el)
        d.peeks.set(i, { layer: l, place })
      }
      d.peeks.get(i)!.layer.el.style.transform = `translate3d(${(i - d.pos) * d.pitch}px,0,0)`
    }
  }
  function endSlide(d: PillDrag, keep?: number) {
    if (d.real) d.real.el.style.transform = ''
    for (const [i, k] of d.peeks) if (i !== keep) { k.layer.el.remove(); k.layer.dispose() }
  }

  // Past either end it gives a little, then stops.
  const rubber = (x: number, n: number) => { const give = (o: number) => 0.35 * (1 - 1 / (o * 1.2 + 1)); return x < 0 ? -give(-x) : x > n - 1 ? n - 1 + give(x - n + 1) : x }

  function land(d: PillDrag, target: number) {
    const k = d.peeks.get(target)
    const place = k?.place ?? keepIn(d.proto, d.ids[target])
    pd = null
    pill.querySelector<HTMLElement>('[data-ruler]')?.setAttribute('hidden', '')
    if (target === d.base) { endSlide(d); pillKey = ''; return render() }
    // The design that slid in becomes the page's layer as it is, so nothing remounts or fades;
    // the place is set first, so the hash change that follows only redraws the chrome.
    if (k && d.real && d.real === layer) {
      endSlide(d, target)
      k.layer.el.style.transform = ''
      k.layer.el.style.pointerEvents = ''
      k.layer.el.inert = false
      layer = k.layer
      d.real.el.remove(); d.real.dispose()
      st.place = place
      fit()
    } else endSlide(d)
    go(place)
  }

  pill.addEventListener('pointerdown', e => {
    let h = (e.target as Element).closest<HTMLElement>('[data-pill-handle]')
    if (!h || e.button !== 0) return
    // A second finger mid-drag is ignored; a touch while the last drag settles lands it now
    // (which may redraw the pill, so the handle is looked up again).
    if (pd) { if (!pd.raf) return; cancelAnimationFrame(pd.raf); land(pd, pd.target); h = pill.querySelector<HTMLElement>('[data-pill-handle]') }
    const p = cur()
    if (!h || !p) return
    const ids = visible(p).map(v => v.id)
    const vid = st.place.view === 'variant' ? st.place.variant : ''
    const base = ids.indexOf(vid)
    const real = base >= 0 && st.place.view === 'variant' && !st.place.tool ? layer : null
    const phone = real?.el.querySelector<HTMLElement>('[data-phone]')
    const pitch = real ? (phone ? phone.getBoundingClientRect().width : real.el.clientWidth) + 24 : 0
    h.setPointerCapture(e.pointerId)
    pd = { id: e.pointerId, x0: e.clientX, lastX: e.clientX, lastT: e.timeStamp, v: 0, moved: false, proto: p, ids, base, pos: Math.max(0, base), real, peeks: new Map(), pitch, raf: 0, target: base }
  })
  pill.addEventListener('pointermove', e => {
    const d = pd
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.x0
    if (!d.moved && Math.abs(dx) < 6) return
    d.moved = true
    const dt = Math.max(1, e.timeStamp - d.lastT)
    d.v = 0.7 * d.v + 0.3 * ((e.clientX - d.lastX) / dt)
    d.lastX = e.clientX; d.lastT = e.timeStamp
    d.pos = rubber(Math.max(0, d.base) - dx / STEP, d.ids.length)
    paintRuler(d)
    slide(d)
  })
  const pillUp = (e: PointerEvent) => {
    const d = pd
    if (!d || e.pointerId !== d.id || d.raf) return
    if (!d.moved) { pd = null; if (e.type === 'pointerup') { st.sheet = true; render() } return }
    // A flick carries on past the finger; a deliberate drag lands where it was let go.
    const v = e.timeStamp - d.lastT > 80 ? 0 : d.v
    const target = Math.min(d.ids.length - 1, Math.max(0, Math.round(d.pos - (Math.abs(v) > 0.45 ? v * 100 : 0) / STEP)))
    d.target = target
    const from = d.pos, t0 = performance.now(), dur = Math.min(420, 220 + 50 * Math.abs(target - from))
    if (!d.real || matchMedia('(prefers-reduced-motion: reduce)').matches) return land(d, target)
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur)
      d.pos = from + (target - from) * (1 - Math.pow(1 - k, 3))
      paintRuler(d)
      slide(d)
      if (k < 1) d.raf = requestAnimationFrame(tick)
      else land(d, target)
    }
    d.raf = requestAnimationFrame(tick)
  }
  pill.addEventListener('pointerup', pillUp)
  pill.addEventListener('pointercancel', pillUp)
  pill.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element).closest('[data-pill-handle]')) { e.preventDefault(); st.sheet = true; render() }
  })

  // ---------- sidebar ----------
  // The switcher's columns, stacked: every level of the path is one line saying what is chosen
  // there, and one level opens as two columns side by side (the last two, unless a line was
  // clicked). Under them, the states and tools of the variant shown. On top, the variant your
  // requests change, said in words.
  function sideNav(inDrawer: boolean) {
    const cols = columns(), last = Math.max(0, cols.length - 2)
    const at = Math.min(st.pairAt ?? last, last)
    const pair = cols.slice(at, at + 2)
    const lineOf = (c: Col, i: number) => {
      const v = c.kind === 'variants' ? c.p.variants.find(x => x.id === c.sel) : undefined
      const k = c.kind === 'protos' ? c.list.find(x => x.id === c.sel) : undefined
      return `<button data-act="line:${i}" title="Open this level" class="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg px-1.5 text-left hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]">
        <span class="grid size-7 shrink-0 place-items-center rounded-md bg-zinc-900/[.05] text-[11px] font-semibold text-zinc-600 dark:bg-white/[.07] dark:text-zinc-300">${v ? v.id : ic('layers', 'size-3.5 text-zinc-400')}</span>
        <span class="min-w-0 flex-1 leading-tight"><span dir="auto" class="block truncate text-[10px] text-zinc-500">${esc(colName(c))}</span><span class="flex min-w-0 items-center gap-1 font-medium">${v ? `<span dir="auto" class="truncate">${esc(v.name)}</span>${c.kind === 'variants' && v.id === pickOf(c.p) ? ic('check', `size-3 shrink-0 ${PICK}`) : ''}` : k ? `<span dir="auto" class="truncate">${esc(k.title)}</span>` : '<span class="font-normal text-zinc-400">Choose one</span>'}</span></span>
        <span class="shrink-0 text-[10px] tabular-nums text-zinc-400">${colCount(c)}</span>${ic('chev', 'size-3 shrink-0 text-zinc-400')}</button>`
    }
    const box = `<div class="my-1 flex max-h-[26rem] divide-x divide-black/[.06] overflow-hidden rounded-xl ring-1 ring-black/[.08] dark:divide-white/[.07] dark:ring-white/10">${pair.map((c, k) => `<div class="flex min-w-0 flex-1 flex-col pt-0.5 ${k === 0 && pair.length > 1 ? 'bg-zinc-900/[.02] dark:bg-white/[.02]' : ''}">${colHead(c)}<div data-vlist data-k="${esc(colKey(c))}" class="relative min-h-0 flex-1 space-y-px overflow-y-auto overscroll-contain px-1 pb-1.5">${colRows(c)}</div></div>`).join('')}</div>`

    // The variant shown: its states (each opens it in that state) and its tools.
    const p = cur(), pv = st.place.view === 'variant' ? st.place : null
    const v = p && pv ? p.variants.find(x => x.id === pv.variant) : undefined
    let here = ''
    if (p && pv && v) {
      const sts = statesOf(p, v.id), tool = pv.tool
      const lit = tool === 'all' ? null : tool === 'play' ? st.playing : pv.state ?? ''
      const tools = (['play', 'all', 'compare'] as Tool[]).filter(t => toolOk(p, v.id, t))
      const leaf = (x?: State) => {
        const id = x?.id ?? '', on = lit === id, note = x?.about?.[v.id]
        return `<button data-act="pvs:${esc(p.id)}:${v.id}:${esc(id)}" aria-current="${on}" class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${on ? ON : ROWC}">${dot(p, v.id, x, on)}<span class="min-w-0 flex-1"><span class="flex items-center gap-1.5 leading-4 ${on ? 'font-medium text-zinc-900 dark:text-white' : ''}"><span dir="auto" class="truncate">${esc(x?.name ?? 'At rest')}</span>${on && tool === 'play' ? ic('play', 'size-3 text-sky-500') : ''}</span>${note && x ? `<span dir="auto" class="mt-0.5 block text-[10px] leading-[14px] ${noteCls(p, v.id, x)}">${esc(note)}</span>` : ''}</span></button>`
      }
      if (sts.length || tools.length) here = `<div class="mt-3 border-t border-black/[.06] pt-2 dark:border-white/[.07]">
          <div class="flex items-center gap-1 px-1.5 pb-1 text-[10px] font-medium text-zinc-400"><b class="text-zinc-500">${v.id}</b><span dir="auto" class="truncate">${esc(v.name)}</span><span class="ml-auto">${sts.length ? `${sts.length} state${sts.length === 1 ? '' : 's'}` : ''}</span></div>
          ${sts.length ? `<div>${leaf()}${sts.map(leaf).join('')}</div>` : ''}
          ${tools.length ? `<div class="flex flex-wrap gap-1 px-1 pt-1.5">${tools.map(t => `<button data-act="tool:${esc(p.id)}:${v.id}:${t}" aria-pressed="${tool === t}" title="${TOOLS[t].hint}${tool === t ? ' · click to stop' : ''}" class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] ${tool === t ? 'bg-sky-500/15 font-medium text-sky-800 dark:text-sky-200' : 'bg-zinc-900/[.04] text-zinc-600 hover:bg-zinc-900/[.08] dark:bg-white/[.06] dark:text-zinc-300 dark:hover:bg-white/10'}">${ic(TOOLS[t].icon, 'size-3')}${TOOLS[t].name}${t === 'compare' ? `<span class="text-zinc-400">${otherOf(p, v.id)}</span>` : ''}</button>`).join('')}</div>` : ''}
        </div>`
    }

    const initial = esc((session.name.trim()[0] || 'P').toUpperCase())
    return `<div class="flex h-12 shrink-0 items-center gap-2 pl-3 pr-1.5">
        <button data-act="lobby:session" title="Overview of the session" class="flex min-w-0 items-center gap-2"><span class="grid size-5 shrink-0 place-items-center rounded bg-zinc-900 text-[10px] font-bold text-white dark:bg-white dark:text-zinc-900">${initial}</span><span dir="auto" class="truncate font-semibold">${esc(session.name)}</span></button>
        <button data-act="${inDrawer ? 'drawer:0' : 'side:0'}" class="${IB} ml-auto shrink-0" title="${inDrawer ? 'Close' : 'Hide sidebar · ⌘\\'}" aria-label="${inDrawer ? 'Close' : 'Hide sidebar'}">${ic(inDrawer ? 'x' : 'sidebar')}</button>
      </div>
      ${workStrip()}
      <nav data-tree data-k="tree" class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-black/[.06] px-2 py-1.5 text-[12px] dark:border-white/[.07]" aria-label="Prototypes">
        ${cols.slice(0, at).map(lineOf).join('')}${box}${cols.slice(at + 2).map((c, j) => lineOf(c, at + 2 + j)).join('')}
        ${here}
      </nav>
      <div class="flex h-11 shrink-0 items-center gap-1 border-t border-black/[.07] pl-3 pr-1.5 dark:border-white/10">
        <span class="flex min-w-0 items-center gap-2 truncate text-[11px] text-zinc-500">${pulse('size-1.5', st.live && !st.stopped)}${st.stopped ? 'Stopped' : !st.live ? 'Reconnecting…' : st.lastEdit ? `Live · edited <span data-ago="${st.lastEdit}">${ago(st.lastEdit)}</span>` : 'Live'}</span>
        <button data-act="theme:${st.dark ? 'light' : 'dark'}" class="${IB} ml-auto shrink-0" aria-label="Switch to ${st.dark ? 'light' : 'dark'}">${ic(st.dark ? 'sun' : 'moon')}</button>
      </div>`
  }

  // The variant your requests change, in words. On it, it folds out what you asked for; anywhere
  // else, it says so and offers the way back. When Claude just moved it, it says from where.
  function workStrip() {
    const w = workOf()
    if (!w) return ''
    const here = atWork()
    const asks = asksOf(session.work!).slice().reverse()
    const mv = st.moved && refOk(st.moved)
    const picked = (t: string) => /^Picked [A-Z]{1,2}$/.test(t.trim())
    const n = asks.filter(a => !picked(a.text)).length
    return `<div class="mx-2 mb-2 rounded-xl bg-zinc-900/[.04] p-2 text-[12px] dark:bg-white/[.05]">
        <button data-act="work:go" ${here ? 'aria-current="true"' : 'title="Go to it · W"'} class="flex w-full min-w-0 items-center gap-2.5 text-left">
          <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">${w.v.id}</span>
          <span class="min-w-0 flex-1 leading-tight"><span class="flex items-center gap-1.5 text-[10px] text-zinc-500">${here ? 'Your requests change this design' : 'Your requests change'}${editing(w.p.id, w.v.id) ? `<span class="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">${pulse('size-1.5')}editing</span>` : ''}</span>
            <span class="mt-0.5 flex min-w-0 items-center gap-1 font-semibold"><span dir="auto" class="min-w-0 truncate">${esc(w.p.title)}</span><span class="shrink-0 font-normal text-zinc-400">·</span><span class="shrink-0">${w.v.id}</span><span dir="auto" class="min-w-0 truncate">${esc(w.v.name)}</span></span></span>
        </button>
        ${here ? '' : `<button data-act="work:go" class="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-white text-[11px] font-medium shadow-sm ring-1 ring-black/10 hover:bg-zinc-50 dark:bg-zinc-800 dark:ring-white/10 dark:hover:bg-zinc-700">Go to it<span class="font-normal text-zinc-400">· or keep looking here</span><kbd class="ml-1 hidden rounded px-1 font-sans text-[10px] font-normal text-zinc-400 ring-1 ring-inset ring-black/10 [@media(hover:hover)]:inline dark:ring-white/15">W</kbd></button>`}
        ${mv ? `<div class="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500/[.08] px-2 py-1 text-[11px]"><span class="text-amber-600">${ic('from', 'size-3.5')}</span><span class="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">Moved here from <b class="font-semibold">${mv.v.id}</b> · ${bd(mv.v.name)}${mv.p !== w.p ? ` <span class="text-zinc-400">in ${bd(mv.p.title)}</span>` : ''}</span><button data-act="work:undo" class="h-6 shrink-0 rounded-md px-1.5 font-medium text-zinc-900 hover:bg-zinc-900/[.06] dark:text-white dark:hover:bg-white/10">Undo</button></div>` : ''}
        ${asks.length ? `<button data-act="asks" aria-expanded="${st.asks}" class="mt-1.5 flex h-7 w-full items-center gap-1.5 rounded-md px-1 text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white">${ic('clock', 'size-3.5')}${n} change${n === 1 ? '' : 's'} you asked for${ic('chev', `ml-auto size-3.5 transition-transform ${st.asks ? 'rotate-180' : ''}`)}</button>
          ${st.asks ? `<ol class="max-h-48 space-y-1.5 overflow-y-auto overscroll-contain px-1 pb-1 pt-1">${asks.map(a => { const pk = picked(a.text), t = Date.parse(a.at); return `<li class="flex gap-2 text-[11px] leading-[15px]"><span class="mt-px grid size-3.5 shrink-0 place-items-center rounded-full ${pk ? 'bg-emerald-500 text-white' : 'bg-zinc-900/[.08] text-zinc-500 dark:bg-white/10 dark:text-zinc-400'}">${ic('check', 'size-2.5')}</span><span dir="auto" class="min-w-0 flex-1 ${pk ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-700 dark:text-zinc-300'}">${pk ? `You picked ${esc(a.text.trim().slice(7))}` : esc(a.text)}</span>${t ? `<span class="shrink-0 text-[10px] text-zinc-400" data-ago="${t}">${ago(t)}</span>` : ''}</li>` }).join('')}</ol>` : ''}` : ''}
      </div>`
  }

  // ---------- tab icon ----------
  // The skill's icon with the session's initial in a badge that is also the live light (gray once
  // the server is gone).
  let iconKey = ''
  function paintIcon() {
    const initial = esc((session.name.trim()[0] || 'P').toUpperCase())
    const live = st.live && !st.stopped
    if (iconKey === initial + live) return
    iconKey = initial + live
    const svg = tabIcon(initial, live)
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.append(link) }
    link.type = 'image/svg+xml'
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
  }

  // ---------- actions ----------
  /** The same variant without its tool (compare keeps its state; the others go back to rest). */
  const untool = (pl: Place): Place => pl.view === 'variant' ? { view: 'variant', proto: pl.proto, variant: pl.variant, ...(pl.tool === 'compare' && pl.state ? { state: pl.state } : {}) } : pl
  function act(name: string, arg: string, arg2: string, arg3 = '') {
    const p = cur()
    const here = st.place.view === 'variant' ? st.place : null
    switch (name) {
      case 'comment': return arg === 'tap' ? comments.tap() : toggleComment()
      // A state leaf: that variant in that state. Comparing keeps comparing.
      case 'pvs': {
        const keep = here?.tool === 'compare' && here.proto === arg && here.variant === arg2
        return go({ view: 'variant', proto: arg, variant: arg2, ...(arg3 ? { state: arg3 } : {}), ...(keep ? { tool: 'compare' as Tool } : {}) })
      }
      // A tool from a variant's ⋯ menu; choosing the one that is on turns it off.
      case 'tool': {
        st.open = null
        const t = arg3 as Tool
        if (here && here.proto === arg && here.variant === arg2 && here.tool === t) return go(untool(here))
        const state = t === 'compare' && here?.proto === arg && here.variant === arg2 ? here.state : undefined
        return go({ view: 'variant', proto: arg, variant: arg2, tool: t, ...(state ? { state } : {}) })
      }
      case 'vs': if (p) { st.vs.set(p.id, arg); show(false); render() } return
      case 'nextdiff': {
        if (!p || !here) return
        const v = here.variant, o = otherOf(p, v)
        const list = statesOf(p, v).filter(x => changed(p, v, x) || changed(p, o, x))
        if (!list.length) return
        const i = list.findIndex(x => x.id === here.state)
        return go({ ...here, state: list[(i + 1) % list.length].id })
      }
      case 'play': return arg === 'jump' ? layer?.player?.jump(Number(arg2)) : layer?.player?.toggle()
      case 'lobby': return arg === 'session' ? go({ view: 'session' }) : go({ view: 'proto', proto: arg2 || p!.id })
      case 'proto': return openProto(arg)
      case 'pv': return go({ view: 'variant', proto: arg, variant: arg2 })
      // In the columns: a variant (kept open when something was built from it) or a prototype.
      case 'mv': { const q = byId(arg); keepOpen = !!q && kidsOf(q, arg2).length > 0; return go(q ? keepIn(q, arg2) : { view: 'variant', proto: arg, variant: arg2 }) }
      case 'mp': keepOpen = true; return go({ view: 'proto', proto: arg })
      case 'line': st.pairAt = Number(arg); recenter = true; return render()
      case 'drill': st.drill = Number(arg); recenter = true; return render()
      case 'asks': st.asks = !st.asks; return render()
      case 'variant': return go(keepIn(p!, arg))
      case 'step': return step(Number(arg))
      case 'open': st.open = st.open === arg ? null : arg; st.copied = false; recenter = true; if (arg === 'session') refreshStatus(); return render()
      case 'archived': st.archived = !st.archived; return render()
      case 'work': {
        const w = workOf()
        if (arg === 'go') return w && go({ view: 'variant', proto: w.p.id, variant: w.v.id })
        // The page's own moves come back through session.json; they aren't Claude's to undo.
        if (arg === 'undo') { const m = st.moved; st.moved = null; clearTimeout(movedTimer); render(); if (m) { selfMove = true; post('work', { ...m, undo: true }) } return }
        return
      }
      // Wide windows dock the sidebar (remembered); narrower ones open it as a drawer.
      case 'side': recenter = true; if (!wide()) { st.drawer = arg === '1'; return render() } st.side = arg === '1'; localStorage.setItem('proto-side', st.side ? '1' : '0'); return render()
      case 'drawer': st.drawer = arg === '1'; return render()
      case 'menu': st.menu = arg as typeof st.menu; recenter = true; return render()
      case 'stack': st.stack = arg === '1'; localStorage.setItem('proto-lobby', st.stack ? 'stack' : 'grid'); return show(true)
      case 'scale': st.scale = Number(arg); render(); return fit()
      case 'scalestep': st.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(((st.scale || 50) + Number(arg)) / 5) * 5)); render(); return fit()
      case 'theme': return setTheme(arg === 'dark')
      case 'focus': if (st.place.view !== 'variant') return; st.focus = true; st.open = null; dock.hold = performance.now() + 1600; edge.hover = {}; render(); return fit()
      case 'unfocus': st.focus = false; st.open = null; edge.hover = {}; render(); return fit()
      case 'copy': navigator.clipboard?.writeText(session.url || location.href); st.copied = true; return render()
      case 'keep': return post('keep', { keep: !st.status?.keep })
      case 'stop': return post('stop').then(() => { st.stopped = true; render() })
    }
  }

  root.addEventListener('click', e => {
    // Clicks the shell replays inside a design (to reach a state) are the design's business; in
    // a lobby card they would otherwise bubble up to the card and open it.
    if (!e.isTrusted && (e.target as Element).closest('[data-mount]')) return
    const el = (e.target as Element).closest<HTMLElement>('[data-act]')
    if (!el) {
      if (st.open && !(e.target as Element).closest('[data-pop]')) { st.open = null; render() }
      return
    }
    const [name, arg = '', arg2 = '', arg3 = ''] = el.dataset.act!.split(':')
    act(name, arg, arg2, arg3)
  })

  root.addEventListener('input', e => {
    const input = e.target as HTMLInputElement
    // The slider repaints only what shows its value: rebuilding the bar would end the drag.
    if (input.matches('[data-scale-range]')) {
      const v = Number(input.value)
      st.scale = SCALES.find(s => s && Math.abs(s - v) <= 2) ?? v
      input.value = String(st.scale)
      input.style.setProperty('--p', `${rangeAt(st.scale)}%`)
      input.classList.remove('opacity-40')
      syncScale(input)
      return fit()
    }
  })

  addEventListener('keydown', e => {
    const t = e.target as Element
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); return act('side', (wide() ? st.side : st.drawer) ? '0' : '1', '') }
    // Cmd or Ctrl Enter sends what's ready to Claude, from anywhere but a field of the design's own.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.defaultPrevented && comments.counts().drafts && !t.closest?.('input, textarea, select, [contenteditable]')) { e.preventDefault(); void comments.act.send(); return }
    if (e.key === 'Escape') {
      if (tryEsc()) return
      if (comments.escape()) return
      if (card && card.phase !== 'exit') return closeCard()
      if (st.open) { st.open = null; return render() }
      if (st.drawer) { st.drawer = false; return render() }
      if (st.focus) return act('unfocus', '', '')
      if (st.place.view === 'variant' && st.place.tool) return go(untool(st.place))
    }
    if (e.metaKey || e.ctrlKey || e.altKey || st.sheet || t.closest?.(INTERACTIVE)) return
    // Esc on a variant goes up to its prototype's variants, unless the design used it first (a
    // design closing its own menu calls preventDefault). Its handlers may run after this one,
    // so the check waits a tick.
    if (e.key === 'Escape' && st.place.view === 'variant') {
      const from = hashOf(st.place)
      setTimeout(() => { if (!e.defaultPrevented && st.place.view === 'variant' && hashOf(st.place) === from) go({ view: 'proto', proto: st.place.proto }) })
      return
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && st.place.view === 'variant') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1) }
    else if (e.key === 'c' && commentHost()) { e.preventDefault(); toggleComment() }
    else if (e.key === 'f' && st.place.view === 'variant') act(st.focus ? 'unfocus' : 'focus', '', '')
    else if (e.key === 'w' && workOf()) act('work', 'go', '')
  })

  // ---------- resizing the sidebar ----------
  // The grip sits on the sidebar's edge and is never re-rendered, so a drag survives the
  // chrome re-rendering under it (status pings, edits).
  const setSideW = (w: number, save = true) => {
    st.sideW = Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, w)))
    side.style.width = `${st.sideW}px`
    grip.setAttribute('aria-valuenow', String(st.sideW))
    if (save) localStorage.setItem('proto-side-w', String(st.sideW))
  }
  grip.setAttribute('aria-valuemin', String(SIDE_MIN))
  grip.setAttribute('aria-valuemax', String(SIDE_MAX))
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    e.preventDefault()
    grip.setPointerCapture(e.pointerId)
    grip.dataset.dragging = ''
    document.documentElement.style.cursor = 'col-resize'
    const left = side.getBoundingClientRect().left
    const move = (m: PointerEvent) => setSideW(m.clientX - left, false)
    const end = () => {
      grip.removeEventListener('pointermove', move)
      delete grip.dataset.dragging
      document.documentElement.style.cursor = ''
      setSideW(st.sideW)
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('lostpointercapture', end, { once: true })
  })
  grip.addEventListener('dblclick', () => setSideW(SIDE_W))
  grip.addEventListener('keydown', e => {
    const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0
    if (d) { e.preventDefault(); setSideW(st.sideW + d) }
  })

  // ---------- Try it: what the design on the stage says a reviewer needs ----------
  // Docked at the stage's right edge on a wide screen, so the design narrows instead of being
  // covered; a sheet over the design on a narrow one; closed, a tab on the edge. Shown for one
  // variant on the stage (not lobbies or tools), and never in proto shoot (?hints=0), so shots
  // keep the design at its full width.
  const HINTS_W = 264
  const wideMq = matchMedia('(min-width: 1024px)')
  let hintsOpen = wideMq.matches && localStorage.getItem('proto-hints') !== '0'
  let hintSaid = '', hintCopied = -1, hintTimer = 0, hintsDocked = false
  const hintHost = () => st.place.view === 'variant' && !st.place.tool ? layer?.el.querySelector<HTMLElement>('[data-mount]') ?? null : null
  const hintList = () => q.get('hints') === '0' ? [] : hints.of(hintHost())
  const valueOf = (h: Extract<Hint, { kind: 'value' }>) => { try { return String(typeof h.value === 'function' ? h.value() : h.value) } catch { return '' } }
  const flash = () => { clearTimeout(hintTimer); hintTimer = window.setTimeout(() => { hintSaid = ''; hintCopied = -1; paintHints() }, 1400) }

  // ---------- comments ----------
  // Commenting lives in the stage's own layer (comments/), over a variant on the page and nowhere
  // else: not a lobby, not a tool (all states, compare, autoplay), not focus mode, not a shot.
  const phoneMq = matchMedia('(max-width: 639px)')
  const HANDLE = 'flex h-9 items-center gap-1.5 rounded-l-lg bg-white/95 pl-2.5 pr-3 text-xs font-medium text-zinc-900 shadow-lg shadow-black/10 ring-1 ring-black/10 backdrop-blur hover:bg-white dark:bg-zinc-900/95 dark:text-zinc-100 dark:ring-white/15 dark:hover:bg-zinc-900'
  const commentHost = () => !st.focus && q.get('hints') !== '0' ? hintHost() : null
  // The side panel carries the list; a phone has it as a sheet from the pill.
  const railOn = () => !!commentHost() && !phoneMq.matches
  const comments = createComments({
    layer: zone.querySelector<HTMLElement>('[data-comments]')!,
    mount: commentHost,
    go: (proto, variant, state) => go({ view: 'variant', proto, variant, ...(state ? { state } : {}) }),
    send: sendBatch,
    dark: () => st.dark,
  }, session.id)
  const commentsKeyOf = () => { const c = comments.counts(); return JSON.stringify([c.drafts, c.total, c.picking, c.held, [...c.by]]) }
  let commentsKey = commentsKeyOf()
  const pillComments = () => commentHost() ? commentsKeyOf() : ''
  /** Open (not yet done) comments on a variant, as a count in the tree. */
  const openComments = (proto: string, variant: string) => {
    const n = comments.counts().by.get(`${proto}/${variant}`) ?? 0
    return n ? `<span title="${n} open comment${n === 1 ? '' : 's'}" class="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-proto-primary-soft px-1 text-[10px] font-semibold tabular-nums text-proto-primary-soft-fg">${n}</span>` : ''
  }
  const mac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
  const commentBtn = () => {
    if (!commentHost()) return ''
    const on = comments.counts().picking
    // At rest an icon; while you are picking what to comment on, it says so, and how to stop.
    return `<button data-act="comment:toggle" data-shoot="comment" aria-pressed="${on}" aria-label="Comment" title="${on ? 'Stop commenting · Esc' : `Comment on the design · C (${mac ? '⌥' : 'Alt'}-click comments on one thing)`}" class="hidden h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg text-xs font-medium sm:inline-flex ${on ? 'bg-proto-primary px-2.5 text-proto-primary-fg hover:bg-proto-primary-hover' : 'text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white'}">${ic('comment')}${on ? 'Click to comment<kbd class="rounded bg-white/20 px-1 font-sans text-[11px]">Esc</kbd>' : ''}</button>`
  }
  let seenInbox: Inbox | undefined
  /** Tells the comment layer where the page is and what the server says; repaints the chrome that shows counts. */
  function syncComments() {
    const host = commentHost(), pl = st.place, p = cur()
    comments.setPlace(host && pl.view === 'variant' && p ? { proto: pl.proto, variant: pl.variant, ...(pl.state ? { state: pl.state } : {}), phone: phoneMq.matches, title: p.title } : null)
    if (st.status?.inbox !== seenInbox) { seenInbox = st.status?.inbox; comments.setInbox(seenInbox) }
    zone.toggleAttribute('data-picking', !!host && comments.counts().picking)
  }
  comments.mountSheet(root.querySelector<HTMLElement>('[data-comments-sheet]')!)
  // The chrome shows counts (the bar's button, the pill, the tree): repaint it when they change.
  comments.store.subscribe(() => {
    const k = commentsKeyOf()
    if (k === commentsKey) return
    commentsKey = k
    render()
  })
  phoneMq.addEventListener('change', () => paintHints())

  // ---------- the side panel: comments, and Try it ----------
  // One panel, two tabs. Docked it narrows the stage; narrower it is a sheet over the design;
  // closed, a handle per tab on the edge (above the phone's pill). The comments tab is a React
  // root made once: the panel's frame is made once too, and only the Try it body and the tab
  // strip are repainted, so nothing the comment list is showing is ever rebuilt under it.
  hintBox.innerHTML = `<div data-handles></div>
    <div data-panel role="complementary" class="absolute inset-y-0 right-0 z-20 hidden flex-col bg-white text-[13px] text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div data-tabs class="flex h-11 shrink-0 items-center gap-0.5 border-b border-black/[.07] pl-1.5 pr-1 dark:border-white/10"></div>
      <div data-try class="min-h-0 flex-1 overflow-y-auto overscroll-contain" hidden></div>
      <div data-cbody class="min-h-0 flex-1" hidden></div>
      <div data-caveats></div>
    </div>`
  const handles = hintBox.querySelector<HTMLElement>('[data-handles]')!
  const panel = hintBox.querySelector<HTMLElement>('[data-panel]')!
  const tabsEl = hintBox.querySelector<HTMLElement>('[data-tabs]')!
  const tryEl = hintBox.querySelector<HTMLElement>('[data-try]')!
  const cbody = hintBox.querySelector<HTMLElement>('[data-cbody]')!
  const caveatEl = hintBox.querySelector<HTMLElement>('[data-caveats]')!
  let tab: 'comments' | 'try' = 'comments'
  comments.mountRail(cbody)

  function paintHints() { syncComments(); paintPanel(); syncSpot() }
  // Starting to comment opens the Comments tab beside the design, where the new one lands. Only
  // where the panel docks: narrower, it would cover what you're about to click on.
  function toggleComment() {
    comments.act.toggle()
    if (!comments.counts().picking || !railOn() || !wideMq.matches) return
    tab = 'comments'
    if (!hintsOpen) { hintsOpen = true; localStorage.setItem('proto-hints', '1') }
    paintHints()
  }
  function paintPanel() {
    const list = hintList()
    const tabs: ('comments' | 'try')[] = [...(railOn() ? ['comments' as const] : []), ...(list.length ? ['try' as const] : [])]
    const docked = tabs.length > 0 && hintsOpen && wideMq.matches
    zone.style.setProperty('--hw', docked ? `${HINTS_W}px` : '0px')
    if (docked !== hintsDocked) { hintsDocked = docked; requestAnimationFrame(fit) }
    if (!tabs.length) { panel.className = 'hidden'; handles.innerHTML = ''; tryEl.innerHTML = ''; return }
    if (!tabs.includes(tab)) tab = tabs[0]
    const count = list.filter(h => h.kind !== 'caveat').length
    const c = comments.counts()
    if (!hintsOpen) {
      panel.className = 'hidden'
      handles.innerHTML = `<div class="absolute bottom-[calc(var(--pill-h,0px)+1rem)] right-0 z-20 flex flex-col items-end gap-2">
        ${tabs.includes('comments') ? `<button data-hint="open:comments" title="Comments on this design · C" class="${HANDLE}">${ic('comment', 'size-3.5 text-proto-primary-ring')}Comments${c.total ? `<span class="tabular-nums text-zinc-400">${c.total}</span>` : ''}</button>` : ''}
        ${tabs.includes('try') ? `<button data-hint="open:try" title="What to type and try in this design" class="${HANDLE}">${ic('key', 'size-3.5 text-amber-500')}Try it<span class="tabular-nums text-zinc-400">${count}</span></button>` : ''}
      </div>`
      tryEl.innerHTML = ''
      return
    }
    handles.innerHTML = ''
    const wide = wideMq.matches
    panel.className = `absolute inset-y-0 right-0 z-20 flex flex-col bg-white text-[13px] text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 ${wide ? 'border-l border-black/[.07] dark:border-white/10' : 'w-[min(18rem,88%)] shadow-2xl shadow-black/30'}`
    panel.style.width = wide ? `${HINTS_W}px` : ''
    const tabBtn = (t: 'comments' | 'try') => {
      const on = tab === t, n = t === 'comments' ? c.total : count
      return `<button data-hint="tab:${t}" aria-pressed="${on}" class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${on ? 'bg-zinc-900/[.06] text-zinc-900 dark:bg-white/10 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}">${ic(t === 'comments' ? 'comment' : 'key', `size-3.5 ${t === 'try' ? 'text-amber-500' : on ? 'text-proto-primary-ring' : ''}`)}${t === 'comments' ? 'Comments' : 'Try it'}${n ? `<span class="tabular-nums text-zinc-400">${n}</span>` : ''}</button>`
    }
    const canFill = tab === 'try' && list.some(h => h.kind === 'value' && h.fill)
    tabsEl.innerHTML = `${tabs.map(tabBtn).join('')}<span class="ml-auto"></span>
      ${canFill ? `<button data-hint="fill" title="Type the values into this design's fields" class="inline-flex h-7 items-center gap-1.5 rounded-md bg-zinc-900 px-2.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">${ic(hintSaid === 'Filled' ? 'check' : 'fill', 'size-3.5')}${hintSaid || 'Fill in'}</button>` : ''}
      <button data-hint="close" class="${IB} h-7 min-w-7 px-1" aria-label="Close panel" title="Close">${ic(wide ? 'right' : 'x', 'size-3.5')}</button>`
    cbody.hidden = tab !== 'comments'
    tryEl.hidden = tab !== 'try'
    if (tab !== 'try') { tryEl.innerHTML = ''; caveatEl.innerHTML = ''; return }
    const all = list.map((h, i) => ({ h, i }))
    const pick = <K extends Hint['kind']>(k: K) => all.filter(x => x.h.kind === k) as { h: Extract<Hint, { kind: K }>; i: number }[]
    const values = pick('value'), tries = pick('try'), switches = pick('switch'), events = pick('event'), caveats = pick('caveat')
    const sec = (name: string, body: string, meta = '') => `<section class="border-b border-black/[.05] p-1 last:border-b-0 dark:border-white/[.07]"><h3 class="flex px-2 pb-0.5 pt-1 text-[11px] font-medium text-zinc-400">${bd(name)}<span class="ml-auto font-normal tabular-nums">${meta}</span></h3>${body}</section>`
    const value = ({ h, i }: { h: Extract<Hint, { kind: 'value' }>; i: number }) => `<button data-hint="copy:${i}" title="Copy ${esc(h.label.toLowerCase())}" class="group/h flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]">
        <span dir="auto" class="w-[4.5rem] shrink-0 pt-px text-[11px] leading-4 text-zinc-500">${esc(h.label)}</span>
        <span class="min-w-0 flex-1"><span ${typeof h.value === 'function' ? `data-live="${i}" ` : ''}dir="auto" class="block break-all font-mono text-[12px] leading-[18px] text-zinc-900 dark:text-zinc-100">${esc(valueOf(h))}</span>${h.note ? `<span dir="auto" class="block text-[11px] leading-4 text-zinc-400">${esc(h.note)}</span>` : ''}</span>
        <span class="grid size-5 shrink-0 place-items-center ${hintCopied === i ? 'text-emerald-500' : 'text-zinc-400 opacity-0 group-hover/h:opacity-100 [@media(hover:none)]:opacity-100'}">${ic(hintCopied === i ? 'check' : 'copy', 'size-3.5')}</span></button>`
    // A thing with a spot on the page answers pointing, focus and a tap (see the spotlight below).
    const tryRow = ({ h, i }: { h: Extract<Hint, { kind: 'try' }>; i: number }) => {
      const tick = `<span class="mt-px grid size-4 shrink-0 place-items-center rounded-full ${h.done ? 'bg-emerald-500 text-white' : 'ring-1 ring-inset ring-zinc-300 dark:ring-zinc-600'}">${h.done ? ic('check', 'size-3') : ''}</span>`
      const text = `<span dir="auto" class="${showable(h) ? 'block' : 'min-w-0 flex-1'} text-[12.5px] leading-[18px] ${h.done ? 'text-zinc-400 line-through decoration-zinc-300 dark:decoration-zinc-600' : ''}">${esc(h.text)}</span>`
      if (!showable(h)) return `<div class="flex items-start gap-2 px-2 py-1.5">${tick}${text}</div>`
      return `<div data-try-row="${i}" tabindex="0" title="Show where on the page" class="group/t flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 data-on:bg-amber-400/[.12] not-data-on:hover:bg-zinc-900/[.04] dark:not-data-on:hover:bg-white/[.06]">${tick}<span class="min-w-0 flex-1">${text}<span class="hidden text-[11px] leading-4 text-zinc-400 group-data-gone/t:block">Not on the page right now</span></span>${showIcon('mt-0.5 text-zinc-400 opacity-0 transition-opacity group-hover/t:opacity-100 group-data-on/t:text-amber-500 group-data-on/t:opacity-100')}</div>`
    }
    const switchRow = ({ h, i }: { h: Extract<Hint, { kind: 'switch' }>; i: number }) => `<div class="flex flex-wrap gap-1 px-2 py-1">${h.options.map((o, j) => `<button data-hint="switch:${i}:${j}" aria-pressed="${o === h.value}" class="h-7 rounded-md px-2.5 text-xs ${o === h.value ? 'bg-zinc-900 font-medium text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-900/[.04] text-zinc-600 hover:bg-zinc-900/[.08] dark:bg-white/[.06] dark:text-zinc-300 dark:hover:bg-white/10'}">${bd(o)}</button>`).join('')}</div>`
    const eventRow = ({ h, i }: { h: Extract<Hint, { kind: 'event' }>; i: number }) => `<button data-hint="event:${i}" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-zinc-900/[.04] dark:hover:bg-white/[.06]">${ic('bolt', 'size-3.5 text-amber-500')}${bd(h.label)}</button>`
    tryEl.innerHTML = `${values.length ? sec('To type', values.map(value).join('')) : ''}
        ${tries.length ? sec('Things to try', tries.map(tryRow).join(''), `${tries.filter(x => x.h.done).length}/${tries.length}`) : ''}
        ${switches.map(x => sec(x.h.label, switchRow(x))).join('')}
        ${events.length ? sec('Make it happen', events.map(eventRow).join('')) : ''}`
    caveatEl.innerHTML = caveats.length ? `<div class="shrink-0 border-t border-black/[.06] px-3 py-2 text-[11px] leading-4 text-zinc-500 dark:border-white/10">${caveats.map(x => `<p dir="auto">${esc(x.h.text)}</p>`).join('')}</div>` : ''
  }
  hints.subscribe(paintHints)
  wideMq.addEventListener('change', () => { hintsOpen = wideMq.matches && localStorage.getItem('proto-hints') !== '0'; paintHints() })
  // A live value (a code that changes every 30 seconds) is re-read every second, in place.
  setInterval(() => {
    const list = hintList()
    for (const el of hintBox.querySelectorAll<HTMLElement>('[data-live]')) { const h = list[Number(el.dataset.live)]; if (h?.kind === 'value') el.textContent = valueOf(h) }
  }, 1000)
  hintBox.addEventListener('click', e => {
    const row = (e.target as Element).closest<HTMLElement>('[data-try-row]')
    if (row) {
      setTry(Number(row.dataset.tryRow), 'tap', 4000)
      if (!wideMq.matches) { hintsOpen = false; paintHints() }
      return
    }
    const b = (e.target as Element).closest<HTMLElement>('[data-hint]')
    if (!b) return
    const [what, a, c] = b.dataset.hint!.split(':'), list = hintList(), h = list[Number(a)]
    try {
      if (what === 'tab') tab = a as typeof tab
      else if (what === 'open' || what === 'close') { if (what === 'open' && (a === 'comments' || a === 'try')) tab = a; hintsOpen = what === 'open'; if (!hintsOpen) setTry(null); if (wideMq.matches) localStorage.setItem('proto-hints', hintsOpen ? '1' : '0') }
      else if (what === 'copy' && h?.kind === 'value') { navigator.clipboard?.writeText(valueOf(h)); hintCopied = Number(a); flash() }
      else if (what === 'fill') {
        const host = hintHost()
        const filled = list.filter(x => {
          if (x.kind !== 'value' || !x.fill) return false
          let el: Element | null = null
          try { el = host?.querySelector(x.fill) ?? null } catch { /* a bad selector: nothing to fill */ }
          return !!el && fillField(el, valueOf(x))
        }).length
        hintSaid = filled ? 'Filled' : 'No field here'
        flash()
      }
      else if (what === 'switch' && h?.kind === 'switch') h.set(h.options[Number(c)])
      else if (what === 'event' && h?.kind === 'event') h.run()
    } catch (err) { console.error('[prototype] a hint failed:', err) }
    paintHints()
  })

  // Pointing at a thing to try lights where it happens on the design (spotlight.ts). Hovering
  // a row shows it after a short wait (so running down the list doesn't flash it), and it
  // stays 1.5 s after the pointer leaves, so it survives the trip to the spot. Focus shows it
  // too; a click or a tap keeps it 4 s (touch has no hover) and moves a sheet over the design
  // out of the way. Doing it, pressing on the design, Esc or another page puts it away; a thing
  // done in steps stays lit through them, for 8 s, so its light can move to the next step.
  const spot = createSpotlight(zone.querySelector<HTMLElement>('[data-spot]')!)
  let tryOn: { i: number; via: 'hover' | 'focus' | 'tap'; host: HTMLElement; done: boolean } | null = null
  let tryTimer = 0
  // A thing just done stays dark while the pointer is still on its row: the panel redraws
  // under the pointer, and the browser's hover on the new row would light it again.
  let tryQuiet = -1
  const tryAt = (i: number) => { const h = hintList()[i]; return h?.kind === 'try' && showable(h) ? h : null }
  function setTry(i: number | null, via: 'hover' | 'focus' | 'tap' = 'hover', ms = 0) {
    clearTimeout(tryTimer)
    const host = hintHost(), h = i === null ? null : tryAt(i)
    tryOn = i !== null && host && h ? { i, via, host, done: !!h.done } : null
    if (tryOn && ms) tryTimer = window.setTimeout(() => setTry(null), ms)
    syncSpot()
  }
  function syncSpot() {
    const host = hintHost(), h = tryOn ? tryAt(tryOn.i) : null
    if (tryOn && (!h || host !== tryOn.host || (h.done && !tryOn.done))) { clearTimeout(tryTimer); if (h?.done) tryQuiet = tryOn.i; tryOn = null }
    if (tryOn && host && h) spot.show(host, h, String(tryOn.i)); else spot.hide()
    for (const r of hintBox.querySelectorAll<HTMLElement>('[data-try-row]')) {
      const on = tryOn?.i === Number(r.dataset.tryRow)
      r.toggleAttribute('data-on', on)
      r.toggleAttribute('data-gone', on && !!host && !!h && whereIs(host, h, zone) === 'gone')
    }
  }
  function tryEsc() { if (!tryOn) return false; setTry(null); return true }
  hintBox.addEventListener('pointerover', e => {
    const r = e.pointerType === 'mouse' && (e.target as Element).closest<HTMLElement>('[data-try-row]')
    if (!r) return
    const i = Number(r.dataset.tryRow)
    if (tryOn?.i === i || tryQuiet === i) return
    clearTimeout(tryTimer)
    if (tryOn) setTry(i)
    else tryTimer = window.setTimeout(() => setTry(i), 120)
  })
  hintBox.addEventListener('pointerout', e => {
    const r = e.pointerType === 'mouse' && (e.target as Element).closest('[data-try-row]')
    if (!r || r.contains(e.relatedTarget as Node | null)) return
    tryQuiet = -1
    if (!tryOn) clearTimeout(tryTimer)
    else if (tryOn.via === 'hover') { clearTimeout(tryTimer); tryTimer = window.setTimeout(() => setTry(null), 1500) }
  })
  hintBox.addEventListener('focusin', e => {
    const r = (e.target as Element).closest<HTMLElement>('[data-try-row]')
    if (r && tryOn?.via !== 'tap') setTry(Number(r.dataset.tryRow), 'focus')
  })
  hintBox.addEventListener('focusout', e => {
    if ((e.target as Element).closest('[data-try-row]') && tryOn?.via === 'focus') setTry(null)
  })
  layers.addEventListener('pointerdown', () => {
    if (!tryOn) return
    if (tryAt(tryOn.i)?.steps?.length) { clearTimeout(tryTimer); tryOn.via = 'tap'; tryTimer = window.setTimeout(() => setTry(null), 8000) }
    else setTry(null)
  }, true)

  // ---------- theme, status, server ----------
  function setTheme(dark: boolean) {
    st.dark = dark
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    localStorage.setItem('proto-theme', dark ? 'dark' : 'light')
    render()
  }
  // The lobby is drawn once per visit, so its lifecycle line is updated in place.
  const paintLifecycle = () => layers.querySelectorAll('[data-lifecycle]').forEach(el => { el.textContent = lifecycle() })
  async function refreshStatus() {
    try {
      st.status = await (await fetch('/__proto/status')).json()
      if (st.status!.lastEdit > st.lastEdit) st.lastEdit = st.status!.lastEdit
      render()
      paintLifecycle()
    } catch { /* the server is gone; the live dot already says so */ }
  }
  async function post(path: string, body: unknown = {}) {
    try {
      const res = await fetch(`/__proto/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (path !== 'stop') { st.status = await res.json(); render(); paintLifecycle() }
    } catch { /* see refreshStatus */ }
  }
  /** Sends comments to the session's agent. Resolves to the batch's id; throws with the server's reason. */
  async function sendBatch(batch: CommentBatch): Promise<string> {
    const res = await fetch('/__proto/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: st.dark ? 'dark' : 'light', ...batch }) })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `the server answered ${res.status}`)
    st.status = body
    render()
    return body.sent
  }
  // While the page is open and visible it counts as activity, so the server isn't stopped
  // as idle under someone who is looking at it.
  const ping = () => { if (document.visibilityState === 'visible' && !st.stopped) post('ping') }
  setInterval(ping, 60_000)
  document.addEventListener('visibilitychange', ping)
  setInterval(() => document.querySelectorAll<HTMLElement>('[data-ago]').forEach(el => { el.textContent = ago(Number(el.dataset.ago)) }), 1000)

  // ---------- boot ----------
  installPointerTracking()
  setTheme(st.dark)
  // The link opens where it points; a bare link reopens where this browser last was.
  const start = parseHash() ?? parseHash(localStorage.getItem(`proto-place-${session.id}`) ?? '') ?? defaultPlace()
  if (location.hash !== hashOf(start)) history.replaceState(null, '', hashOf(start))
  arrive(start, false)
  if (q.has('focus')) act('focus', '', '')
  refreshStatus()
  Promise.all([document.fonts.ready, Promise.race([(layer as Layer | null)?.ready, wait(5000)])]).then(() => requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1' })))

  let editTimer = 0, movedTimer = 0, selfMove = false
  return {
    // New prototypes and new variants are followed; edits to existing ones only light the
    // editing dot, so the view never jumps while someone is looking at something.
    setProtos(next: Proto[]) {
      const before = new Map(protos.map(p => [p.id, new Set(p.variants.map(v => v.id))]))
      protos = next
      const fresh = next.filter(p => !p.archived && !before.has(p.id))
      const grown = next.map(p => ({ p, added: before.has(p.id) ? p.variants.filter(v => !before.get(p.id)!.has(v.id)) : [] })).filter(x => x.added.length)
      if (fresh.length) return go({ view: 'proto', proto: fresh.at(-1)!.id })
      const here = st.place.view === 'proto' ? st.place.proto : null
      const g = grown.find(x => x.p.id !== here)
      if (g) return go(g.added.length === 1 ? { view: 'variant', proto: g.p.id, variant: g.added[0].id } : { view: 'proto', proto: g.p.id })
      if (!valid(st.place)) return go(defaultPlace())
      // Same place, new modules (a meta edit or a re-evaluated file): swap without a fade. A
      // variant that failed to load gets another try with the fresh registry.
      const refs = refsFor(st.place)
      if (!layer || failed.size || refs.length !== layer.refs.length || refs.some((r, i) => r !== layer!.refs[i])) show(false)
      render()
    },
    /** Whether this file's module is in use on the page (loaded, or failed and waiting for a fix). */
    shows: (file: string) => loaded.has(file) || failed.has(file),
    replaceVariant(file: string, component: unknown) {
      const nameOf = (c: any) => c?.displayName || c?.__name || c?.name || ''
      const old = loaded.get(file)
      const broken = failed.delete(file)
      loaded.set(file, component)
      updates++
      if (broken || (old !== component && nameOf(old) !== nameOf(component))) show(false)
      reloadIfStale()
    },
    // A working variant Claude moved shows where it came from, with Undo, for a few seconds.
    setSession(next: Session) {
      const was = session.work
      session = next
      if (!same(was, next.work)) {
        if (was && next.work && !selfMove && refOk(was)) {
          st.moved = { proto: was.proto, variant: was.variant }
          clearTimeout(movedTimer)
          movedTimer = window.setTimeout(() => { st.moved = null; render() }, 8000)
        }
        selfMove = false
      }
      render()
    },
    setLive(live: boolean) { st.live = live; render() },
    setInbox(inbox: Inbox) { if (st.status) { st.status = { ...st.status, inbox }; render() } },
    sendComments: sendBatch,
    edited(paths: string[]) {
      let retrying = false
      for (const path of paths) {
        if (!path.includes('/src/protos/')) continue
        if (failed.has(path)) { failed.delete(path); retry.set(path, Date.now()); retrying = true }
        st.lastEdit = Date.now()
        const m = path.match(/\/src\/protos\/([^/]+)\/([A-Z]{1,2})\.\w+/)
        if (m) st.editing = { proto: m[1], variant: m[2] }
      }
      if (retrying) show(false)
      render()
      clearTimeout(editTimer)
      editTimer = window.setTimeout(() => { st.editing = null; render() }, 10_000)
    },
  }
}

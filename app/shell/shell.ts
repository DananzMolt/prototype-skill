// The session shell: breadcrumbs whose names open lobbies and whose chevrons jump, variant
// tabs, edge arrows, focus mode with a growing dock, and a crossfade between designs.
//
// One rule holds it together: the chrome re-renders freely, the designs never do. Each
// place (session lobby, prototype lobby, one variant) is a layer with its components
// mounted once; moving somewhere builds a new layer under the old one and fades the old
// one out. Live edits reach the mounted components through the framework's own HMR.

import { ic, esc, ON, TAB_ON, TAB_OFF, IB, SEP, pulse, pop, item, ago, clock } from './ui'
import { dock, edge, smooth, runDock, restoreEdgeLabels, stageHover, canHover, installPointerTracking, fadeOut } from './motion'

export type Variant = { id: string; name: string; component: unknown; file: string }
export type Proto = { id: string; title: string; ask: string; kind: 'web' | 'phone'; created: string; archived: boolean; variants: Variant[] }
export type Session = { id: string; name: string; path: string; createdAt: string; url?: string; localUrl?: string }
type Mount = (el: HTMLElement, component: any) => () => void
type Place = { view: 'session' } | { view: 'proto'; proto: string } | { view: 'variant'; proto: string; variant: string }
type Layer = { el: HTMLElement; refs: unknown[]; dispose: () => void }
type Status = { lastEdit: number; keep: boolean; idleHours: number; deleteDays: number }

const PHONE = 'shrink-0 overflow-hidden rounded-[55px] border-[10px] border-zinc-900 bg-white text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-black dark:text-white'
const INTERACTIVE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="listbox"], [role="menu"]'

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
    scale: 0,
    stack: q.has('stack') ? q.get('stack') !== '0' : localStorage.getItem('proto-lobby') === 'stack',
    dark: q.get('theme') ? q.get('theme') === 'dark' : stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches,
    copied: false,
    live: true,
    stopped: false,
    lastEdit: 0,
    editing: null as null | { proto: string; variant: string },
    status: null as Status | null,
  }

  // ---------- data helpers ----------
  const active = () => protos.filter(p => !p.archived)
  const archived = () => protos.filter(p => p.archived)
  const byId = (id: string) => protos.find(p => p.id === id)
  const editing = (p: string, v?: string) => !!st.editing && st.editing.proto === p && (!v || st.editing.variant === v)
  const cur = () => (st.place.view === 'session' ? undefined : byId(st.place.proto))
  const hashOf = (p: Place) => p.view === 'session' ? '#/' : p.view === 'proto' ? `#/${p.proto}` : `#/${p.proto}/${p.variant}`
  const valid = (p: Place): boolean => {
    if (p.view === 'session') return true
    const proto = byId(p.proto)
    return !!proto && (p.view === 'proto' || proto.variants.some(v => v.id === p.variant))
  }
  const parseHash = (hash = location.hash): Place | null => {
    const [proto, variant] = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
    const p: Place = !proto ? { view: 'session' } : !variant ? { view: 'proto', proto } : { view: 'variant', proto, variant }
    return hash && valid(p) ? p : null
  }
  const defaultPlace = (): Place => {
    const newest = active().at(-1)
    return newest ? { view: 'proto', proto: newest.id } : { view: 'session' }
  }

  // ---------- skeleton ----------
  root.innerHTML = `<div class="flex h-dvh flex-col bg-white text-[13px] text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    <header data-bar class="relative z-30 flex h-12 shrink-0 items-center gap-1 border-b border-black/[.07] px-2 dark:border-white/10"></header>
    <div data-tabs></div>
    <div data-zone>
      <div data-layers class="absolute inset-0"></div>
      <div data-overlay></div>
    </div>
  </div>`
  const bar = root.querySelector<HTMLElement>('[data-bar]')!
  const tabs = root.querySelector<HTMLElement>('[data-tabs]')!
  const zone = root.querySelector<HTMLElement>('[data-zone]')!
  const layers = root.querySelector<HTMLElement>('[data-layers]')!
  const overlay = root.querySelector<HTMLElement>('[data-overlay]')!

  // ---------- layers ----------
  let layer: Layer | null = null

  const refsFor = (p: Place): unknown[] => {
    if (p.view === 'session') return newestFirst().flatMap(q => [q.id, q.title, ...q.variants.slice(0, 1).flatMap(v => [v.component, v.name])])
    const proto = byId(p.proto)!
    if (p.view === 'proto') return [st.stack, proto.title, proto.kind, ...proto.variants.flatMap(v => [v.id, v.name, v.component])]
    const v = proto.variants.find(v => v.id === p.variant)!
    return [proto.kind, v.component]
  }

  const thumb = (proto: Proto, aspect: string) => `<div data-thumb class="relative w-full overflow-hidden bg-white dark:bg-zinc-950 ${aspect}"><div inert class="pointer-events-none overflow-hidden ${proto.kind === 'phone' ? 'flex items-center justify-center bg-zinc-100 dark:bg-zinc-900' : ''} [contain:layout_paint]" style="width:1200px;height:750px">${proto.kind === 'phone' ? `<div class="${PHONE}" style="width:393px;height:852px;zoom:.78"><div data-mount class="h-full overflow-hidden"></div></div>` : '<div data-mount class="h-full"></div>'}</div></div>`

  function buildLayer(p: Place): Layer {
    // The outer box doesn't scroll and is the containing block for the design's own
    // position:fixed (drawers, sheets, toasts), so they stay on the stage, pinned, instead
    // of covering the shell. The inner box scrolls.
    const el = document.createElement('div')
    el.className = 'absolute inset-0 [contain:layout_paint]'
    const unmounts: (() => void)[] = []
    const mountAll = (list: Variant[]) => el.querySelectorAll<HTMLElement>('[data-mount]').forEach((host, i) => unmounts.push(mount(host, list[i].component)))
    let inner = ''
    if (p.view === 'variant') {
      const proto = byId(p.proto)!
      inner = proto.kind === 'phone'
        ? `<div data-phones class="flex min-h-full items-center justify-center p-6"><div data-phone class="${PHONE} [contain:layout_paint]" style="width:393px;height:852px"><div data-mount class="h-full overflow-y-auto"></div></div></div>`
        : '<div data-mount class="h-full"></div>'
    } else inner = p.view === 'proto' ? protoLobby(byId(p.proto)!) : sessionLobby()
    el.innerHTML = `<div class="h-full overflow-auto">${inner}</div>`
    if (p.view === 'variant') { const proto = byId(p.proto)!; mountAll([proto.variants.find(v => v.id === p.variant)!]) }
    else if (p.view === 'proto') mountAll(byId(p.proto)!.variants)
    else mountAll(newestFirst().flatMap(q => q.variants.slice(0, 1)))
    return { el, refs: refsFor(p), dispose: () => unmounts.forEach(u => { try { u() } catch { /* already gone */ } }) }
  }

  function show(fade: boolean) {
    const next = buildLayer(st.place)
    const prev = layer
    layer = next
    layers.prepend(next.el)
    if (prev) {
      const drop = () => { prev.el.remove(); prev.dispose() }
      fade ? fadeOut(prev.el, drop) : drop()
    }
    fit()
  }

  function fit() {
    for (const t of layers.querySelectorAll<HTMLElement>('[data-thumb]')) if (t.clientWidth) (t.firstElementChild as HTMLElement).style.zoom = String(t.clientWidth / 1200)
    if (!layer) return
    const box = layer.el
    box.style.setProperty('--stage-h', `${box.clientHeight}px`)
    const auto = [100, 75, 50].find(s => 872 * s / 100 <= box.clientHeight - 48 && 413 * s / 100 <= box.clientWidth - 24) ?? 40
    for (const phone of box.querySelectorAll<HTMLElement>('[data-phone]')) phone.style.zoom = String((st.scale || auto) / 100)
  }
  new ResizeObserver(fit).observe(zone)

  // ---------- navigation ----------
  function go(p: Place) {
    if (!valid(p)) p = defaultPlace()
    if (location.hash !== hashOf(p)) location.hash = hashOf(p)
    else arrive(p, true)
  }
  function arrive(p: Place, fade: boolean) {
    const moved = JSON.stringify(p) !== JSON.stringify(st.place) || !layer
    st.place = p
    st.open = null
    if (p.view !== 'variant') st.focus = false
    localStorage.setItem(`proto-place-${session.id}`, hashOf(p))
    if (moved) show(fade && !!layer)
    render()
  }
  addEventListener('hashchange', () => arrive(parseHash() ?? defaultPlace(), true))

  function step(d: number) {
    const proto = cur()
    if (!proto || !proto.variants.length) return
    const ids = proto.variants.map(v => v.id)
    const i = st.place.view === 'variant' ? ids.indexOf(st.place.variant) : -1
    go({ view: 'variant', proto: proto.id, variant: ids[(i + d + ids.length) % ids.length] })
  }
  const openProto = (id: string) => {
    const proto = byId(id)!
    const v = editing(id) ? st.editing!.variant : proto.variants[0]?.id
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
  const GRID = 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4'

  function sessionLobby() {
    const list = newestFirst()
    if (!list.length) return `<div class="grid min-h-full place-items-center p-8 text-center"><div><div class="mx-auto mb-4 grid size-10 place-items-center">${pulse('size-2.5', st.live)}</div><h2 class="text-base font-semibold">${esc(session.name)}</h2><p class="mt-1 text-zinc-500">Waiting for the first prototype. This page updates by itself.</p></div></div>`
    return `<div class="p-4 sm:p-6"><div class="mb-5 flex flex-wrap items-end justify-between gap-2"><div><h2 class="text-xl font-semibold tracking-tight">${esc(session.name)}</h2><p class="text-xs text-zinc-500">${list.length} prototype${list.length === 1 ? '' : 's'} · started ${clock(session.createdAt)}</p></div><p data-lifecycle class="text-xs text-zinc-400">${esc(lifecycle())}</p></div>
      <div class="${GRID}">${list.map(p => `<button data-act="lobby:proto:${esc(p.id)}" class="min-w-0 rounded-xl p-2 text-left ring-1 ring-black/[.07] hover:bg-zinc-50 hover:ring-black/20 dark:ring-white/10 dark:hover:bg-white/5">
        ${p.variants.length ? `<div class="overflow-hidden rounded-md ring-1 ring-black/5 dark:ring-white/10">${thumb(p, 'aspect-[16/10]')}</div>` : '<div class="aspect-[16/10] rounded-md bg-zinc-900/[.03] dark:bg-white/[.04]"></div>'}
        <div class="mt-3 flex items-center gap-2 px-1"><span class="truncate font-semibold">${esc(p.title)}</span>${editing(p.id) ? pulse('size-1.5') : ''}<span class="ml-auto shrink-0 text-xs text-zinc-400">${p.variants.length} variant${p.variants.length === 1 ? '' : 's'} · ${clock(p.created)}</span></div>
        <div class="truncate px-1 pb-1 text-xs text-zinc-500">${p.ask ? `“${esc(p.ask)}”` : ''}</div></button>`).join('')}</div></div>`
  }

  function protoLobby(p: Proto) {
    const grid = protoGrid(p)
    const tab = (on: boolean, act: string, icon: string, label: string) => `<button data-act="${act}" aria-pressed="${on}" title="${label}" class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs ${on ? TAB_ON : TAB_OFF}">${ic(icon, 'size-3.5')}<span class="hidden sm:inline">${label}</span></button>`
    const layoutToggle = `<div class="flex gap-0.5 rounded-lg bg-zinc-900/[.04] p-0.5 dark:bg-white/[.06]">${tab(!st.stack, 'stack:0', 'grid', 'Grid')}${tab(st.stack, 'stack:1', 'rows', 'Full size')}</div>`
    return `<div class="flex flex-wrap items-end justify-between gap-2 px-4 pt-5 sm:px-6"><div><h2 class="text-xl font-semibold tracking-tight">${esc(p.title)}</h2><p class="text-xs text-zinc-500">${p.ask ? `“${esc(p.ask)}” · ` : ''}${p.variants.length} variant${p.variants.length === 1 ? '' : 's'} · ${clock(p.created)}</p></div>${p.variants.length ? layoutToggle : '<p class="text-xs text-zinc-400">No variants yet</p>'}</div>
      ${st.stack ? stack(p) : grid}`
  }

  function protoGrid(p: Proto) {
    return `<div class="${GRID} p-4 sm:p-6">${p.variants.map(v => `<button data-act="pv:${esc(p.id)}:${v.id}" class="group min-w-0 text-left">
        <div class="overflow-hidden rounded-lg ring-1 ring-black/10 transition group-hover:ring-2 group-hover:ring-zinc-900 dark:ring-white/10 dark:group-hover:ring-white">${thumb(p, 'aspect-[16/10]')}</div>
        <div class="mt-2 flex items-center gap-2"><span class="font-semibold">${v.id}</span><span class="truncate text-zinc-500">${esc(v.name)}</span>${editing(p.id, v.id) ? `<span class="ml-auto inline-flex items-center gap-1.5 text-xs text-emerald-600">${pulse('size-1.5')}editing</span>` : ''}</div></button>`).join('')}</div>`
  }

  // Every variant at full size, one after another, live. Each frame is at least as tall as the
  // stage (a grid, so a root with h-full fills it) and contains its own position:fixed.
  function stack(p: Proto) {
    const head = (v: Variant) => `<div class="mb-3 flex h-8 min-w-0 items-center gap-2 ${p.kind === 'phone' ? 'justify-center' : ''}"><button data-act="pv:${esc(p.id)}:${v.id}" title="Open ${v.id}" class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md hover:underline hover:decoration-zinc-400 hover:underline-offset-4"><span class="font-semibold">${v.id}</span><span class="truncate text-zinc-500">${esc(v.name)}</span></button>${editing(p.id, v.id) ? pulse('size-1.5') : ''}</div>`
    if (p.kind === 'phone') return `<div class="flex flex-wrap justify-center gap-x-10 gap-y-8 p-4 sm:p-6">${p.variants.map(v => `<section data-stack-item class="min-w-0">${head(v)}<div data-phone class="${PHONE} [contain:layout_paint]" style="width:393px;height:852px"><div data-mount class="h-full overflow-y-auto"></div></div></section>`).join('')}</div>`
    return `<div class="space-y-8 py-4 sm:py-6">${p.variants.map(v => `<section data-stack-item><div class="px-4 sm:px-6">${head(v)}</div><div class="grid min-h-[var(--stage-h)] border-y border-black/[.07] bg-white [contain:layout_paint] dark:border-white/10 dark:bg-zinc-950"><div data-mount class="min-w-0"></div></div></section>`).join('')}</div>`
  }

  // ---------- chrome ----------
  function render() {
    const p = cur()
    const view = st.place.view
    const vid = st.place.view === 'variant' ? st.place.variant : ''
    const vs = p?.variants ?? []
    const many = vs.length > 7
    const at = Math.max(0, vs.findIndex(v => v.id === vid))
    const from = many ? Math.min(Math.max(0, at - 2), vs.length - 5) : 0
    const shown = many ? vs.slice(from, from + 5) : vs
    const phones = p?.kind === 'phone' && view !== 'session'
    const scaleBtn = (s: number) => `<button data-act="scale:${s}" class="flex h-10 w-full items-center rounded-lg px-3 text-left hover:bg-zinc-900/[.03] dark:hover:bg-white/5 ${st.scale === s ? 'font-medium text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-300'}">${s ? s + '%' : 'Fit to window'}</button>`

    // Each crumb is two buttons: the name opens that level's lobby, the chevron jumps.
    const crumb = (act: string, menu: string, label: string, current: boolean, html: string, cls: string) => `<div class="flex min-w-0 items-center sm:relative">
      <button data-act="${act}" ${current ? 'aria-current="page"' : ''} class="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-l-md pl-2 pr-1 hover:bg-zinc-900/5 dark:hover:bg-white/10 ${current ? 'font-semibold' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'}">${label}</button>
      <button data-act="open:${menu}" aria-label="Jump to…" aria-expanded="${st.open === menu}" class="inline-flex h-9 w-6 shrink-0 items-center justify-center rounded-r-md text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white ${st.open === menu ? ON : ''}">${ic('chev', 'size-3.5')}</button>
      ${pop(st.open === menu, html, cls)}</div>`
    const sep = '<span class="px-0.5 text-zinc-300 dark:text-zinc-700">/</span>'
    const row = (lead: string, body: string, end = '') => `<div class="flex min-h-10 items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-zinc-700 dark:text-zinc-300">${lead}<div class="min-w-0 flex-1">${body}</div>${end}</div>`

    const keep = !!st.status?.keep
    const sessionMenu = `<div class="px-4 pb-2.5 pt-4"><div class="text-[15px] font-semibold">${esc(session.name)}</div><div class="mt-0.5 truncate text-xs text-zinc-500">${esc(session.path)} · started ${clock(session.createdAt)}</div></div>
      <div class="space-y-0.5 px-1.5 pb-1.5">
        ${row(`<span class="grid size-4 place-items-center">${pulse('size-2', st.live && !st.stopped)}</span>`, st.stopped ? 'Stopped' : st.live ? `Live <span class="ml-1 text-xs text-zinc-400">${st.lastEdit ? `edited <span data-ago="${st.lastEdit}">${ago(st.lastEdit)}</span>` : 'waiting for edits'}</span>` : 'Reconnecting…')}
        ${row(ic('link', 'size-4 text-zinc-400'), `<span class="block truncate">${esc((session.url || location.origin).replace(/^https?:\/\//, ''))}</span>`, `<button data-act="copy" class="h-7 shrink-0 rounded-md px-2 text-xs text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">${st.copied ? 'Copied' : 'Copy'}</button>`)}
        ${lifecycle() ? row(ic('clock', 'size-4 self-start mt-0.5 text-zinc-400'), esc(lifecycle()).replace(' · ', '<span class="block text-xs leading-5 text-zinc-400">') + '</span>') : ''}
      </div>${SEP}
      <div class="flex h-14 items-center justify-between px-4"><span class="text-zinc-700 dark:text-zinc-300">Appearance</span><div class="flex rounded-lg bg-zinc-900/[.04] p-0.5 dark:bg-white/[.06]">${([['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']] as const).map(([m, i, l]) => { const on = st.dark === (m === 'dark'); return `<button data-act="theme:${m}" aria-pressed="${on}" class="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs ${on ? TAB_ON : TAB_OFF}">${ic(i, 'size-3.5')}${l}</button>` }).join('')}</div></div>${SEP}
      <div class="flex gap-2 p-3"><button data-act="keep" ${st.stopped ? 'disabled' : ''} class="h-9 flex-1 rounded-lg border border-black/10 text-xs font-medium hover:bg-zinc-900/[.03] disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5">${keep ? 'Don’t keep' : 'Keep forever'}</button><button data-act="stop" ${st.stopped ? 'disabled' : ''} class="h-9 flex-1 rounded-lg text-xs text-zinc-500 hover:bg-zinc-900/5 disabled:opacity-40 dark:hover:bg-white/10">Stop server</button></div>`

    const protoRow = (q: Proto) => { const on = q.id === p?.id && view !== 'session'; return `<button data-act="proto:${esc(q.id)}" aria-current="${on}" class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${on ? 'bg-zinc-900/[.05] dark:bg-white/[.08]' : 'hover:bg-zinc-900/[.03] dark:hover:bg-white/5'}">
        <span class="mt-[7px] flex size-1.5 shrink-0">${editing(q.id) ? pulse('size-1.5') : ''}</span>
        <span class="min-w-0 flex-1"><span class="flex items-center gap-1.5 ${on ? 'font-semibold text-zinc-900 dark:text-white' : 'font-medium text-zinc-800 dark:text-zinc-200'}">${esc(q.title)}${q.kind === 'phone' ? ic('phone', 'size-3.5 text-zinc-400') : ''}</span>${q.ask ? `<span class="block truncate text-xs leading-5 text-zinc-500">“${esc(q.ask)}”</span>` : ''}</span>
        <span class="shrink-0 pt-px text-right text-[11px] leading-5 tabular-nums text-zinc-400">${q.variants.length} variant${q.variants.length === 1 ? '' : 's'}<br>${editing(q.id) ? '<span class="text-emerald-600">editing now</span>' : clock(q.created)}</span></button>` }
    const protoMenu = `<div class="px-3.5 pb-0.5 pt-3 text-[11px] font-medium text-zinc-400">Prototypes in this session</div>
      <div class="max-h-[min(26rem,60vh)] space-y-px overflow-y-auto p-1">${active().map(protoRow).join('') || '<p class="px-3 py-4 text-xs text-zinc-400">None yet</p>'}</div>
      ${archived().length ? `${SEP}<div class="p-1.5"><button data-act="archived" class="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-xs text-zinc-400 hover:bg-zinc-900/[.03] hover:text-zinc-600 dark:hover:bg-white/5 dark:hover:text-zinc-200">${ic(st.archived ? 'chev' : 'right', 'size-3')}Archived<span class="ml-auto tabular-nums">${archived().length}</span></button>${st.archived ? archived().map(q => `<button data-act="proto:${esc(q.id)}" class="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-zinc-400 hover:bg-zinc-900/[.03] dark:hover:bg-white/5"><span class="size-1.5"></span><span class="line-through decoration-zinc-300">${esc(q.title)}</span><span class="ml-auto text-[11px] tabular-nums">${q.variants.length} variants</span></button>`).join('') : ''}</div>` : ''}`

    const col = (icon: string) => `<span class="flex w-6 shrink-0 justify-center text-zinc-500 dark:text-zinc-400">${icon}</span>`
    const vRow = (v: Variant) => { const on = view === 'variant' && vid === v.id; return `<div data-q="${v.id} ${esc(v.name)}"><button data-act="variant:${v.id}" aria-current="${on}" class="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left outline-none focus-visible:bg-zinc-900/[.06] dark:focus-visible:bg-white/10 ${on ? 'bg-zinc-900/[.05] font-semibold text-zinc-900 dark:bg-white/[.08] dark:text-white' : 'text-zinc-700 hover:bg-zinc-900/[.03] dark:text-zinc-300 dark:hover:bg-white/5'}"><span class="w-6 shrink-0 text-center text-xs font-semibold tabular-nums ${on ? '' : 'text-zinc-400'}">${v.id}</span><span class="min-w-0 flex-1 truncate">${esc(v.name)}</span>${p && editing(p.id, v.id) ? pulse('size-1.5') : ''}</button></div>` }
    const variantMenu = `${many ? `<div class="p-2 pb-1"><label class="flex h-10 items-center gap-2 rounded-lg bg-zinc-900/[.04] px-3 text-zinc-400 dark:bg-white/[.06]">${ic('search', 'size-4')}<input data-filter placeholder="Filter ${vs.length} variants" class="h-full min-w-0 flex-1 bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-white"></label></div>` : ''}
      <div data-vlist class="max-h-[min(22rem,50vh)] space-y-0.5 overflow-y-auto overscroll-contain p-1.5">${vs.map(vRow).join('')}<p data-empty hidden class="px-3 py-6 text-center text-xs text-zinc-400">No variant matches</p></div>
      <div class="space-y-0.5 border-t border-black/[.06] p-1.5 dark:border-white/10">${item('lobby:proto', 'All variants', `<span class="tabular-nums">${vs.length}</span>`, view === 'proto', col(ic('grid', 'size-3.5')))}${item('focus', 'Focus mode', '<kbd class="rounded border border-black/10 px-1 dark:border-white/10">F</kbd>', false, col(ic('grow', 'size-3.5')))}</div>
      <div class="border-t border-black/[.06] px-4 py-2.5 text-[11px] text-zinc-400 dark:border-white/10">${many ? '↑↓ move · Enter opens · ←→ step' : '← → step through variants'}</div>`

    const v = vs.find(v => v.id === vid)
    const initial = esc((session.name.trim()[0] || 'P').toUpperCase())
    bar.innerHTML = `<nav class="flex min-w-0 items-center" aria-label="Breadcrumb">
        ${crumb('lobby:session', 'session', `<span class="relative grid size-5 shrink-0 place-items-center rounded bg-zinc-900 text-[10px] font-bold text-white dark:bg-white dark:text-zinc-900">${initial}<span class="absolute -right-1 -top-1 flex rounded-full ring-2 ring-white dark:ring-zinc-950">${pulse('size-2', st.live && !st.stopped)}</span></span><span class="hidden truncate md:inline">${esc(session.name)}</span>`, view === 'session', sessionMenu, 'left-2 top-12 w-[22rem] max-w-[calc(100vw-1rem)] sm:left-0')}
        ${p ? sep + crumb('lobby:proto', 'proto', `<span class="truncate">${esc(p.title)}</span>`, view === 'proto', protoMenu, 'inset-x-2 top-12 sm:inset-x-auto sm:left-0 sm:w-96') : ''}
        ${v ? sep + crumb(`variant:${v.id}`, 'variant', `<span class="truncate"><b class="text-zinc-900 dark:text-white">${v.id}</b><span class="hidden font-normal text-zinc-500 sm:inline dark:text-zinc-400"> · ${esc(v.name)}</span></span>`, true, variantMenu, 'right-2 top-12 w-72 sm:left-0 sm:right-auto') : ''}
      </nav>
      <div class="ml-auto flex items-center gap-1">
        <div class="hidden sm:block">${seg()}</div>
        ${phones ? `<div class="relative"><button data-act="open:scale" class="${IB} text-xs tabular-nums">${ic('phone')}${st.scale ? st.scale + '%' : 'Fit'}</button>${pop(st.open === 'scale', `<div class="p-1.5">${[0, 100, 75, 50].map(scaleBtn).join('')}</div>`, 'right-0 top-11 w-44')}</div>` : ''}
      </div>`

    function seg() {
      if (!p || !vs.length) return ''
      return `<div class="flex items-center gap-0.5 rounded-lg bg-zinc-900/[.04] p-0.5 dark:bg-white/[.06]" role="tablist">
        <button data-act="lobby:proto" title="All variants" aria-selected="${view === 'proto'}" class="grid h-8 w-9 place-items-center rounded-md ${view === 'proto' ? TAB_ON : TAB_OFF}">${ic('grid', 'size-3.5')}</button>
        ${many ? `<button data-act="step:-1" aria-label="Previous variant" class="grid h-8 w-7 place-items-center rounded-md ${TAB_OFF}">${ic('left', 'size-3.5')}</button>` : ''}
        ${shown.map(x => `<button data-act="variant:${x.id}" title="${esc(x.name)}" role="tab" aria-selected="${vid === x.id}" class="relative h-8 min-w-9 rounded-md px-2.5 text-xs font-semibold ${vid === x.id ? TAB_ON : TAB_OFF}">${x.id}${editing(p.id, x.id) ? `<span class="absolute right-1 top-1">${pulse('size-1.5')}</span>` : ''}</button>`).join('')}
        ${many ? `<button data-act="step:1" aria-label="Next variant" class="grid h-8 w-7 place-items-center rounded-md ${TAB_OFF}">${ic('right', 'size-3.5')}</button><button data-act="open:variant" title="All ${vs.length} variants" class="h-8 rounded-md px-2 text-xs tabular-nums ${st.open === 'variant' ? TAB_ON : TAB_OFF}">${at + 1}<span class="text-zinc-400">/${vs.length}</span></button>` : ''}
      </div>`
    }
    const tabRow = seg()
    tabs.className = tabRow ? 'flex shrink-0 justify-center border-b border-black/[.07] p-1.5 sm:hidden dark:border-white/10' : 'hidden'
    tabs.innerHTML = tabRow

    // Focus mode restyles the zone to cover the page; the mounted design stays put.
    zone.className = st.focus ? 'fixed inset-0 z-[100] bg-white text-[13px] dark:bg-zinc-950' : 'relative min-h-0 flex-1'
    document.documentElement.style.overflow = st.focus ? 'hidden' : ''

    const edgeBtn = (side: 'prev' | 'next') => {
      const d = side === 'prev' ? -1 : 1, t = vs[(at + d + vs.length) % vs.length]
      const k = `${st.focus ? 'focus' : 'main'}-${side}`, e = smooth(edge.t[k] || 0), open = !!edge.hover[k]
      return `<button data-edge="${k}" data-act="step:${d}" aria-label="${d < 0 ? 'Previous' : 'Next'} variant: ${t.id} ${esc(t.name)}" class="absolute top-1/2 z-10 -mt-6 hidden h-12 items-center rounded-full bg-white/90 px-3 text-zinc-900 shadow-lg shadow-black/10 ring-1 ring-black/10 backdrop-blur [@media(hover:hover)]:flex dark:bg-zinc-900/90 dark:text-white dark:ring-white/15 ${d < 0 ? 'left-3' : 'right-3 flex-row-reverse'}" style="opacity:${e};pointer-events:${e > 0.3 ? 'auto' : 'none'}">${ic(d < 0 ? 'left' : 'right', 'size-5')}<span data-edge-label class="overflow-hidden whitespace-nowrap text-[13px]" style="width:${open ? edge.w[k] || 0 : 0}px;opacity:${open ? 1 : 0};margin-${d < 0 ? 'left' : 'right'}:${open ? 8 : 0}px;transition:width .32s cubic-bezier(.22,1,.36,1),opacity .2s,margin .32s cubic-bezier(.22,1,.36,1)"><span class="inline-block"><b>${t.id}</b> · ${esc(t.name)}</span></span></button>`
    }
    const dockBtn = 'grid size-9 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white'
    const dockSep = '<span class="mx-1 h-5 w-px shrink-0 bg-white/15"></span>'
    overlay.innerHTML = view !== 'variant' || !p ? '' : `
      ${vs.length > 1 ? edgeBtn('prev') + edgeBtn('next') : ''}
      ${!st.focus ? `<button data-act="focus" data-focus-btn title="Focus mode · F" class="absolute right-4 top-3 z-10 hidden h-9 [@media(hover:hover)]:inline-flex items-center gap-1.5 rounded-full bg-zinc-900/80 px-3 text-xs font-medium text-white shadow-lg backdrop-blur transition-opacity duration-200 focus-visible:!opacity-100" style="opacity:${stageHover.on ? 1 : 0}">${ic('grow', 'size-3.5')}Focus</button>` : `
      ${st.open === 'fproto' ? `<div data-pop class="fixed bottom-[76px] left-1/2 z-20 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-900">${protoMenu}</div>` : ''}
      <div class="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center pb-[env(safe-area-inset-bottom)]">
        <div data-dock data-locked="${st.open === 'fproto' ? 1 : 0}" class="pointer-events-auto relative overflow-hidden rounded-full shadow-xl shadow-black/20 ring-1 ring-white/10 backdrop-blur" style="width:72px;height:6px;margin-bottom:4px;background-color:rgb(24 24 27/.35)">
          <div data-dock-full class="absolute left-1/2 top-1/2 flex w-max items-center gap-0.5 px-1 text-white" style="opacity:0;transform:translate(-50%,-50%)">
            <button data-act="unfocus" class="${dockBtn}" aria-label="Exit focus (Esc)" title="Exit focus · Esc">${ic('shrink')}</button>${dockSep}
            <button data-act="open:fproto" aria-label="Prototypes" class="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2 hover:bg-white/10 sm:px-3">${ic('menu', 'size-4 sm:hidden')}<span class="hidden max-w-48 truncate font-medium sm:inline">${esc(p.title)}</span>${ic('chev', 'hidden size-3.5 rotate-180 text-white/50 sm:block')}</button>${dockSep}
            ${many ? `<button data-act="step:-1" class="${dockBtn} w-7" aria-label="Previous">${ic('left', 'size-3.5')}</button>` : ''}
            ${shown.map(x => `<button data-act="variant:${x.id}" title="${esc(x.name)}" class="relative grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${vid === x.id ? 'bg-white text-zinc-900' : 'text-white/70 hover:bg-white/10'}">${x.id}${editing(p.id, x.id) ? `<span class="absolute right-1 top-1">${pulse('size-1.5')}</span>` : ''}</button>`).join('')}
            ${many ? `<button data-act="step:1" class="${dockBtn} w-7" aria-label="Next">${ic('right', 'size-3.5')}</button><span class="px-1.5 text-xs tabular-nums text-white/60">${at + 1}/${vs.length}</span>` : ''}${dockSep}
            ${phones ? `<button data-act="scale:${[0, 100, 75, 50][([0, 100, 75, 50].indexOf(st.scale) + 1) % 4]}" class="h-9 shrink-0 rounded-full px-2 text-xs tabular-nums text-white/70 hover:bg-white/10" title="Phone scale">${st.scale ? st.scale + '%' : 'Fit'}</button>` : ''}
            <button data-act="theme:${st.dark ? 'light' : 'dark'}" class="${dockBtn}" aria-label="Theme">${ic(st.dark ? 'sun' : 'moon')}</button>
          </div>
        </div>
      </div>`}`

    if (st.focus) requestAnimationFrame(runDock)
    restoreEdgeLabels()
    if (canHover()) root.querySelector<HTMLInputElement>('[data-filter]')?.focus({ preventScroll: true })
    requestAnimationFrame(() => {
      for (const list of root.querySelectorAll<HTMLElement>('[data-vlist]')) {
        const on = list.querySelector<HTMLElement>('[aria-current="true"]')
        if (on) list.scrollTop = on.offsetTop - list.offsetTop - list.clientHeight / 2 + on.clientHeight / 2
      }
    })
    document.title = [v && `${v.id} · ${v.name}`, p?.title, session.name].filter(Boolean).join(' – ')
  }

  // ---------- actions ----------
  function act(name: string, arg: string, arg2: string) {
    const p = cur()
    switch (name) {
      case 'lobby': return arg === 'session' ? go({ view: 'session' }) : go({ view: 'proto', proto: arg2 || p!.id })
      case 'proto': return openProto(arg)
      case 'pv': return go({ view: 'variant', proto: arg, variant: arg2 })
      case 'variant': return go({ view: 'variant', proto: p!.id, variant: arg })
      case 'step': return step(Number(arg))
      case 'open': st.open = st.open === arg ? null : arg; st.copied = false; if (arg === 'session') refreshStatus(); return render()
      case 'archived': st.archived = !st.archived; return render()
      case 'stack': st.stack = arg === '1'; localStorage.setItem('proto-lobby', st.stack ? 'stack' : 'grid'); return show(true)
      case 'scale': st.scale = Number(arg); st.open = null; render(); return fit()
      case 'theme': return setTheme(arg === 'dark')
      case 'focus': if (st.place.view !== 'variant') return; st.focus = true; st.open = null; dock.hold = performance.now() + 1600; edge.hover = {}; render(); return fit()
      case 'unfocus': st.focus = false; st.open = null; edge.hover = {}; render(); return fit()
      case 'copy': navigator.clipboard?.writeText(session.url || location.href); st.copied = true; return render()
      case 'keep': return post('keep', { keep: !st.status?.keep })
      case 'stop': return post('stop').then(() => { st.stopped = true; render() })
    }
  }

  root.addEventListener('click', e => {
    const el = (e.target as Element).closest<HTMLElement>('[data-act]')
    if (!el) {
      if (st.open && !(e.target as Element).closest('[data-pop]')) { st.open = null; render() }
      return
    }
    const [name, arg = '', arg2 = ''] = el.dataset.act!.split(':')
    act(name, arg, arg2)
  })

  root.addEventListener('input', e => {
    const input = e.target as HTMLInputElement
    if (!input.matches('[data-filter]')) return
    const list = input.closest('[data-pop]')!.querySelector('[data-vlist]')!, needle = input.value.toLowerCase()
    let any = false
    for (const el of list.querySelectorAll<HTMLElement>('[data-q]')) { el.hidden = !el.dataset.q!.toLowerCase().includes(needle); any ||= !el.hidden }
    list.querySelector<HTMLElement>('[data-empty]')!.hidden = any
  })

  addEventListener('keydown', e => {
    const t = e.target as Element
    const pop = t.closest?.('[data-pop]')
    if (pop && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (e.key === 'Enter' && t.matches('[data-filter]')))) {
      const rows = [...pop.querySelectorAll<HTMLElement>('[data-vlist] [data-q]:not([hidden]) button')]
      if (!rows.length) return
      e.preventDefault()
      if (e.key === 'Enter') return rows[0].click()
      const i = rows.indexOf(document.activeElement as HTMLElement)
      const next = rows[e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : i - 1]
      return next ? next.focus() : pop.querySelector<HTMLElement>('[data-filter]')?.focus()
    }
    if (e.key === 'Escape') {
      if (st.open) { st.open = null; return render() }
      if (st.focus) return act('unfocus', '', '')
    }
    if (e.metaKey || e.ctrlKey || e.altKey || t.closest?.(INTERACTIVE)) return
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && st.place.view === 'variant') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1) }
    else if (e.key === 'f' && st.place.view === 'variant') act(st.focus ? 'unfocus' : 'focus', '', '')
  })

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
  document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1' })))

  let editTimer = 0
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
      // Same place, new modules (a meta edit or a re-evaluated file): swap without a fade.
      const refs = refsFor(st.place)
      if (!layer || refs.length !== layer.refs.length || refs.some((r, i) => r !== layer!.refs[i])) show(false)
      render()
    },
    replaceVariant(file: string, component: unknown) {
      const nameOf = (c: any) => c?.displayName || c?.__name || c?.name || ''
      let renamed = false
      for (const p of protos) for (const v of p.variants) {
        if (v.file !== file || v.component === component) continue
        renamed ||= nameOf(v.component) !== nameOf(component)
        v.component = component
      }
      if (renamed) show(false)
    },
    setSession(next: Session) { session = next; render() },
    setLive(live: boolean) { st.live = live; render() },
    edited(paths: string[]) {
      for (const path of paths) {
        if (!path.includes('/src/protos/')) continue
        st.lastEdit = Date.now()
        const m = path.match(/\/src\/protos\/([^/]+)\/([A-Z]{1,2})\.\w+/)
        if (m) st.editing = { proto: m[1], variant: m[2] }
      }
      render()
      clearTimeout(editTimer)
      editTimer = window.setTimeout(() => { st.editing = null; render() }, 10_000)
    },
  }
}

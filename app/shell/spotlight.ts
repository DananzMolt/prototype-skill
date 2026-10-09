// The Try it panel's spotlight: pointing at a thing to try dims the design except where it
// happens, with a label (an icon and a word) on each spot, an arrow for a drag, and the keys for
// a shortcut. It arrives gently: the dim fades in while the light closes in on the spot, the
// arrow draws itself from the start to the end, and the labels rise in after it. Moving to
// another thing (or a thing's next step) glides the light across instead of jumping, and the
// light follows the design while it moves. The panel decides what is shown (shell.ts); this
// draws it, in a layer over the stage that never takes the pointer.
import type { Act, Hint } from './hints'
import { esc } from './ui'

type Try = Extract<Hint, { kind: 'try' }>
type Box = { x: number; y: number; w: number; h: number }
type Spot = { at: Box | null; to: Box | null; more: Box[]; step: number | null }

const AMBER = '#fbbf24'
const EASE = 'cubic-bezier(.22,.8,.24,1)'
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// Phosphor Icons (MIT), bold weight, on a 256 grid.
const ICONS: Record<string, string> = {
  'click': 'M224.15,179.17l-46.82-46.82,37.92-13.51c.26-.09.51-.19.76-.3a20,20,0,0,0-1.76-37.27L54.16,29A20,20,0,0,0,29,54.16L81.27,214.24A20,20,0,0,0,118.54,216c.11-.25.21-.5.3-.76l13.51-37.92,46.83,46.82a20,20,0,0,0,28.28,0l16.69-16.68A20,20,0,0,0,224.15,179.17Zm-30.83,25.17-48.48-48.48A20,20,0,0,0,130.7,150a20.47,20.47,0,0,0-3.73.35A20,20,0,0,0,112.35,162c-.11.25-.2.5-.3.76L100.4,195.5,54.29,54.29,195.5,100.4l-32.71,11.65c-.25.09-.51.19-.76.3a20,20,0,0,0-6.16,32.48h0l48.48,48.48ZM84,16V12a12,12,0,0,1,24,0v4a12,12,0,0,1-24,0ZM12,108a12,12,0,0,1,0-24h4a12,12,0,0,1,0,24ZM120.62,24.21l4-12a12,12,0,0,1,22.77,7.58l-4,12a12,12,0,0,1-22.77-7.58Zm-81.23,104a12,12,0,0,1-7.59,15.17l-12,4a12,12,0,1,1-7.59-22.76l12-4A12,12,0,0,1,39.39,128.21Z',
  'hover': 'M224.15,179.17l-46.83-46.82,37.93-13.51.76-.3a20,20,0,0,0-1.76-37.27L54.16,29A20,20,0,0,0,29,54.16L81.27,214.24A20,20,0,0,0,118.54,216c.11-.25.21-.5.3-.76l13.51-37.92,46.83,46.82a20,20,0,0,0,28.28,0l16.69-16.68A20,20,0,0,0,224.15,179.17Zm-30.83,25.17-48.48-48.48A20,20,0,0,0,130.7,150a20.66,20.66,0,0,0-3.74.35A20,20,0,0,0,112.35,162c-.11.25-.21.5-.3.76L100.4,195.5,54.29,54.29l141.21,46.1-32.71,11.66c-.26.09-.51.19-.76.3a20,20,0,0,0-6.17,32.48h0l48.49,48.48Z',
  'right-click': 'M144,12H112A68.07,68.07,0,0,0,44,80v96a68.07,68.07,0,0,0,68,68h32a68.07,68.07,0,0,0,68-68V80A68.07,68.07,0,0,0,144,12Zm42,55a43.63,43.63,0,0,1,2,13v20H153ZM172.51,46.52,140,79V36h4A43.83,43.83,0,0,1,172.51,46.52ZM112,36h4v64H68V80A44.05,44.05,0,0,1,112,36Zm32,184H112a44.05,44.05,0,0,1-44-44V124H188v52A44.05,44.05,0,0,1,144,220Z',
  'grab': 'M188,76a31.85,31.85,0,0,0-11.21,2,32,32,0,0,0-48.79-11A32,32,0,0,0,76,92v16H68a32,32,0,0,0-32,32v12a92,92,0,0,0,184,0V108A32,32,0,0,0,188,76Zm8,76a68,68,0,0,1-136,0V140a8,8,0,0,1,8-8h8v20a12,12,0,0,0,24,0V92a8,8,0,0,1,16,0v28a12,12,0,0,0,24,0V92a8,8,0,0,1,16,0v28a12,12,0,0,0,24,0V108a8,8,0,0,1,16,0Z',
  'drop': 'M228,144v64a12,12,0,0,1-12,12H40a12,12,0,0,1-12-12V144a12,12,0,0,1,24,0v52H204V144a12,12,0,0,1,24,0Zm-108.49,8.49a12,12,0,0,0,17,0l40-40a12,12,0,0,0-17-17L140,115V32a12,12,0,0,0-24,0v83L96.49,95.51a12,12,0,0,0-17,17Z',
  'type': 'M188,208a12,12,0,0,1-12,12H160a43.86,43.86,0,0,1-32-13.85A43.86,43.86,0,0,1,96,220H80a12,12,0,0,1,0-24H96a20,20,0,0,0,20-20V140H104a12,12,0,0,1,0-24h12V80A20,20,0,0,0,96,60H80a12,12,0,0,1,0-24H96a43.86,43.86,0,0,1,32,13.85A43.86,43.86,0,0,1,160,36h16a12,12,0,0,1,0,24H160a20,20,0,0,0-20,20v36h12a12,12,0,0,1,0,24H140v36a20,20,0,0,0,20,20h16A12,12,0,0,1,188,208Z',
  'key': 'M224,44H32A20,20,0,0,0,12,64V192a20,20,0,0,0,20,20H224a20,20,0,0,0,20-20V64A20,20,0,0,0,224,44Zm-4,144H36V68H220ZM52,128a12,12,0,0,1,12-12H192a12,12,0,0,1,0,24H64A12,12,0,0,1,52,128Zm0-36A12,12,0,0,1,64,80H192a12,12,0,0,1,0,24H64A12,12,0,0,1,52,92Zm0,72a12,12,0,0,1,12-12h8a12,12,0,0,1,0,24H64A12,12,0,0,1,52,164Zm108,0a12,12,0,0,1-12,12H108a12,12,0,0,1,0-24h40A12,12,0,0,1,160,164Zm44,0a12,12,0,0,1-12,12h-8a12,12,0,0,1,0-24h8A12,12,0,0,1,204,164Z',
  'show': 'M232,116h-4.72A100.21,100.21,0,0,0,140,28.72V24a12,12,0,0,0-24,0v4.72A100.21,100.21,0,0,0,28.72,116H24a12,12,0,0,0,0,24h4.72A100.21,100.21,0,0,0,116,227.28V232a12,12,0,0,0,24,0v-4.72A100.21,100.21,0,0,0,227.28,140H232a12,12,0,0,0,0-24Zm-92,87v-3a12,12,0,0,0-24,0v3a76.15,76.15,0,0,1-63-63h3a12,12,0,0,0,0-24H53a76.15,76.15,0,0,1,63-63v3a12,12,0,0,0,24,0V53a76.15,76.15,0,0,1,63,63h-3a12,12,0,0,0,0,24h3A76.15,76.15,0,0,1,140,203ZM128,84a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,84Zm0,64a20,20,0,1,1,20-20A20,20,0,0,1,128,148Z',
}
const icon = (name: string, size = 13, cls = '') =>
  `<svg class="shrink-0 ${cls}" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`
/** The panel's row icon for a thing that can be shown on the page. */
export const showIcon = (cls = '') => icon('show', 14, cls)

/** What an action is called on its spot, and its icon: the start, and for a drag the end. */
const WORDS: Record<Act, [string, string, string, string]> = {
  click: ['Click', 'click', '', ''], hover: ['Hover', 'hover', '', ''], 'right-click': ['Right-click', 'right-click', '', ''],
  drag: ['Grab', 'grab', 'Drop', 'drop'], type: ['Type', 'type', '', ''], key: ['', '', '', ''],
}
export const actOf = (t: Try): Act => t.act ?? (t.key && !t.at ? 'key' : t.to ? 'drag' : 'click')
/** Whether a thing to try has anything to show on the page. */
export const showable = (t: Try) => !!(t.at || t.steps?.length || t.key)

const query = (root: Element, sel?: string) => { if (!sel) return null; try { return root.querySelector(sel) } catch { return null } }
const queryAll = (root: Element, sel?: string) => { if (!sel) return []; try { return [...root.querySelectorAll(sel)] } catch { return [] } }
/** The element a thing to try points at now: its last step on the page, or its at. */
function targetOf(host: Element, t: Try): { el: Element | null; step: number | null } {
  if (t.steps?.length) {
    for (let i = t.steps.length - 1; i >= 0; i--) { const el = query(host, t.steps[i].at); if (el) return { el, step: i } }
    return { el: null, step: null }
  }
  return { el: query(host, t.at), step: null }
}
/** Only the part of el that shows, relative to o: anything between it and stop that clips (a
 *  scrolling list, the stage) cuts the box down; a box cut away entirely is null. */
function visible(el: Element | null, o: DOMRect, stop: Element): Box | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) return null
  let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom]
  for (let p = el.parentElement; p && p !== stop; p = p.parentElement) {
    const cs = getComputedStyle(p)
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
    const c = p.getBoundingClientRect()
    l = Math.max(l, c.left); t = Math.max(t, c.top); rt = Math.min(rt, c.right); b = Math.min(b, c.bottom)
  }
  return rt - l > 1 && b - t > 1 ? { x: l - o.left, y: t - o.top, w: rt - l, h: b - t } : null
}
/** Where a thing to try is on the design right now: here, scrolled out of view, or not there. */
export function whereIs(host: Element, t: Try, stop: Element): 'here' | 'off' | 'gone' | 'none' {
  if (!t.at && !t.steps?.length) return 'none'
  const { el } = targetOf(host, t)
  return !el ? 'gone' : visible(el, document.body.getBoundingClientRect(), stop) ? 'here' : 'off'
}

const grow = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p })
/** A spot too small to see lit (a 14 px star) gets a light of at least 28 px around it. */
const fit = (b: Box, min = 28): Box => b.w >= min && b.h >= min ? b : { x: b.x + b.w / 2 - Math.max(b.w, min) / 2, y: b.y + b.h / 2 - Math.max(b.h, min) / 2, w: Math.max(b.w, min), h: Math.max(b.h, min) }
const mid = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const same = (a: Box | null, b: Box | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
/** A curve from a's centre to b's, bowing up like a thrown object. */
function arc(a: Box, b: Box) {
  const p = mid(a), q = mid(b)
  const c = { x: (p.x + q.x) / 2 + (q.y - p.y) * 0.25, y: (p.y + q.y) / 2 - Math.abs(q.x - p.x) * 0.15 }
  const ang = Math.atan2(q.y - c.y, q.x - c.x)
  const head = [ang - 0.45, ang + 0.45].map(t => `${q.x - 9 * Math.cos(t)},${q.y - 9 * Math.sin(t)}`)
  return { d: `M${p.x} ${p.y} Q${c.x} ${c.y} ${q.x} ${q.y}`, head: `${head[0]} ${q.x},${q.y} ${head[1]}` }
}

/** Eases a box toward where it should be, frame by frame. */
class Glide {
  cur: Box | null = null
  t = performance.now()
  /** From nothing it starts wider and closes in. */
  start(b: Box | null) { this.cur = b && !still() ? grow(b, 36) : b }
  step(want: Box | null, now: number) {
    const k = 1 - Math.exp(-(now - this.t) / 90)
    this.t = now
    if (!want) return this.cur
    const c = this.cur
    const n = !c || still() ? want : { x: c.x + (want.x - c.x) * k, y: c.y + (want.y - c.y) * k, w: c.w + (want.w - c.w) * k, h: c.h + (want.h - c.h) * k }
    this.cur = Math.abs(n.x - want.x) + Math.abs(n.y - want.y) + Math.abs(n.w - want.w) + Math.abs(n.h - want.h) < 0.3 ? want : n
    return this.cur
  }
}

const pillCls = 'absolute flex h-6 items-center gap-1 whitespace-nowrap rounded-full bg-amber-400 pl-2 pr-2.5 text-[11.5px] font-semibold text-zinc-950 shadow-lg shadow-black/30'
const rise = (delay: number) => still() ? '' : `animation:spot-rise 280ms ${EASE} ${delay}ms both;`

export function createSpotlight(layer: HTMLElement) {
  const ns = 'http://www.w3.org/2000/svg'
  let shown: { host: HTMLElement; t: Try; id: string } | null = null
  let built = ''
  let raf = 0
  let fading = 0
  const at = new Glide(), to = new Glide()
  let n = 0, hadTo = false
  layer.style.opacity = '0'

  function spotOf(host: HTMLElement, t: Try, o: DOMRect): Spot {
    const stop = layer.parentElement!
    const { el, step } = targetOf(host, t)
    const more = t.all ? queryAll(host, t.at).slice(1).flatMap(x => visible(x, o, stop) ?? []) : []
    return { at: visible(el, o, stop), to: visible(query(host, t.to), o, stop), more, step }
  }

  // The parts are built once per thing shown (and per step), so their entrance plays then;
  // every frame after only moves them.
  function build(t: Try, s: Spot) {
    n++
    const step = s.step !== null ? t.steps?.[s.step] : undefined
    const act = step ? step.act ?? 'click' : actOf(t)
    const [a, ai, b, bi] = WORDS[act]
    const label = step ? step.label ?? a : t.label ?? a
    const hasTo = !!(s.at && s.to)
    const holes = s.at ? 1 + (hasTo ? 1 : 0) + s.more.length : 0
    const fade = (delay: number) => still() ? '' : `animation:spot-fade 300ms ${EASE} ${delay}ms both`
    layer.innerHTML = `<svg class="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <mask id="spot-dim-${n}"><rect width="100%" height="100%" fill="white"/>${Array.from({ length: holes }, () => '<rect data-hole rx="12" fill="black"/>').join('')}</mask>
          ${hasTo ? `<mask id="spot-draw-${n}" maskUnits="userSpaceOnUse"><path data-arc pathLength="1" fill="none" stroke="white" stroke-width="14" stroke-linecap="round" stroke-dasharray="1 1" style="${still() ? '' : `animation:spot-draw 520ms ${EASE} 140ms both`}"/></mask>` : ''}
        </defs>
        <rect width="100%" height="100%" fill="rgb(0 0 0 / ${holes ? 0.55 : 0.35})" mask="url(#spot-dim-${n})"/>
        ${Array.from({ length: holes }, (_, i) => `<rect data-ring rx="10" fill="none" stroke="${AMBER}" stroke-width="1.5" ${hasTo && i === 1 ? 'stroke-dasharray="5 4"' : ''} style="${fade(60 + (hasTo ? i * 260 : i * 50))}"/>`).join('')}
        ${hasTo ? `<g fill="none" stroke="${AMBER}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path data-arc stroke-dasharray="6 5" mask="url(#spot-draw-${n})"/><polyline data-head style="${still() ? '' : `animation:spot-fade 160ms ${EASE} 560ms both`}"/></g>` : ''}
      </svg>
      ${s.at && label ? `<div data-pill="a" class="${pillCls}" style="${rise(120)}">${step ? `<span class="-ml-0.5 grid size-4 place-items-center rounded-full bg-zinc-950 text-[10px] tabular-nums text-amber-300">${s.step! + 1}</span>` : ''}${ai ? icon(ai) : ''}${esc(label)}</div>` : ''}
      ${hasTo && b ? `<div data-pill="b" class="${pillCls}" style="${rise(520)}">${icon(bi)}${b}</div>` : ''}
      ${t.key ? `<div data-keys class="absolute flex -translate-x-1/2 items-center gap-1.5 rounded-xl bg-zinc-950/90 py-2 pl-3 pr-2 text-[12.5px] font-medium text-white shadow-xl shadow-black/40 ring-1 ring-amber-400/70" style="${rise(s.at ? 300 : 80)}">${icon('key', 15, 'text-amber-300')}Press${t.key.split(' ').map(k => `<kbd class="grid h-7 min-w-7 place-items-center rounded-md bg-amber-400 px-1.5 font-sans text-[13px] font-semibold text-zinc-950 shadow-[inset_0_-2px_0_rgb(0_0_0/.18)]">${esc(k)}</kbd>`).join('')}</div>` : ''}`
  }

  function frame(now: number) {
    raf = 0
    const o = layer.getBoundingClientRect()
    if (shown) {
      if (!shown.host.isConnected) { hide(); return }
      const s = spotOf(shown.host, shown.t, o)
      const on = !!(s.at || shown.t.key)
      const key = `${shown.id}|${s.step}|${!!(s.at && s.to)}|${s.more.length}|${!!s.at}`
      if (on && key !== built) {
        const first = !built
        build(shown.t, s)
        // A new thing closes in from wider; its next step glides over from the last one.
        if (first || !at.cur) at.start(s.at)
        if (first || !hadTo) to.start(s.to)
        hadTo = !!(s.at && s.to)
        built = key
        if (first) requestAnimationFrame(() => requestAnimationFrame(() => { if (shown) { layer.style.transition = `opacity 320ms ${EASE}`; layer.style.opacity = '1' } }))
      }
      if (on) draw(at.step(s.at, now), to.step(s.to, now), s, o)
    }
    if (shown || fading) raf = requestAnimationFrame(frame)
  }

  function draw(a: Box | null, b: Box | null, s: Spot, o: DOMRect) {
    const lit = [a && fit(a), s.at && s.to ? b : null, ...s.more.map(m => fit(m))].filter(Boolean) as Box[]
    layer.querySelectorAll<SVGRectElement>('[data-hole]').forEach((r, i) => {
      const h = lit[i] && grow(lit[i], 8)
      if (h) { r.setAttribute('x', `${h.x}`); r.setAttribute('y', `${h.y}`); r.setAttribute('width', `${h.w}`); r.setAttribute('height', `${h.h}`) }
    })
    layer.querySelectorAll<SVGRectElement>('[data-ring]').forEach((r, i) => {
      const h = lit[i] && grow(lit[i], 6)
      if (h) { r.setAttribute('x', `${h.x}`); r.setAttribute('y', `${h.y}`); r.setAttribute('width', `${h.w}`); r.setAttribute('height', `${h.h}`) }
    })
    if (a && b && s.to) {
      const { d, head } = arc(a, b)
      layer.querySelectorAll('[data-arc]').forEach(p => p.setAttribute('d', d))
      layer.querySelector('[data-head]')?.setAttribute('points', head)
    }
    const place = (el: HTMLElement | null, box: Box | null) => {
      if (!el || !box) return
      const g = grow(fit(box), 6), w = el.offsetWidth
      el.style.left = `${Math.min(Math.max(g.x + g.w / 2 - w / 2, 8), o.width - w - 8)}px`
      el.style.top = `${g.y > 34 ? g.y - 30 : g.y + g.h + 6}px`
    }
    place(layer.querySelector('[data-pill="a"]'), a)
    place(layer.querySelector('[data-pill="b"]'), b)
    const keys = layer.querySelector<HTMLElement>('[data-keys]')
    if (keys) { keys.style.left = `${o.width / 2}px`; keys.style.top = `${o.height - 72}px` }
  }

  function bringIntoView(host: HTMLElement, t: Try) {
    // A thing scrolled out of view is brought into view by scrolling the nearest list it is
    // in (the stage itself, for a long page); the light rides along.
    const { el } = targetOf(host, t)
    for (let p = el?.parentElement; el && p && p !== layer.parentElement; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY
      if (oy !== 'auto' && oy !== 'scroll') continue
      const c = p.getBoundingClientRect(), r = el.getBoundingClientRect()
      if (r.top < c.top || r.bottom > c.bottom) p.scrollTo({ top: p.scrollTop + r.top - c.top - (c.height - r.height) / 2, behavior: still() ? 'auto' : 'smooth' })
      break
    }
  }

  function show(host: HTMLElement, t: Try, id: string) {
    const fresh = shown?.id !== id
    shown = { host, t, id }
    clearTimeout(fading); fading = 0
    if (fresh) { built = built && layer.style.opacity === '1' ? `${built}|moved` : ''; bringIntoView(host, t) }
    if (!built) { layer.style.transition = 'none'; layer.style.opacity = '0'; at.cur = to.cur = null }
    if (!raf) raf = requestAnimationFrame(frame)
  }
  function hide() {
    if (!shown) return
    shown = null
    layer.style.transition = `opacity 220ms ${EASE}`
    layer.style.opacity = '0'
    clearTimeout(fading)
    fading = window.setTimeout(() => { fading = 0; built = ''; layer.innerHTML = '' }, 260)
    if (!raf) raf = requestAnimationFrame(frame)
  }
  return { show, hide, get id() { return shown?.id ?? null } }
}


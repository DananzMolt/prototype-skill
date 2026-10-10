// Looking at the design without using it: the outline that follows the pointer (or a finger),
// the guard that keeps every press from reaching the design while commenting, and the live boxes
// pins and outlines are drawn from.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { describe, find, labelOf, seen, spot, spotAt } from './dom'
import { Icon } from './ui'
import type { Box, Target } from './types'
import { useCtx } from './ctx'

export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const GLIDE_MS = 110
export const FADE_MS = 90
/** How long a finger holds still on the design to pin a comment to that spot. */
export const HOLD_MS = 500

/**
 * One box that follows whatever it is told to point at: it glides between targets with a long
 * ease-out, fades in where it first appears (landing in place, never sliding in from where it
 * last was) and fades out when it has nothing to point at. The inspect outline and the spotlight
 * for a row in the @ menu are both this, so they move the same way.
 */
export function Glide<T extends { box: Box }>({ item, pad, className = '', style, children }: { item: T | null; pad: number; className?: string; style?: CSSProperties; children: (item: T) => ReactNode }) {
  const last = useRef<T | null>(null)
  if (item) last.current = item
  const h = item ?? last.current
  const [snap, setSnap] = useState(false)
  const on = !!item
  useLayoutEffect(() => {
    if (!on) return
    setSnap(true)
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setSnap(false)))
    return () => cancelAnimationFrame(id)
  }, [on])
  if (!h) return null
  const { box } = h
  const fade = `opacity ${FADE_MS}ms ease-out`
  const glide = ['left', 'top', 'width', 'height'].map(k => `${k} ${GLIDE_MS}ms ${EASE}`).join(', ')
  return (
    <div className={`pointer-events-none absolute z-20 ${className}`}
      style={{ left: box.x - pad, top: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2, opacity: on ? 1 : 0, transition: snap ? fade : `${glide}, ${fade}`, ...style }}>
      {children(h)}
    </div>
  )
}

/** Live boxes (from the layer's corner) for each element, or an empty box on a pinned spot, kept in step with scrolling, resizing and reloads. */
export function useBoxes(list: { id: string; t: Target }[]) {
  const { host } = useCtx()
  const [boxes, setBoxes] = useState<Record<string, Box>>({})
  const key = list.map(x => x.id + x.t.selector).join('|')
  useEffect(() => {
    if (!list.length) { setBoxes({}); return }
    let raf = 0, last = ''
    const tick = () => {
      const mount = host.mount()
      const next: Record<string, Box> = {}
      if (mount) for (const x of list) { const el = find(mount, x.t), b = el && (x.t.point ? spotAt(x.t, el, mount, host.layer) : seen(el, mount, host.layer)); if (b) next[x.id] = b }
      const s = JSON.stringify(next)
      if (s !== last) { last = s; setBoxes(next) }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return boxes
}

export type Inspect = { box: Box; label: string; touch: boolean; parent: string | null } | null

/**
 * While commenting, the design is only looked at, never used: no press, tap or key reaches it.
 * A mouse inspects by hovering and acts on click. A finger inspects with the first tap and acts
 * with a second tap on the same element (a drag still scrolls), or holds still for HOLD_MS to act
 * on that exact spot, for when no element fits. `on` is picking (the act starts a comment, or a
 * tag); `guard` is a comment being written (the act is `onGuard`). `hold` is a finger holding,
 * from the layer's corner.
 */
export function usePick(on: boolean, guard: boolean, handlers: { onPick: (t: Target) => void; onCancel: () => void; onGuard: (t: Target) => void }) {
  const { host } = useCtx()
  const [hover, setHover] = useState<Inspect>(null)
  const [hold, setHold] = useState<{ x: number; y: number } | null>(null)
  const hoverRef = useRef<Inspect>(null)
  hoverRef.current = hover
  const cb = useRef(handlers)
  cb.current = handlers
  const cur = useRef<HTMLElement | null>(null)
  // Set once the outline was moved up to a parent: a click then means that parent, not what is under the pointer.
  const raised = useRef(false)
  // When a long press last pinned. Pinning opens the composer, which sets these listeners up
  // again, so the lift of that same finger, and the click it makes, are known here instead.
  const pinnedAt = useRef(0)
  const act = useRef<(el: HTMLElement) => void>(() => {})
  const raise = useRef<() => void>(() => {})
  useEffect(() => {
    cur.current = null
    setHover(null)
    setHold(null)
    raised.current = false
    if (!on && !guard) return
    // An SVG part (an icon, a chart) stands for the nearest HTML element around it.
    const inDesign = (t: EventTarget | null) => {
      let el = t instanceof Element ? t : null
      while (el && !(el instanceof HTMLElement)) el = el.parentElement
      const m = host.mount()
      return m && el && m.contains(el) ? el as HTMLElement : null
    }
    const part = (t: EventTarget | null) => { const el = inDesign(t); return el && el !== host.mount() ? el : null }
    const parentOf = (el: HTMLElement) => { const m = host.mount(), p = el.parentElement; return m && p && p !== m && m.contains(p) ? p : null }
    const show = (el: HTMLElement | null, touch: boolean) => {
      cur.current = el
      raised.current = false
      const up = el && parentOf(el)
      const box = el && seen(el, host.mount()!, host.layer)
      setHover(el && box ? { box, label: labelOf(el), touch, parent: up ? labelOf(up) : null } : null)
    }
    // Skips to the parent of what is outlined, as often as there is one.
    raise.current = () => {
      const up = cur.current && parentOf(cur.current)
      if (!up) return
      const touch = !!hoverRef.current?.touch
      show(up, touch)
      raised.current = true
    }
    act.current = el => {
      show(null, false)
      const t = describe(host.mount()!, el)
      if (on) cb.current.onPick(t); else cb.current.onGuard(t)
    }
    // Moving between elements is debounced: the outline waits for the pointer to settle, so
    // sweeping across the design doesn't make it flicker through everything on the way.
    let timer = 0, pending: HTMLElement | null | undefined
    const settle = () => { clearTimeout(timer); pending = undefined }
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      if ((e.target as Element).closest?.('[data-inspect-ui]')) return settle()
      const el = part(e.target)
      if (el === cur.current) return settle()
      if (el === pending) return
      clearTimeout(timer)
      pending = el
      // Quick to show the first outline, steady when switching, slow to let go on leaving.
      timer = window.setTimeout(() => { pending = undefined; show(el, false) }, el ? (cur.current ? 20 : 0) : 60)
    }
    // Presses never reach the design's own handlers; the default is kept off only for a mouse,
    // so a finger can still scroll the page.
    const press = (e: Event) => { if (!inDesign(e.target)) return; e.stopPropagation(); if (!(e instanceof PointerEvent) || e.pointerType === 'mouse') e.preventDefault() }
    let start: { x: number; y: number } | null = null
    // A finger that stays put for HOLD_MS pins the comment where it is; moving lets it scroll.
    let holdTimer = 0
    const letGo = () => { clearTimeout(holdTimer); setHold(null) }
    const justPinned = () => performance.now() - pinnedAt.current < 1500
    const pin = (el: HTMLElement, x: number, y: number) => {
      pinnedAt.current = performance.now()
      setHold(null)
      show(null, true)
      navigator.vibrate?.(10)
      const t = spot(host.mount()!, el, x, y)
      if (on) cb.current.onPick(t); else cb.current.onGuard(t)
    }
    const touchStart = (e: TouchEvent) => {
      if (!inDesign(e.target)) return
      e.stopPropagation()
      letGo()
      pinnedAt.current = 0
      if (e.touches.length > 1) { start = null; return }
      const t = e.touches[0], el = part(e.target)
      start = { x: t.clientX, y: t.clientY }
      if (!el) return
      const L = host.layer.getBoundingClientRect()
      setHold({ x: t.clientX - L.left, y: t.clientY - L.top })
      holdTimer = window.setTimeout(() => pin(el, t.clientX, t.clientY), HOLD_MS)
    }
    const touchMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) letGo()
    }
    const touchCancel = () => { letGo(); start = null }
    const touchEnd = (e: TouchEvent) => {
      letGo()
      if (justPinned()) { start = null; e.preventDefault(); e.stopPropagation(); return }
      if (!inDesign(e.target) || !start) return
      e.stopPropagation()
      const t = e.changedTouches[0], moved = Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10
      start = null
      if (moved) return
      // A tap: no click follows it, so nothing in the design fires.
      e.preventDefault()
      const el = part(e.target)
      if (!el) return show(null, true)
      if (cur.current === el) act.current(el)
      else show(el, true)
    }
    const click = (e: MouseEvent) => {
      if (!inDesign(e.target)) return
      e.preventDefault(); e.stopPropagation()
      if (justPinned()) return
      settle()
      const el = part(e.target)
      if (el) act.current(raised.current && cur.current?.contains(el) ? cur.current : el)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && on) { e.preventDefault(); e.stopPropagation(); cb.current.onCancel() }
      else if (e.key === 'ArrowUp' && cur.current && !(e.target as Element).closest?.('[contenteditable], input, textarea')) { e.preventDefault(); e.stopPropagation(); raise.current() }
      // Enter or Space on something focused in the design would use it too.
      else if ((e.key === 'Enter' || e.key === ' ') && inDesign(e.target)) { e.preventDefault(); e.stopPropagation() }
    }
    // The outline follows its element however it moves: scrolling, the phone's scale, a reflow.
    let raf = 0, last = ''
    const follow = () => {
      const m = host.mount(), el = cur.current
      if (el) {
        if (!el.isConnected) show(null, false)
        else {
          const box = m && seen(el, m, host.layer), key = JSON.stringify(box)
          if (key !== last) { last = key; if (box) setHover(h => h && { ...h, box }) }
        }
      }
      raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)
    const scroll = () => { const m = host.mount(), box = cur.current && m && seen(cur.current, m, host.layer); if (box) setHover(h => h && { ...h, box }) }
    const opts = { capture: true, passive: false } as const
    const stage = host.layer.parentElement!
    // On a touch screen a held finger selects text and opens the callout; commenting holds on purpose.
    const designs = matchMedia('(pointer: coarse)').matches ? stage.querySelector<HTMLElement>('[data-layers]') : null
    designs?.style.setProperty('user-select', 'none')
    designs?.style.setProperty('-webkit-user-select', 'none')
    designs?.style.setProperty('-webkit-touch-callout', 'none')
    const noMenu = (e: Event) => { if (inDesign(e.target)) e.preventDefault() }
    stage.addEventListener('pointermove', move)
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu']) document.addEventListener(t, press, true)
    document.addEventListener('touchstart', touchStart, opts)
    document.addEventListener('touchend', touchEnd, opts)
    document.addEventListener('touchmove', touchMove, opts)
    document.addEventListener('touchcancel', touchCancel, opts)
    document.addEventListener('contextmenu', noMenu, true)
    document.addEventListener('selectstart', noMenu, true)
    document.addEventListener('click', click, true)
    document.addEventListener('keydown', key, true)
    stage.addEventListener('scroll', scroll, true)
    return () => {
      settle()
      letGo()
      for (const k of ['user-select', '-webkit-user-select', '-webkit-touch-callout']) designs?.style.removeProperty(k)
      cancelAnimationFrame(raf)
      stage.removeEventListener('pointermove', move)
      for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu']) document.removeEventListener(t, press, true)
      document.removeEventListener('touchstart', touchStart, opts)
      document.removeEventListener('touchend', touchEnd, opts)
      document.removeEventListener('touchmove', touchMove, opts)
      document.removeEventListener('touchcancel', touchCancel, opts)
      document.removeEventListener('contextmenu', noMenu, true)
      document.removeEventListener('selectstart', noMenu, true)
      document.removeEventListener('click', click, true)
      document.removeEventListener('keydown', key, true)
      stage.removeEventListener('scroll', scroll, true)
    }
  }, [on, guard, host])
  /** Acts on what a finger inspected, from the outline's own button. */
  const confirm = () => { if (cur.current) act.current(cur.current) }
  return { hover, hold, confirm, up: () => raise.current() }
}

/** A ring that fills under a holding finger, so a long press shows it is counting. */
export function HoldRing({ at }: { at: { x: number; y: number } | null }) {
  const ring = useRef<SVGCircleElement>(null)
  useLayoutEffect(() => {
    if (!at || !ring.current) return
    // It waits a beat before showing, so a plain tap doesn't flash it.
    const a = ring.current.animate([{ strokeDashoffset: 120 }, { strokeDashoffset: 0 }], { duration: HOLD_MS - 120, delay: 120, easing: 'linear', fill: 'both' })
    return () => a.cancel()
  }, [at])
  if (!at) return null
  return (
    <svg className="pointer-events-none absolute z-30 size-14 -rotate-90 animate-[spot-fade_120ms_120ms_both]" style={{ left: at.x - 28, top: at.y - 28 }} viewBox="0 0 56 56">
      <circle cx="28" cy="28" r="19" className="fill-proto-primary/15 stroke-white/70" strokeWidth="5" />
      <circle ref={ring} cx="28" cy="28" r="19" fill="none" className="stroke-proto-primary-ring" strokeWidth="3" strokeLinecap="round" strokeDasharray="120" strokeDashoffset="120" />
    </svg>
  )
}

/**
 * The outline on what is being inspected, with a button to skip to its parent. A finger gets
 * two icon buttons (parent, comment); a pointer gets the name, and the parent named beside it.
 */
export function HoverBox({ hover, verb, onConfirm, onUp }: { hover: Inspect; verb: string; onConfirm: () => void; onUp: () => void }) {
  const { host } = useCtx()
  // The buttons stay on screen: above the outline, else below it, else inside its visible part
  // (an outline taller than the screen has neither end in view). Offsets are from the outline's
  // own corner, past its padding and border.
  const spot = (box: Box, h: number, w: number): CSSProperties => {
    const H = host.layer.clientHeight, W = host.layer.clientWidth
    let y = box.y - h - 4
    if (y < 8) y = box.y + box.h + 8
    y = Math.min(Math.max(y, 8), Math.max(8, H - h - 8))
    const x = Math.min(Math.max(box.x, 8), Math.max(8, W - w - 8))
    return { top: y - (box.y - 5), left: x - (box.x - 5) }
  }
  return (
    <Glide item={hover} pad={3} className={`rounded-md border-2 border-proto-primary-ring ${hover?.touch ? 'bg-proto-primary/[.10]' : 'bg-proto-primary/[.06]'}`}>
      {h => h.touch
        ? <div data-inspect-ui style={spot(h.box, 36, h.parent ? 190 : 150)} className={`absolute flex h-9 items-center whitespace-nowrap rounded-lg bg-proto-primary text-xs font-medium text-proto-primary-fg shadow-lg ${hover ? 'pointer-events-auto' : ''}`}>
            {h.parent && <><button aria-label={`Select the parent, ${h.parent}`} onClick={onUp} onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); onUp() }} className="grid size-9 place-items-center rounded-l-lg active:bg-white/15"><Icon name="up" className="size-4" /></button><span className="h-4 w-px bg-white/30" /></>}
            <button onClick={onConfirm} onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); onConfirm() }} className={`inline-flex h-9 items-center gap-1.5 pl-2.5 pr-3 active:bg-white/15 ${h.parent ? 'rounded-r-lg' : 'rounded-lg'}`}><Icon name="comment" className="size-3.5" />{verb}</button>
          </div>
        : <span data-inspect-ui style={spot(h.box, 24, 260)} className={`absolute flex h-6 items-stretch whitespace-nowrap rounded-md bg-proto-primary text-[11px] font-medium text-proto-primary-fg shadow ${hover ? 'pointer-events-auto' : ''}`}>
            <span className="inline-flex items-center px-1.5">{verb === 'Comment' ? '' : `${verb} · `}{h.label}</span>
            {h.parent && <button onClick={onUp} title="Select the parent · ↑" className="inline-flex items-center gap-1 rounded-r-md border-l border-white/30 px-1.5 hover:bg-white/15"><Icon name="up" className="size-3" /><span className="max-w-32 truncate">{h.parent}</span></button>}
          </span>}
    </Glide>
  )
}

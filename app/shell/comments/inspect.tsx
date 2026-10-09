// Looking at the design without using it: the outline that follows the pointer (or a finger),
// the guard that keeps every press from reaching the design while commenting, and the live boxes
// pins and outlines are drawn from.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { describe, find, labelOf, rel } from './dom'
import { Icon } from './ui'
import type { Box, Target } from './types'
import { useCtx } from './ctx'

export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const GLIDE_MS = 220
export const FADE_MS = 150

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

/** Live boxes (from the layer's corner) for each element, kept in step with scrolling, resizing and reloads. */
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
      if (mount) for (const x of list) { const el = find(mount, x.t); if (el) next[x.id] = rel(el, host.layer) }
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

export type Inspect = { box: Box; label: string; touch: boolean } | null

/**
 * While commenting, the design is only looked at, never used: no press, tap or key reaches it.
 * A mouse inspects by hovering and acts on click. A finger inspects with the first tap and acts
 * with a second tap on the same element (a drag still scrolls). `on` is picking (the act starts
 * a comment, or a tag); `guard` is a comment being written (the act is `onGuard`).
 */
export function usePick(on: boolean, guard: boolean, handlers: { onPick: (t: Target) => void; onCancel: () => void; onGuard: (t: Target) => void }) {
  const { host } = useCtx()
  const [hover, setHover] = useState<Inspect>(null)
  const cb = useRef(handlers)
  cb.current = handlers
  const cur = useRef<HTMLElement | null>(null)
  const act = useRef<(el: HTMLElement) => void>(() => {})
  useEffect(() => {
    cur.current = null
    setHover(null)
    if (!on && !guard) return
    const inDesign = (t: EventTarget | null) => { const m = host.mount(); return m && t instanceof HTMLElement && m.contains(t) ? t : null }
    const part = (t: EventTarget | null) => { const el = inDesign(t); return el && el !== host.mount() ? el : null }
    const show = (el: HTMLElement | null, touch: boolean) => { cur.current = el; setHover(el ? { box: rel(el, host.layer), label: labelOf(el), touch } : null) }
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
      const el = part(e.target)
      if (el === cur.current) return settle()
      if (el === pending) return
      clearTimeout(timer)
      pending = el
      // Quick to show the first outline, steady when switching, slow to let go on leaving.
      timer = window.setTimeout(() => { pending = undefined; show(el, false) }, el ? (cur.current ? 40 : 15) : 100)
    }
    // Presses never reach the design's own handlers; the default is kept off only for a mouse,
    // so a finger can still scroll the page.
    const press = (e: Event) => { if (!inDesign(e.target)) return; e.stopPropagation(); if (!(e instanceof PointerEvent) || e.pointerType === 'mouse') e.preventDefault() }
    let start: { x: number; y: number } | null = null
    const touchStart = (e: TouchEvent) => { if (!inDesign(e.target)) return; e.stopPropagation(); const t = e.touches[0]; start = { x: t.clientX, y: t.clientY } }
    const touchEnd = (e: TouchEvent) => {
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
      settle()
      const el = part(e.target)
      if (el) act.current(el)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && on) { e.preventDefault(); e.stopPropagation(); cb.current.onCancel() }
      // Enter or Space on something focused in the design would use it too.
      else if ((e.key === 'Enter' || e.key === ' ') && inDesign(e.target)) { e.preventDefault(); e.stopPropagation() }
    }
    const scroll = () => { if (cur.current) setHover(h => h && { ...h, box: rel(cur.current!, host.layer) }) }
    const opts = { capture: true, passive: false } as const
    const stage = host.layer.parentElement!
    stage.addEventListener('pointermove', move)
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu']) document.addEventListener(t, press, true)
    document.addEventListener('touchstart', touchStart, opts)
    document.addEventListener('touchend', touchEnd, opts)
    document.addEventListener('click', click, true)
    document.addEventListener('keydown', key, true)
    stage.addEventListener('scroll', scroll, true)
    return () => {
      settle()
      stage.removeEventListener('pointermove', move)
      for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu']) document.removeEventListener(t, press, true)
      document.removeEventListener('touchstart', touchStart, opts)
      document.removeEventListener('touchend', touchEnd, opts)
      document.removeEventListener('click', click, true)
      document.removeEventListener('keydown', key, true)
      stage.removeEventListener('scroll', scroll, true)
    }
  }, [on, guard, host])
  /** Acts on what a finger inspected, from the outline's own button. */
  const confirm = () => { if (cur.current) act.current(cur.current) }
  return { hover, confirm }
}

/** The outline on what is being inspected. After a tap it says what a second tap does, and is a button for it too. */
export function HoverBox({ hover, verb, onConfirm }: { hover: Inspect; verb: string; onConfirm: () => void }) {
  return (
    <Glide item={hover} pad={3} className={`rounded-md border-2 border-proto-primary-ring ${hover?.touch ? 'bg-proto-primary/[.10]' : 'bg-proto-primary/[.06]'}`}>
      {h => h.touch
        ? <button onClick={onConfirm} onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); onConfirm() }} className={`absolute left-0 inline-flex h-8 max-w-[calc(100vw-2rem)] items-center gap-1.5 whitespace-nowrap rounded-lg bg-proto-primary pl-2 pr-2.5 text-xs font-medium text-proto-primary-fg shadow-lg ${hover ? 'pointer-events-auto' : ''} ${h.box.y < 44 ? 'top-full mt-1.5' : '-top-10'}`}>
            <span className="max-w-40 truncate opacity-80">{h.label}</span><span className="h-3.5 w-px bg-white/30" /><Icon name="comment" className="size-3.5" />{verb}<span className="opacity-70">· or tap again</span>
          </button>
        : <span className="absolute -top-6 left-0 whitespace-nowrap rounded-md bg-proto-primary px-1.5 py-0.5 text-[11px] font-medium text-proto-primary-fg shadow">{verb === 'Comment' ? '' : `${verb} · `}{h.label}</span>}
    </Glide>
  )
}

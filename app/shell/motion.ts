// Motion for the shell: the focus-mode dock, the edge arrows, the Focus button and the
// crossfade between designs. All of it is driven from script, with eased values kept
// outside the DOM, so re-rendering the chrome never restarts an animation.

export const smooth = (x: number) => x * x * (3 - 2 * x)
const ease = (from: number, to: number, dt: number) => from + (to - from) * (1 - Math.exp(-dt / 90))
const inside = (e: PointerEvent, r: DOMRect) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom

// ---------- dock: a thin bar that grows as the pointer comes near ----------
// Distance is measured to where the open dock sits (a fixed zone), so growing never
// moves the target. Time-based easing, so throttled frames still arrive on time.
export const dock = { t: 0, target: 0, hold: 0, raf: 0, last: 0 }

function paintDock() {
  const el = document.querySelector<HTMLElement>('[data-dock]')
  if (!el) return false
  const full = el.querySelector<HTMLElement>('[data-dock-full]')!
  const now = performance.now()
  const locked = el.dataset.locked === '1' || now < dock.hold
  const goal = locked ? 1 : dock.target
  dock.t = ease(dock.t, goal, Math.min(600, now - dock.last))
  dock.last = now
  const e = smooth(Math.min(1, Math.max(0, dock.t)))
  const w = Math.min(full.offsetWidth + 8, innerWidth - 16)
  el.style.width = 72 + (w - 72) * e + 'px'
  el.style.height = 6 + 46 * e + 'px'
  el.style.marginBottom = 4 + 8 * e + 'px'
  el.style.backgroundColor = `rgb(24 24 27 / ${0.35 + 0.57 * e})`
  full.style.opacity = String(Math.max(0, (e - 0.45) / 0.55))
  full.style.transform = `translate(-50%, -50%) scale(${0.92 + 0.08 * e})`
  full.style.pointerEvents = e > 0.6 ? 'auto' : 'none'
  // Frames run only while it moves (or a hold is pending); pointer moves start them again.
  return Math.abs(goal - dock.t) > 0.002 || now < dock.hold
}

export function runDock() {
  if (dock.raf) return
  dock.last = performance.now() - 16
  const frame = () => { dock.raf = paintDock() ? requestAnimationFrame(frame) : 0 }
  paintDock()
  dock.raf = requestAnimationFrame(frame)
}

// ---------- edge arrows: fade in as the pointer nears their side ----------
export const edge = { t: {} as Record<string, number>, target: {} as Record<string, number>, hover: {} as Record<string, boolean>, w: {} as Record<string, number>, last: 0, raf: 0 }

function paintEdges() {
  const now = performance.now(), dt = Math.min(600, now - edge.last)
  edge.last = now
  let moving = false
  for (const el of document.querySelectorAll<HTMLElement>('[data-edge]')) {
    const k = el.dataset.edge!, goal = edge.target[k] || 0
    const t = edge.t[k] = ease(edge.t[k] || 0, goal, dt)
    if (Math.abs(goal - t) > 0.002) moving = true
    const e = smooth(t), dir = k.endsWith('prev') ? -1 : 1
    el.style.opacity = String(e)
    el.style.transform = `translateX(${dir * (1 - e) * 14}px) scale(${0.85 + 0.15 * e})`
    el.style.pointerEvents = e > 0.3 ? 'auto' : 'none'
  }
  return moving
}

function runEdges() {
  if (edge.raf) return
  edge.last = performance.now() - 16
  const frame = () => { edge.raf = paintEdges() ? requestAnimationFrame(frame) : 0 }
  edge.raf = requestAnimationFrame(frame)
}

// The label's width comes from its text, so a click (which re-renders the button) glides
// from the old variant name's width to the new one instead of regrowing from zero.
export function setEdgeLabel(btn: HTMLElement, open: boolean, changed = false) {
  const label = btn.querySelector<HTMLElement>('[data-edge-label]')!
  const text = label.firstElementChild as HTMLElement
  const w = open ? text.offsetWidth : 0
  label.style.width = w + 'px'
  label.style.opacity = open ? '1' : '0'
  label.style[btn.dataset.edge!.endsWith('prev') ? 'marginLeft' : 'marginRight'] = open ? '8px' : '0px'
  if (changed) text.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' })
  edge.w[btn.dataset.edge!] = w
}

// After the chrome re-renders under a hovered arrow, keep its label open on the new name.
export function restoreEdgeLabels() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const b of document.querySelectorAll<HTMLElement>('[data-edge]')) if (edge.hover[b.dataset.edge!]) setEdgeLabel(b, true, true)
  }))
}

// ---------- Focus button: visible while the pointer is over the design ----------
// Kept in script, not CSS :hover: a re-created button only gets :hover after the next
// mouse move, so it would vanish and fade back in on every variant switch.
export const stageHover = { on: false }

function showFocusBtn(on: boolean) {
  stageHover.on = on
  const b = document.querySelector<HTMLElement>('[data-focus-btn]')
  if (b) b.style.opacity = on ? '1' : '0'
}

export const canHover = () => matchMedia('(hover: hover)').matches

export function installPointerTracking() {
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return
    const d = document.querySelector<HTMLElement>('[data-dock]')
    if (d) {
      const half = (d.querySelector<HTMLElement>('[data-dock-full]')!.offsetWidth + 8) / 2
      const dx = Math.max(0, Math.abs(e.clientX - innerWidth / 2) - half)
      const dy = Math.max(0, innerHeight - 64 - e.clientY)
      dock.target = Math.min(1, Math.max(0, 1 - (Math.hypot(dx, dy) - 12) / 170))
      runDock()
    }
    const arrows = document.querySelectorAll<HTMLElement>('[data-edge]')
    for (const el of arrows) {
      const z = el.closest('[data-zone]')!.getBoundingClientRect()
      const dist = el.dataset.edge!.endsWith('prev') ? e.clientX - z.left : z.right - e.clientX
      edge.target[el.dataset.edge!] = inside(e, z) ? Math.min(1, Math.max(0, 1 - (dist - 24) / 160)) : 0
    }
    if (arrows.length) runEdges()
    const b = document.querySelector<HTMLElement>('[data-focus-btn]')
    if (b) {
      const on = inside(e, b.closest('[data-zone]')!.getBoundingClientRect())
      if (on !== stageHover.on) showFocusBtn(on)
    }
  })
  document.addEventListener('mouseleave', () => {
    dock.target = 0
    runDock()
    for (const k in edge.target) edge.target[k] = 0
    runEdges()
    showFocusBtn(false)
  })
  document.addEventListener('pointerover', e => {
    const b = (e.target as Element).closest?.<HTMLElement>('[data-edge]')
    if (b && e.pointerType === 'mouse' && !edge.hover[b.dataset.edge!]) { edge.hover[b.dataset.edge!] = true; setEdgeLabel(b, true) }
  })
  document.addEventListener('pointerout', e => {
    const b = (e.target as Element).closest?.<HTMLElement>('[data-edge]')
    if (b && b.isConnected && !b.contains(e.relatedTarget as Node)) { edge.hover[b.dataset.edge!] = false; setEdgeLabel(b, false) }
  })
  // Touch has no hover: a tap on the closed dock opens it for a few seconds.
  addEventListener('pointerdown', e => {
    if (!document.querySelector('[data-dock]') || e.pointerType === 'mouse') return
    if ((e.target as Element).closest('[data-dock]')) { if (dock.t < 0.6) dock.hold = performance.now() + 4000 }
    else if (!(e.target as Element).closest('[data-pop]')) dock.hold = 0
    runDock()
  })
}

// ---------- crossfade ----------
// The new layer sits under the old one at full opacity; the old one fades out on top and
// is then disposed. Nothing is ever half see-through, the controls stay above both, and a
// quick second switch just stacks another fading layer.
export function fadeOut(el: HTMLElement, done: () => void) {
  el.inert = true
  el.style.pointerEvents = 'none'
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done()
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' })
    .finished.then(done, done)
}

// Naming, finding and measuring things inside the mounted design. A design is whatever the
// shell mounted for the variant (`[data-mount]`); every selector is rooted there, and every
// position sent to the agent is from the variant root's top left in CSS px, with a phone frame's
// zoom taken out, so it means the same on any screen.
import type { Box, Target } from './types'

const nice = (s: string) => { const t = s.replace(/[-_]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1) }
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
const textOf = (el: HTMLElement) => squash(el.innerText ?? '')

/** The mount's origin: the variant's own root, which scrolls with the content. */
const originOf = (mount: HTMLElement) => (mount.firstElementChild as HTMLElement | null) ?? mount
/** A phone's frame is zoomed to fit the stage; rects read in screen px, the design lives in CSS px. */
export const zoomOf = (mount: HTMLElement) => parseFloat(mount.closest<HTMLElement>('[data-phone]')?.style.zoom || '') || 1

/** `box` of `el` within `host`, in screen px (for drawing over the design). */
export function rel(el: Element, host: Element): Box {
  const r = el.getBoundingClientRect(), h = host.getBoundingClientRect()
  return { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height }
}

/** A readable name: its own (data-shoot, aria-label, alt), else what it says, else its tag, and where it sits. */
export function labelOf(el: HTMLElement) {
  const shoot = el.dataset.shoot
  const own = shoot ? nice(shoot) : squash(el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || '')
  if (own) return own
  const text = textOf(el)
  const say = text && text.length <= 28 ? `“${text}”` : el.tagName.toLowerCase()
  const near = el.parentElement?.closest<HTMLElement>('[data-shoot]')
  return near ? `${say} in ${nice(near.dataset.shoot!)}` : say
}

/** From the mount down, one `tag:nth-child(n)` per level. */
function pathOf(mount: HTMLElement, el: HTMLElement) {
  const parts: string[] = []
  for (let e: HTMLElement | null = el; e && e !== mount; e = e.parentElement) {
    const i = [...(e.parentElement?.children ?? [])].indexOf(e) + 1
    parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${i})`)
  }
  return `:scope > ${parts.join(' > ')}`
}

export function describe(mount: HTMLElement, el: HTMLElement): Target {
  const r = el.getBoundingClientRect(), o = originOf(mount).getBoundingClientRect(), z = zoomOf(mount)
  const text = textOf(el)
  return {
    label: labelOf(el),
    selector: pathOf(mount, el),
    ...(el.dataset.shoot ? { shoot: el.dataset.shoot } : {}),
    ...(el.dataset.src ? { src: el.dataset.src } : {}),
    tag: el.tagName.toLowerCase(),
    text: text.slice(0, 80),
    rect: { x: Math.round((r.left - o.left) / z), y: Math.round((r.top - o.top) / z), w: Math.round(r.width / z), h: Math.round(r.height / z) },
  }
}

export function find(mount: HTMLElement | null, t: Pick<Target, 'selector'>): HTMLElement | null {
  try { return mount ? mount.querySelector<HTMLElement>(t.selector) : null } catch { return null }
}

// ---------- the parts of a design, for tagging with @ ----------
const PARTS = '[data-shoot], h1, h2, h3, h4, button, a[href], input, textarea, select, img, label, [role=button], [role=tab], [role=link], [role=menuitem]'
const GROUPS = 'section, nav, header, footer, main, aside, form, dialog, [role=dialog], [role=menu], [role=tabpanel], [data-shoot]'

function groupLabel(g: HTMLElement) {
  if (g.dataset.shoot) return nice(g.dataset.shoot)
  const own = squash(g.getAttribute('aria-label') ?? '')
  if (own) return own
  const h = g.querySelector<HTMLElement>('h1, h2, h3, h4')
  if (h && textOf(h)) return textOf(h).slice(0, 40)
  return nice(g.tagName.toLowerCase())
}
export const groupOf = (el: HTMLElement) => { const g = el.parentElement?.closest<HTMLElement>(GROUPS); return g ? groupLabel(g) : 'Top of the page' }

/** What can be tagged by name, in page order, with the section each sits in. Capped, since a long page is not a menu. */
export function parts(mount: HTMLElement | null): { t: Target; group: string; el: HTMLElement }[] {
  if (!mount) return []
  const seen = new Set<HTMLElement>()
  const out: { t: Target; group: string; el: HTMLElement }[] = []
  for (const el of mount.querySelectorAll<HTMLElement>(PARTS)) {
    if (seen.has(el) || el.closest('[aria-hidden="true"], [inert]')) continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    seen.add(el)
    out.push({ t: describe(mount, el), group: groupOf(el), el })
    if (out.length >= 80) break
  }
  return out
}

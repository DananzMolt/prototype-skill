// Over the design: the outline on what the pointer is on, a numbered pin on each commented
// element (or on the spot itself, for one pinned with a long press), the ring under a holding
// finger, the outline that stays on what a new comment is being written on, the composer beside
// the one being written, and a sent comment's card.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useCtx } from './ctx'
import { describe } from './dom'
import { Glide, HoldRing, HoverBox, useBoxes, usePick } from './inspect'
import { Composer } from './composer'
import { useRows } from './list'
import { progress, type Said } from './store'
import type { Box, Item } from './types'
import { PinDot, Reply, STATE, Body } from './ui'

function Pins({ items, boxes, active, onOpen }: { items: { item: Item; done: boolean }[]; boxes: Record<string, Box>; active: string | null; onOpen: (id: string) => void }) {
  return <>{items.map(({ item: c, done }) => {
    const b = boxes[c.id]
    if (!b) return null
    const on = active === c.id
    // A spot's pin sits on the spot; an element's on its top right corner.
    const pt = !!c.target?.point
    const ring = done ? 'ring-emerald-500' : 'ring-proto-primary-ring'
    return (
      <div key={c.id}>
        {on && (pt
          ? <div className={`pointer-events-none absolute z-10 size-8 rounded-full ring-2 ${ring}`} style={{ left: b.x - 16, top: b.y - 16 }} />
          : <div className={`pointer-events-none absolute z-10 rounded-md ring-2 ${ring}`} style={{ left: b.x - 3, top: b.y - 3, width: b.w + 6, height: b.h + 6 }} />)}
        {!done && <button onClick={() => onOpen(c.id)} aria-label={`Comment ${c.n}`} className="pointer-events-auto absolute z-20 rounded-full shadow-md ring-2 ring-white transition hover:scale-110 dark:ring-zinc-950" style={pt ? { left: b.x - 10, top: b.y - 10 } : { left: b.x + b.w - 10, top: b.y - 10 }}>
          <PinDot n={c.n} />
        </button>}
      </div>
    )
  })}</>
}

export function Layer() {
  const { host, act } = useCtx()
  const { s, rows } = useRows()
  const m = s.mode
  const picking = m.kind === 'pick' || m.kind === 'tag'
  const editing = m.kind === 'compose' || m.kind === 'tag' ? m : null
  const editedItem = editing?.id ? s.items.find(x => x.id === editing.id) : undefined

  const { hover, hold, confirm, up } = usePick(picking && !!s.place, m.kind === 'compose' && !!s.place, {
    onPick: t => (m.kind === 'tag' ? act.tagDone(t) : act.begin(t)),
    onCancel: () => (m.kind === 'tag' ? act.tagDone(null) : act.stop()),
    onGuard: act.guard,
  })
  const verb = m.kind === 'tag' ? 'Tag' : m.kind === 'compose' ? 'Comment here instead' : s.held ? 'Continue your comment' : 'Comment'

  // ⌥-click comments on one element without turning comment mode on.
  useEffect(() => {
    if (!s.place || m.kind !== 'idle') return
    const alt = (e: MouseEvent) => {
      const mount = host.mount(), t = e.target as HTMLElement
      if (!e.altKey || !mount || !mount.contains(t) || t === mount) return
      e.preventDefault(); e.stopPropagation()
      act.begin(describe(mount, t))
    }
    document.addEventListener('click', alt, true)
    return () => document.removeEventListener('click', alt, true)
  }, [host, act, s.place, m.kind])

  // Only comments are on the design; a decision (Pick, More, Build) is on the variant as a whole.
  const here = rows.filter(r => r.here && r.item.target)
  const listed = here.map(r => ({ id: r.item.id, t: r.item.target! }))
  if (editing && !editing.id) listed.push({ id: '__new', t: editing.target })
  const boxes = useBoxes(listed)
  if (!s.place) return null
  const phone = s.place.phone
  const nextN = Math.max(0, ...s.items.filter(i => i.proto === s.place!.proto && i.variant === s.place!.variant).map(i => i.n)) + 1
  // What a new comment is on stays outlined while it is written (an existing one is outlined by its pin).
  const onNew = editing && !editing.id ? boxes['__new'] : undefined
  const onSpot = !!editing?.target.point
  const opened = !editing && s.active ? rows.find(r => r.item.id === s.active && r.here) : undefined
  return (
    <>
      <HoverBox hover={hover} verb={verb} onConfirm={confirm} onUp={up} />
      <HoldRing at={hold} />
      <Glide item={onNew && !onSpot ? { box: onNew } : null} pad={3} className="rounded-md border-2 border-proto-primary-ring bg-proto-primary/[.08]">{() => null}</Glide>
      {onNew && onSpot && <div className="pointer-events-none absolute z-10 size-8 rounded-full ring-2 ring-proto-primary-ring" style={{ left: onNew.x - 16, top: onNew.y - 16 }} />}
      <Pins items={here.map(r => ({ item: r.item, done: r.state === 'done' }))} boxes={boxes} active={s.active} onOpen={act.open} />
      {editing && (
        <Composer key={editing.id ?? editing.target.selector} target={editing.target} n={editedItem?.n ?? nextN} place={boxes[editing.id ?? '__new'] ?? null}
          sheet={phone} tagging={m.kind === 'tag'} editing={!!editedItem} id={editedItem?.id}
          initial={editedItem ?? s.held ?? undefined} />
      )}
      {opened && <ReadCard row={opened} box={boxes[opened.item.id]} />}
    </>
  )
}

/** A sent or answered comment, opened from the list: what was asked and what Claude did, small, under its element. */
function ReadCard({ row, box }: { row: { item: Item; state: ReturnType<typeof progress>['state']; reply: Said | null; here: boolean }; box?: Box }) {
  const { host, act } = useCtx()
  const el = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); act.close() } }
    // A press anywhere else puts it away (the press still does what it was for), and so does
    // a minute of nobody touching it. The list and the pins open their own.
    const away = (e: PointerEvent) => {
      const t = e.target as Element
      if (el.current?.contains(t) || t.closest?.('[data-cbody], [role=dialog], [data-inspect-ui]') || t.closest?.('button[aria-label^="Comment "]')) return
      act.close()
    }
    const timer = window.setTimeout(act.close, 60_000)
    document.addEventListener('keydown', k, true)
    document.addEventListener('pointerdown', away, true)
    return () => { document.removeEventListener('keydown', k, true); document.removeEventListener('pointerdown', away, true); clearTimeout(timer) }
  }, [act, row.item.id])
  // Under the element and its outline; above it only when there is no room below.
  useLayoutEffect(() => {
    if (!box || !el.current) return
    const H = host.layer.clientHeight, W = host.layer.clientWidth, w = el.current.offsetWidth, h = el.current.offsetHeight
    const below = box.y + box.h + 10
    const top = below + h <= H - 8 ? below : box.y - 10 - h >= 8 ? box.y - 10 - h : Math.max(8, Math.min(below, H - h - 8))
    setAt({ left: Math.min(Math.max(box.x, 8), Math.max(8, W - w - 8)), top })
  }, [box?.x, box?.y, box?.w, box?.h, row.reply?.text, host])
  if (!box) return null
  const { item, state, reply } = row
  return (
    <div ref={el} className="pointer-events-auto absolute z-30 w-[min(15rem,calc(100%-1rem))] rounded-xl border border-black/10 bg-white p-2 text-[11px] leading-4 shadow-xl shadow-black/15 dark:border-white/10 dark:bg-zinc-900" style={{ left: at?.left ?? box.x, top: at?.top ?? box.y + box.h + 10, visibility: at ? 'visible' : 'hidden' }}>
      <div className="flex items-center gap-1.5 text-[10px]">
        <PinDot n={item.n} done={state === 'done'} size="sm" />
        <span dir="auto" className="min-w-0 flex-1 truncate font-medium text-zinc-500">{item.target?.label}</span>
        <span className={`shrink-0 ${STATE[state].cls}`}>{STATE[state].label}</span>
      </div>
      <Body c={item} className="mt-1 block text-zinc-800 dark:text-zinc-200" />
      {reply && <span className="mt-1.5 block"><Reply text={reply.text} by={reply.by} small /></span>}
    </div>
  )
}

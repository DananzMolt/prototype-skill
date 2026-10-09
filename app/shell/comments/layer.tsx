// Over the design: the outline on what the pointer is on, a numbered pin on each commented
// element, the composer beside the one being written, and a sent comment's card.
import { useEffect } from 'react'
import { useCtx } from './ctx'
import { describe } from './dom'
import { HoverBox, useBoxes, usePick } from './inspect'
import { Composer } from './composer'
import { CommentRow, useRows } from './list'
import { progress } from './store'
import type { Box, Item } from './types'
import { PinDot } from './ui'

function Pins({ items, boxes, active, onOpen }: { items: { item: Item; done: boolean }[]; boxes: Record<string, Box>; active: string | null; onOpen: (id: string) => void }) {
  return <>{items.map(({ item: c, done }) => {
    const b = boxes[c.id]
    if (!b) return null
    const on = active === c.id
    return (
      <div key={c.id}>
        {on && <div className="pointer-events-none absolute z-10 rounded-md ring-2 ring-proto-primary-ring" style={{ left: b.x - 3, top: b.y - 3, width: b.w + 6, height: b.h + 6 }} />}
        <button onClick={() => onOpen(c.id)} aria-label={`Comment ${c.n}`} className={`pointer-events-auto absolute z-20 rounded-full shadow-md ring-2 ring-white transition hover:scale-110 dark:ring-zinc-950 ${done && !on ? 'opacity-50' : ''}`} style={{ left: b.x + b.w - 10, top: b.y - 10 }}>
          <PinDot n={c.n} done={done} />
        </button>
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

  const { hover, confirm } = usePick(picking && !!s.place, m.kind === 'compose' && !!s.place, {
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

  const here = rows.filter(r => r.here)
  const listed = here.map(r => ({ id: r.item.id, t: r.item.target }))
  if (editing && !editing.id) listed.push({ id: '__new', t: editing.target })
  const boxes = useBoxes(listed)
  if (!s.place) return null
  const phone = s.place.phone
  const nextN = Math.max(0, ...s.items.filter(i => i.proto === s.place!.proto && i.variant === s.place!.variant).map(i => i.n)) + 1
  const opened = !editing && s.active ? rows.find(r => r.item.id === s.active && r.here) : undefined
  return (
    <>
      <HoverBox hover={hover} verb={verb} onConfirm={confirm} />
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

/** A sent or answered comment, opened from its pin: what was asked and what Claude did. */
function ReadCard({ row, box }: { row: { item: Item; state: ReturnType<typeof progress>['state']; reply: string | null; here: boolean }; box?: Box }) {
  const { host, act } = useCtx()
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); act.close() } }
    document.addEventListener('keydown', k, true)
    return () => document.removeEventListener('keydown', k, true)
  }, [act])
  const lay = host.layer.getBoundingClientRect()
  if (!box) return null
  const W = 300, right = box.x + box.w + 12 + W < lay.width - 8
  const x = right ? box.x + box.w + 12 : Math.max(8, box.x - 12 - W)
  return (
    <div className="pointer-events-auto absolute z-30 rounded-2xl border border-black/10 bg-white p-1.5 text-[13px] shadow-2xl shadow-black/15 dark:border-white/10 dark:bg-zinc-900" style={{ left: x, top: Math.min(Math.max(8, box.y - 8), lay.height - 220), width: W }}>
      <CommentRow {...row} onOpen={act.close} />
    </div>
  )
}

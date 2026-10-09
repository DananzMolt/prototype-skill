// Writing a comment on one element. `@` (or the @ button) offers the design's named parts, or
// picking any element on the page; the camera captures the design around the element and opens
// the editor; ⌘↩ adds it. Whatever is written is held by the store as it is typed, so putting
// the composer away any way but Cancel or Add loses nothing.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useCtx } from './ctx'
import { find, groupOf, parts } from './dom'
import { EASE, GLIDE_MS, Glide, useBoxes } from './inspect'
import { capture, ShotEditor } from './shot'
import type { Box, Draft, Seg, Target } from './types'
import { IB, Icon, MOD, PinDot, PRIMARY } from './ui'

function readEditor(el: HTMLElement): Seg[] {
  const out: Seg[] = []
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) { if (n.textContent) out.push(n.textContent.replace(/​/g, '')) }
    else if ((n as HTMLElement).dataset?.tag) out.push({ tag: Number((n as HTMLElement).dataset.tag) })
    else if ((n as HTMLElement).tagName === 'BR') out.push('\n')
    else out.push((n as HTMLElement).innerText)
  })
  return out.filter(s => s !== '')
}
const chipNode = (label: string, i: number) => {
  const s = document.createElement('span')
  s.contentEditable = 'false'
  s.dataset.tag = String(i)
  s.className = 'mx-px inline-flex items-center rounded bg-proto-primary-soft px-1 font-medium text-proto-primary-soft-fg'
  s.textContent = `@${label}`
  return s
}
const endRange = (el: HTMLElement) => { const x = document.createRange(); x.selectNodeContents(el); x.collapse(false); return x }

type Props = {
  target: Target
  n: number
  initial?: Draft
  place: Box | null
  sheet: boolean
  tagging: boolean
  editing: boolean
  /** The saved comment being edited. */
  id?: string
}

export function Composer({ target, n, initial, place, sheet, tagging, editing, id }: Props) {
  const { host, store, act } = useCtx()
  const nudge = store.get().nudge
  const pending = store.get().pendingTag
  const ed = useRef<HTMLDivElement>(null)
  const [tags, setTags] = useState<Target[]>(initial?.tags ?? [])
  const tagsRef = useRef(tags)
  tagsRef.current = tags
  const [shot, setShot] = useState<string | undefined>(initial?.shot)
  const shotRef = useRef(shot)
  shotRef.current = shot
  const [menu, setMenu] = useState(false)
  // The @ menu: what was typed after @ filters it; row 0 is Pick on the design, the parts follow.
  const [q, setQ] = useState('')
  const [row, setRow] = useState(0)
  const [up, setUp] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const all = menu ? parts(host.mount()).filter(p => p.t.selector !== target.selector && !tags.some(t => t.selector === p.t.selector)) : []
  const ql = q.toLowerCase()
  const hits = all.filter(p => !ql || p.t.label.toLowerCase().includes(ql) || p.group.toLowerCase().includes(ql))
  // The commented element's own group comes first: what sits next to it is what gets tagged most.
  const el0 = find(host.mount(), target)
  const mine = el0 ? groupOf(el0) : 'Top of the page'
  const groups = [...new Set([mine, ...hits.map(p => p.group)])].map(g => ({ g, here: g === mine, parts: hits.filter(p => p.group === g) })).filter(x => x.parts.length)
  const flat = groups.flatMap(x => x.parts)
  // The part a row points at is lit on the design while the pointer is on the list or the arrows are used.
  const [peeking, setPeeking] = useState(false)
  const peek = menu && peeking && row > 0 ? flat[row - 1] ?? null : null
  // The row highlight is one box that glides to the active row, the way the inspect outline does.
  const menuBox = useRef<HTMLDivElement>(null)
  const [hl, setHl] = useState<{ top: number; height: number; still: boolean } | null>(null)
  const settle = useRef(0)
  const measure = (still: boolean) => {
    const m = menuBox.current, r = m?.querySelector<HTMLElement>(`[data-i="${row}"]`)
    if (!m || !r) return setHl(null)
    const a = r.getBoundingClientRect(), b = m.getBoundingClientRect()
    const top = a.top - b.top - m.clientTop
    setHl(h => h && Math.abs(h.top - top) < 0.5 && h.height === a.height && h.still === still ? h : { top, height: a.height, still })
  }
  useLayoutEffect(() => { if (menu) measure(false); else setHl(null) }, [menu, row, q, flat.length]) // eslint-disable-line react-hooks/exhaustive-deps
  // Scrolling the list moves the rows under a highlight that is already on one: it follows at once.
  const onListScroll = () => {
    measure(true)
    clearTimeout(settle.current)
    settle.current = window.setTimeout(() => setHl(h => h && { ...h, still: false }), 160)
  }
  const peekBox = useBoxes(peek ? [{ id: 'peek', t: peek.t }] : [])['peek']
  useEffect(() => { if (peek) find(host.mount(), peek.t)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [peek?.t.selector]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { list.current?.querySelector(`[data-i="${row}"]`)?.scrollIntoView({ block: 'nearest' }) }, [row])
  const openMenu = () => {
    const r = box.current?.getBoundingClientRect(), h = host.layer.getBoundingClientRect()
    setUp(sheet || (!!r && r.bottom + 360 > h.bottom && r.top - 360 > h.top))
    setRow(0); setPeeking(false); setMenu(true)
  }

  const [empty, setEmpty] = useState(!initial || !initial.body.some(s => typeof s !== 'string' || s.trim()))
  const emit = () => { if (!editing && ed.current) act.hold({ body: readEditor(ed.current), tags: tagsRef.current, shot: shotRef.current }, target) }
  useEffect(emit, [tags, shot]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (nudge) box.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 320, easing: 'ease-out' })
  }, [nudge])
  const [capturing, setCapturing] = useState(false)
  const [marking, setMarking] = useState<string | null>(null)
  const range = useRef<Range | null>(null)

  useLayoutEffect(() => {
    const el = ed.current!
    el.replaceChildren()
    initial?.body.forEach(s => el.append(typeof s === 'string' ? document.createTextNode(s) : chipNode(initial.tags[s.tag]?.label ?? '?', s.tag)))
    el.focus({ preventScroll: true })
    const sel = getSelection(); sel?.selectAllChildren(el); sel?.collapseToEnd()
    // On a phone the composer is a sheet over the bottom: the element moves up into view above it.
    if (sheet) find(host.mount(), target)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveRange = () => { const s = getSelection(); if (s?.rangeCount && ed.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange() }
  const insert = (p: Target) => {
    const el = ed.current!
    const i = tagsRef.current.length
    setTags(t => [...t, p])
    el.focus()
    const r = range.current && el.contains(range.current.startContainer) ? range.current : endRange(el)
    // The @ and what was typed after it go; the chip takes their place.
    const tn = r.startContainer
    if (tn.nodeType === 3) {
      const txt = tn.textContent!, at = txt.lastIndexOf('@', r.startOffset - 1)
      if (at >= 0 && /^[^\s@]*$/.test(txt.slice(at + 1, r.startOffset))) { r.setStart(tn, at); r.deleteContents() }
    }
    const chip = chipNode(p.label, i), space = document.createTextNode(' ')
    r.insertNode(space); r.insertNode(chip)
    const after = document.createRange(); after.setStartAfter(space); after.collapse(true)
    const s = getSelection(); s?.removeAllRanges(); s?.addRange(after)
    setEmpty(false); setMenu(false)
    saveRange()
  }
  // Something picked on the design to tag comes back here.
  useEffect(() => {
    if (!pending || tagging) return
    act.tagTaken()
    insert(pending)
  }, [pending, tagging]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const body = readEditor(ed.current!)
    if (!body.some(s => typeof s !== 'string' || s.trim()) && !tags.length) return
    act.save({ body, tags, shot }, target, id)
  }
  const shoot = async () => {
    setCapturing(true)
    try { const url = await capture(host.mount(), target, host.dark()); if (url) setMarking(url) } finally { setCapturing(false) }
  }

  const W = 312
  const lay = host.layer.getBoundingClientRect()
  let style: CSSProperties = {}
  if (!sheet && place) {
    const right = place.x + place.w + 12 + W < lay.width - 8
    const left = place.x - 12 - W > 8
    const x = right ? place.x + place.w + 12 : left ? place.x - 12 - W : Math.min(Math.max(8, place.x), lay.width - W - 8)
    const y = right || left ? Math.min(Math.max(8, place.y - 8), lay.height - 260) : Math.min(place.y + place.h + 12, lay.height - 260)
    style = { left: x, top: Math.max(8, y), width: W }
  }
  const keys = (e: React.KeyboardEvent) => {
    if (menu && !e.metaKey && !e.ctrlKey) {
      const count = flat.length + 1
      if (e.key === 'ArrowDown') { e.preventDefault(); setPeeking(true); setRow(a => (a + 1) % count); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPeeking(true); setRow(a => (a - 1 + count) % count); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (row === 0) { setMenu(false); act.tagPick() } else insert(flat[row - 1].t); return }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (menu) setMenu(false); else act.close() }
  }
  const refocus = () => requestAnimationFrame(() => ed.current?.focus())
  return (
    <>
      <Glide item={peek && peekBox ? { box: peekBox, label: peek.t.label } : null} pad={4} className="rounded-lg ring-2 ring-proto-primary-ring" style={{ boxShadow: '0 0 0 9999px rgb(9 9 11 / 0.32)' }}>
        {h => <span className="absolute -top-7 left-0 whitespace-nowrap rounded-md bg-proto-primary px-1.5 py-0.5 text-[11px] font-medium text-proto-primary-fg shadow">@{h.label}</span>}
      </Glide>
      <div ref={box} data-composer onKeyDown={keys} className={`pointer-events-auto z-30 flex flex-col rounded-2xl border border-black/10 bg-white text-[13px] text-zinc-900 shadow-2xl shadow-black/15 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 ${sheet ? 'absolute inset-x-2 bottom-2' : 'absolute'} ${tagging ? 'opacity-60' : ''}`} style={style}>
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <PinDot n={n} size="sm" />
          <span dir="auto" className="min-w-0 flex-1 truncate text-xs font-medium">{target.label}</span>
          {target.src && <span className="shrink-0 font-mono text-[11px] text-zinc-400">{target.src}</span>}
        </div>
        <div className="relative px-3 pt-1.5">
          <div ref={ed} contentEditable suppressContentEditableWarning role="textbox" aria-label="Comment" aria-multiline="true" dir="auto"
            onInput={() => {
              saveRange(); setEmpty(!ed.current!.innerText.trim()); emit()
              const s = getSelection(), node = s?.anchorNode
              const m = (node?.nodeType === 3 ? node.textContent!.slice(0, s!.anchorOffset) : '').match(/@([^\s@]{0,24})$/)
              if (m) { if (!menu) openMenu(); setQ(m[1]); setRow(m[1] ? 1 : 0); setPeeking(!!m[1]) } else if (menu) setMenu(false)
            }}
            onKeyUp={saveRange} onMouseUp={saveRange} onBlur={saveRange}
            className="max-h-40 min-h-[52px] overflow-y-auto whitespace-pre-wrap break-words py-1 leading-5 outline-none [@media(pointer:coarse)]:min-h-[60px] [@media(pointer:coarse)]:text-base [@media(pointer:coarse)]:leading-6" />
          {empty && <span className="pointer-events-none absolute left-3 top-2.5 text-zinc-400 [@media(pointer:coarse)]:text-base [@media(pointer:coarse)]:leading-6">What should change? @ tags another element</span>}
          {menu && (
            <div ref={menuBox} className={`absolute inset-x-2 z-10 flex max-h-[min(22rem,60vh)] flex-col overflow-hidden rounded-xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-900 ${up ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
              {hl && <div className="pointer-events-none absolute inset-x-1 rounded-lg bg-proto-primary-soft" style={{ top: hl.top, height: hl.height, transition: hl.still ? 'none' : ['top', 'height'].map(k => `${k} ${GLIDE_MS}ms ${EASE}`).join(', ') }} />}
              <div className="relative shrink-0 p-1 pb-0">
                <button data-i="0" onMouseDown={e => { e.preventDefault(); setMenu(false); act.tagPick() }} onMouseEnter={() => { setRow(0); setPeeking(false) }}
                  className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-start font-medium text-proto-primary-soft-fg"><Icon name="target" className="size-4" />Pick on the design…<span className="ms-auto text-[11px] font-normal text-zinc-400">anything</span></button>
              </div>
              <div ref={list} onScroll={onListScroll} onMouseLeave={() => setPeeking(false)} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
                {groups.map(({ g, here, parts: ps }) => (
                  <div key={g}>
                    <div className="sticky top-0 z-[2] flex items-center gap-1.5 bg-white px-2 pb-1 pt-2 text-[11px] font-medium text-zinc-400 dark:bg-zinc-900">
                      <span dir="auto" className="truncate">{g}</span>{here && <span className="rounded bg-proto-primary-soft px-1 text-[10px] text-proto-primary-soft-fg">here</span>}<span className="ms-auto font-normal tabular-nums">{ps.length}</span>
                    </div>
                    {ps.map(p => {
                      const i = flat.indexOf(p) + 1, at = ql ? p.t.label.toLowerCase().indexOf(ql) : -1
                      return (
                        <button key={p.t.selector} data-i={i} onMouseDown={e => { e.preventDefault(); insert(p.t) }} onMouseEnter={() => { setRow(i); setPeeking(true) }}
                          className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-start transition-colors duration-150 ${row === i ? 'text-proto-primary-soft-fg' : 'text-zinc-600 dark:text-zinc-400'}`}>
                          <span dir="auto" className="min-w-0 flex-1 truncate">{at >= 0 ? <>{p.t.label.slice(0, at)}<b className="font-semibold text-zinc-900 dark:text-white">{p.t.label.slice(at, at + ql.length)}</b>{p.t.label.slice(at + ql.length)}</> : p.t.label}</span>
                          {p.t.src && <span className="font-mono text-[11px] text-zinc-400">{p.t.src}</span>}
                        </button>
                      )
                    })}
                  </div>
                ))}
                {!flat.length && <p className="px-3 py-5 text-center text-xs text-zinc-400">Nothing named “{q}”. Pick it on the design instead.</p>}
              </div>
              <div className="relative z-[2] flex shrink-0 items-center gap-2 border-t border-black/[.06] bg-white px-3 py-1.5 text-[11px] text-zinc-400 dark:border-white/10 dark:bg-zinc-900">
                <span><kbd className="font-sans">↑↓</kbd> move · <kbd className="font-sans">Enter</kbd> tag · <kbd className="font-sans">Esc</kbd> close</span>
                <span className="ms-auto tabular-nums">{q ? `${flat.length} of ${all.length}` : `${all.length} parts`}</span>
              </div>
            </div>
          )}
        </div>
        {(shot || capturing) && (
          <div className="flex items-center gap-2 px-3 pb-1 pt-1.5">
            {capturing ? <span className="grid h-12 w-20 place-items-center rounded-lg bg-zinc-900/[.04] text-[11px] text-zinc-400 dark:bg-white/[.06]">Capturing…</span>
              : <button onClick={() => setMarking(shot!)} title="Edit the screenshot" className="group relative h-12 w-20 overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/15"><img src={shot} alt="Screenshot" className="size-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/40 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100">Edit</span></button>}
            {shot && <button onClick={() => setShot(undefined)} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Remove</button>}
          </div>
        )}
        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <button onMouseDown={e => {
            e.preventDefault()
            if (menu) { setMenu(false); return }
            const el = ed.current!; el.focus()
            const r = range.current && el.contains(range.current.startContainer) ? range.current : endRange(el)
            const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r)
            document.execCommand('insertText', false, '@')
          }} title="Tag another element (@)" aria-label="Tag another element" className={`${IB} h-8 min-w-8 px-1.5`}><Icon name="at" /></button>
          <button onClick={shoot} title="Screenshot this part of the design, then draw on it" aria-label="Attach a screenshot" className={`${IB} h-8 min-w-8 px-1.5`}><Icon name="camera" /></button>
          {editing && <button onClick={() => id && act.remove(id)} title="Delete" aria-label="Delete comment" className={`${IB} h-8 min-w-8 px-1.5 hover:text-rose-600`}><Icon name="trash" /></button>}
          <span className="ms-auto" />
          <button onClick={() => act.cancel()} className="h-8 rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">Cancel</button>
          <button onClick={submit} disabled={empty && !tags.length} title={`${MOD} Enter`} className={`inline-flex h-8 items-center gap-1 rounded-lg pl-2 pr-3 text-xs font-semibold disabled:opacity-40 ${PRIMARY}`}><Icon name={editing ? 'check' : 'plus'} className="size-3.5" />{editing ? 'Save' : 'Add'}</button>
        </div>
      </div>
      {marking && <ShotEditor src={marking} onCancel={() => { setMarking(null); refocus() }} onDone={url => { setShot(url); setMarking(null); refocus() }} />}
    </>
  )
}

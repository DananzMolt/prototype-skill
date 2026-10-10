// A variant's own decisions, made in the page instead of by pasting its link into chat: Pick
// (marked at once; on the picked variant it reads Picked and takes the pick back), More like this
// and Build it, each with an optional short note. All three reach Claude the way comments do, a
// batch of one comment with an action and no element, so the inbox, `proto reply` and the Comments
// list treat them like any other. A wide page opens them from the bar's check button as a menu; a
// phone has them at the top of the variant sheet.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useCtx } from './ctx'
import { useStore } from './store'
import type { Action } from './types'
import { ACTION, Icon, MOD, PRIMARY, Pulse } from './ui'

/** The variant on screen, and whether it is the prototype's pick. */
export type Subject = { proto: string; variant: string; name: string; picked: boolean }
type Ask = 'more' | 'build'

const NOTE: Record<Ask, { title: (v: string) => string; hint: string; done: (v: string) => string }> = {
  more: { title: v => `More like ${v}`, hint: 'Optional: what to keep, what to push further', done: v => `Asked for more like ${v}` },
  build: { title: v => `Build ${v}`, hint: 'Optional: anything to know before building it', done: v => `Asked to build ${v}` },
}

export function Decide({ subject, sheet = false, onDone }: { subject: Subject; sheet?: boolean; onDone?: () => void }) {
  const { store, act } = useCtx()
  const listening = !!useStore(store).inbox?.listening
  const [ask, setAsk] = useState<Ask | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [said, setSaid] = useState<Ask | null>(null)
  // A pick shows at once; the page's copy of meta.ts catches up a moment later.
  const [want, setWant] = useState<boolean | null>(null)
  useEffect(() => { if (want !== null && subject.picked === want) setWant(null) }, [subject.picked, want])
  const picked = want ?? subject.picked
  const v = subject.variant
  const menu = useRef<HTMLDivElement>(null)

  const send = async (a: Action, words = '') => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await act.decide(subject, a, words)
      if (a === 'more' || a === 'build') { setAsk(null); setNote(''); setSaid(a) }
      else { setWant(a === 'pick'); onDone?.() }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send') }
    finally { setBusy(false) }
  }
  // What was asked is said for a moment, then the menu goes away (the sheet goes back to its choices).
  useEffect(() => {
    if (!said) return
    const t = window.setTimeout(() => { setSaid(null); onDone?.() }, 1800)
    return () => clearTimeout(t)
  }, [said]) // eslint-disable-line react-hooks/exhaustive-deps
  // As a menu, the first choice takes the focus, so P then Enter picks; the arrows move between them.
  useLayoutEffect(() => { if (!sheet && !ask && !said) menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true }) }, [sheet, ask, said])
  const arrows = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...menu.current!.querySelectorAll<HTMLElement>('[role=menuitem]')], i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
  // In the note, Esc goes back to the choices instead of closing everything, and ⌘↩ sends.
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAsk(null); setError('') }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ask) { e.preventDefault(); void send(ask, note) }
  }
  const status = <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-zinc-500"><Pulse on={listening} className="size-1.5" /><span className="truncate">{listening ? 'Claude is listening' : 'Claude sees this on its next turn'}</span></span>
  const oops = error && <p role="alert" className="mt-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-300">{error}</p>

  if (said) return (
    <div role="status" className={sheet ? 'px-1 py-1.5' : 'p-3'}>
      <p className="flex items-center gap-2 text-[13px] font-medium"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-proto-primary-soft text-proto-primary-soft-fg"><Icon name="check" className="size-3" /></span>{NOTE[said].done(v)}</p>
      <p className="mt-1.5 ps-7 text-xs text-zinc-500">{listening ? 'Sent to Claude.' : 'It waits until Claude listens, on its next turn.'}</p>
    </div>
  )

  if (ask) return (
    <div className={sheet ? 'px-1' : 'p-2'} onKeyDown={keys}>
      <div className="flex items-center gap-1 pb-1.5">
        <button onClick={() => { setAsk(null); setError('') }} aria-label="Back" className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"><Icon name="left" /></button>
        <Icon name={ACTION[ask].icon} className="size-3.5 text-zinc-400" />
        <span className="text-[13px] font-semibold">{NOTE[ask].title(v)}</span>
      </div>
      <textarea autoFocus value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={600} dir="auto" placeholder={NOTE[ask].hint} aria-label={`Note for ${NOTE[ask].title(v)}`}
        className="block w-full resize-none rounded-xl bg-zinc-900/[.04] px-3 py-2 text-[13px] leading-5 outline-none ring-1 ring-inset ring-transparent placeholder:text-zinc-400 focus:ring-proto-primary-ring dark:bg-white/[.06] [@media(pointer:coarse)]:text-base" />
      {oops}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <button onClick={() => { setAsk(null); setError('') }} className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">Cancel</button>
        <button onClick={() => send(ask, note)} disabled={busy} title={`${MOD} Enter`} className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-lg ps-2 pe-3 text-xs font-semibold disabled:opacity-50 ${PRIMARY}`}><Icon name="send" className="size-3.5" />{busy ? 'Sending…' : 'Send'}</button>
      </div>
      <div className={sheet ? 'mt-1 px-1' : 'mx-1 mt-2 border-t border-black/[.06] pt-2 dark:border-white/10'}>{status}</div>
    </div>
  )

  // The choices: a menu down the side of a wide page, three quiet buttons across a phone's sheet.
  const pickLabel = picked ? `Picked ${v}` : `Pick ${v}`
  const pickTitle = picked ? 'Picked. Choose it again to take the pick back' : 'Mark this design as the one, now'
  if (sheet) {
    const btn = 'inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium ring-1 ring-inset disabled:opacity-50'
    const quiet = `${btn} bg-white text-zinc-700 ring-black/[.08] active:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-white/10 dark:active:bg-zinc-700`
    return (
      <div className="px-1">
        <p className="flex min-w-0 items-center gap-1.5 px-1 pb-2 text-xs text-zinc-500"><b className="font-semibold text-zinc-700 dark:text-zinc-200">{v}</b><span dir="auto" className="truncate">{subject.name}</span></p>
        <div className="flex gap-1.5">
          <button onClick={() => send(picked ? 'unpick' : 'pick')} disabled={busy} aria-pressed={picked} aria-label={pickTitle} className={`shrink-0 px-3 ${picked ? `${btn} bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300` : quiet}`}><Icon name="check" className="size-4" />{picked ? 'Picked' : 'Pick'}</button>
          <button onClick={() => setAsk('more')} className={`flex-1 px-2 ${quiet}`}><Icon name="more" className="size-4" /><span className="truncate">More like this</span></button>
          <button onClick={() => setAsk('build')} className={`shrink-0 px-3 ${quiet}`}><Icon name="code" className="size-4" />Build it</button>
        </div>
        {oops}
        <p className="mt-2 flex items-center px-1">{status}</p>
      </div>
    )
  }
  const row = 'flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-start text-[13px] outline-none hover:bg-zinc-900/[.04] focus-visible:bg-zinc-900/[.06] disabled:opacity-50 dark:hover:bg-white/[.06] dark:focus-visible:bg-white/10'
  return (
    <div ref={menu} role="menu" aria-label={`${v} · ${subject.name}`} onKeyDown={arrows} className="p-1.5">
      <div className="flex min-w-0 items-center gap-1.5 px-2 pb-1 pt-1 text-[11px] text-zinc-500"><b className="font-semibold text-zinc-700 dark:text-zinc-200">{v}</b><span dir="auto" className="truncate">{subject.name}</span></div>
      <button role="menuitem" onClick={() => send(picked ? 'unpick' : 'pick')} disabled={busy} title={pickTitle} className={`${row} ${picked ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-zinc-700 dark:text-zinc-200'}`}>
        <Icon name="check" className="size-4" /><span className="min-w-0 flex-1 truncate">{pickLabel}</span>{picked && <span className="shrink-0 text-xs font-normal text-zinc-400">Undo</span>}
      </button>
      <button role="menuitem" onClick={() => setAsk('more')} className={`${row} text-zinc-700 dark:text-zinc-200`}><Icon name="more" className="size-4" /><span className="flex-1">More like this…</span></button>
      <button role="menuitem" onClick={() => setAsk('build')} className={`${row} text-zinc-700 dark:text-zinc-200`}><Icon name="code" className="size-4" /><span className="flex-1">Build it…</span></button>
      {oops}
      <div className="mx-2 mt-1.5 border-t border-black/[.06] pb-1 pt-2 dark:border-white/10">{status}</div>
    </div>
  )
}

/** Where the menu opens on a wide page: under the bar's check button, its right edge on the button's. */
export type DecidePopProps = { open: boolean; anchor: () => HTMLElement | null; subject: Subject | null; onClose: () => void }
export function DecidePop({ open, anchor, subject, onClose }: DecidePopProps) {
  const [, redraw] = useState(0)
  useEffect(() => {
    if (!open) return
    const f = () => redraw(n => n + 1)
    addEventListener('resize', f)
    return () => removeEventListener('resize', f)
  }, [open])
  const at = open ? anchor()?.getBoundingClientRect() : null
  if (!at || !subject) return null
  // The shell closes it on Esc and on a click outside. A click inside goes no further: a choice
  // redraws the menu under it, and the shell would take a click on a removed button for one outside.
  return (
    <div data-pop onClick={e => e.stopPropagation()} className="fixed z-40 w-72 overflow-hidden rounded-2xl border border-black/10 bg-white text-[13px] text-zinc-900 shadow-xl shadow-black/10 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100" style={{ top: at.bottom + 6, right: Math.max(8, innerWidth - at.right) }}>
      <Decide key={`${subject.proto}/${subject.variant}`} subject={subject} onDone={onClose} />
    </div>
  )
}

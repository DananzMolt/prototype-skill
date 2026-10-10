// The comments as a list, the rail's body and the phone sheet's, grouped by what needs you:
// Ready to send (drafts, and the unfinished one), With Claude (sent, not done), and Done, which
// folds to one line each and opens to show what Claude said. The bottom bar is Add and Send.
import { useState } from 'react'
import { useCtx } from './ctx'
import { progress, useStore, type Said } from './store'
import type { CState, Item } from './types'
import { Body, Icon, Listening, MOD, PinDot, Reply, since, SrcTag, Working } from './ui'

export function useRows() {
  const { store, act } = useCtx()
  const s = useStore(store)
  const rows = s.items.map(item => ({ item, ...progress(item, s.inbox), here: act.here(item) }))
  rows.sort((a, b) => b.item.at - a.item.at)
  return { s, rows, drafts: s.items.filter(i => !i.sent).length }
}
type Row = ReturnType<typeof useRows>['rows'][number]

const Head = ({ title, n, tone = 'text-zinc-500' }: { title: string; n: number; tone?: string }) => (
  <h3 className={`flex items-center gap-2 px-1 pb-1.5 pt-4 text-xs font-semibold first:pt-1 ${tone}`}>{title}<span className="rounded-full bg-zinc-900/[.06] px-1.5 text-[11px] font-medium tabular-nums dark:bg-white/10">{n}</span></h3>
)
const Where = ({ item, here }: { item: Item; here: boolean }) => here ? null : <span className="shrink-0 rounded bg-zinc-900/[.05] px-1 font-mono text-[10px] text-zinc-500 dark:bg-white/10">{item.variant}</span>
// What a comment carries besides its words: its screenshot, how many it tags, where in the code it is.
const Extras = ({ item }: { item: Item }) => (item.tags.length > 0 || item.shot || item.target.src) ? (
  <span className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-zinc-400">
    {item.shot && <img src={item.shot} alt="" className="h-9 w-14 rounded-md object-cover ring-1 ring-black/10" />}
    {item.tags.length > 0 && <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-proto-primary-soft px-1.5 text-proto-primary-soft-fg"><Icon name="at" className="size-3" />{item.tags.length} tagged</span>}
    <SrcTag t={item.target} className="min-w-0" />
  </span>
) : null

/** A draft: a card you can open to edit, with a trash button. */
function Draft({ r, active, roomy, onOpen }: { r: Row; active: boolean; roomy: boolean; onOpen: () => void }) {
  const { act } = useCtx()
  const { item } = r
  return (
    <div data-shoot="comment-row" className={`rounded-2xl border p-3 transition ${active ? 'border-proto-primary-ring bg-proto-primary-soft' : 'border-black/[.08] bg-white hover:border-black/20 dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/25'}`}>
      <div className="flex items-center gap-2">
        <PinDot n={item.n} />
        <button onClick={onOpen} className="min-w-0 flex-1 truncate text-start text-xs font-medium text-zinc-500 dark:text-zinc-400"><span dir="auto">{item.target.label}</span></button>
        <Where item={item} here={r.here} />
        <button onClick={() => act.remove(item.id)} aria-label="Remove this comment" className="-me-1 grid size-8 shrink-0 place-items-center rounded-full text-zinc-400 hover:text-rose-600 active:bg-zinc-900/5 dark:active:bg-white/10"><Icon name="trash" className="size-4" /></button>
      </div>
      <button onClick={onOpen} className="mt-1 block w-full text-start"><Body c={item} className={`block ${roomy ? 'text-sm leading-5' : 'text-[12.5px] leading-[18px]'}`} /><Extras item={item} /></button>
    </div>
  )
}

/** Sent, and not done: what Claude has. */
function WithClaude({ r, active, roomy, onOpen }: { r: Row; active: boolean; roomy: boolean; onOpen: () => void }) {
  const { item } = r
  return (
    <button onClick={onOpen} data-shoot="comment-row" className={`flex w-full items-start gap-3 rounded-2xl p-3 text-start transition ${active ? 'bg-proto-primary-soft ring-1 ring-proto-primary-ring' : 'bg-proto-primary-soft/60 hover:bg-proto-primary-soft'}`}>
      <span className="mt-1"><Working /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-xs"><span dir="auto" className="min-w-0 flex-1 truncate font-medium text-zinc-500 dark:text-zinc-400">{item.target.label}</span><Where item={item} here={r.here} /><span className="shrink-0 text-proto-primary-soft-fg">{r.state === 'seen' ? 'Claude is on it' : 'Sent'}</span></span>
        <Body c={item} className={`mt-0.5 block ${roomy ? 'text-sm leading-5' : 'text-[12.5px] leading-[18px]'}`} />
      </span>
    </button>
  )
}

/** Done: one line, opening to Claude's reply, and a way to see it on the design. */
function DoneRow({ r, active, roomy, onShow }: { r: Row; active: boolean; roomy: boolean; onShow: () => void }) {
  const [open, setOpen] = useState(false)
  const { item, reply } = r
  const when = since(reply?.at)
  return (
    <div data-shoot="comment-row">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className={`flex w-full items-center gap-2.5 rounded-xl px-1 text-start active:bg-zinc-900/[.04] dark:active:bg-white/5 ${roomy ? 'h-11' : 'h-9'} ${active ? 'bg-emerald-500/10' : ''}`}>
        <PinDot n={item.n} done />
        <span className={`min-w-0 flex-1 truncate text-zinc-500 ${roomy ? 'text-[13.5px]' : 'text-[12.5px]'}`}><Body c={item} /></span>
        <Where item={item} here={r.here} />
        <Icon name="right" className={`size-4 text-zinc-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 pb-2 pe-1 ps-8">
          <p className="flex items-center gap-2 text-xs text-zinc-400"><span dir="auto" className="min-w-0 truncate">{item.target.label}</span>{when && <span className="shrink-0">· {when === 'now' ? 'just now' : `${when} ago`}</span>}<button onClick={onShow} className="ms-auto shrink-0 font-medium text-proto-primary-soft-fg hover:underline">Show on design</button></p>
          {reply ? <Reply text={reply.text} by={reply.by} small /> : <p className="text-xs text-zinc-400">Marked done, no note.</p>}
        </div>
      )}
    </div>
  )
}

export function CommentList({ roomy, onOpen }: { roomy?: boolean; onOpen?: (id: string) => void }) {
  const { act } = useCtx()
  const { s, rows } = useRows()
  const held = s.held && s.mode.kind !== 'compose' && s.mode.kind !== 'tag' ? s.held : null
  const on = (id: string) => s.active === id || (s.mode.kind === 'compose' && s.mode.id === id)
  const open = (id: string) => { onOpen?.(id); act.open(id) }
  const by = (st: CState[]) => rows.filter(r => st.includes(r.state))
  const drafts = by(['draft']), wait = by(['sent', 'seen']), done = by(['done'])
  if (!rows.length && !held) return <p className="px-3 py-6 text-center text-xs text-zinc-400">Nothing yet. Press C, then click anything in the design.</p>
  return (
    <div>
      {(drafts.length > 0 || held) && (
        <section aria-label="Ready to send">
          <Head title="Ready to send" n={drafts.length + (held ? 1 : 0)} />
          <div className="space-y-2">
            {held && (
              <div className="rounded-2xl border border-dashed border-proto-primary-ring/60 bg-proto-primary-soft/50 p-3">
                <div className="flex items-center gap-2 text-xs"><span className="size-1.5 rounded-full bg-proto-primary" /><span className="font-medium text-proto-primary-soft-fg">Unfinished comment</span><span dir="auto" className="min-w-0 flex-1 truncate text-end text-zinc-500">{held.target.label}</span></div>
                <Body c={held} className={`mt-1 line-clamp-2 block ${roomy ? 'text-sm leading-5' : 'text-[12.5px] leading-[18px]'}`} />
                <div className="mt-2 flex gap-1.5"><button onClick={() => { onOpen?.(''); act.resume() }} className="h-8 rounded-full bg-proto-primary px-3 text-xs font-semibold text-proto-primary-fg hover:bg-proto-primary-hover">Continue</button><button onClick={act.discardHeld} className="h-8 rounded-full px-3 text-xs font-medium text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">Discard</button></div>
              </div>
            )}
            {drafts.map(r => <Draft key={r.item.id} r={r} roomy={!!roomy} active={on(r.item.id)} onOpen={() => open(r.item.id)} />)}
          </div>
        </section>
      )}
      {wait.length > 0 && (
        <section aria-label="With Claude">
          <Head title="With Claude" n={wait.length} tone="text-proto-primary-soft-fg" />
          <div className="space-y-2">{wait.map(r => <WithClaude key={r.item.id} r={r} roomy={!!roomy} active={on(r.item.id)} onOpen={() => open(r.item.id)} />)}</div>
        </section>
      )}
      {done.length > 0 && (
        <section aria-label="Done">
          <Head title="Done" n={done.length} tone="text-emerald-700 dark:text-emerald-400" />
          <div className="divide-y divide-black/[.05] dark:divide-white/[.07]">{done.map(r => <DoneRow key={r.item.id} r={r} roomy={!!roomy} active={on(r.item.id)} onShow={() => open(r.item.id)} />)}</div>
        </section>
      )}
    </div>
  )
}

/** Send, as the round button that ends the list. */
export function SendButton({ className = '' }: { className?: string }) {
  const { act } = useCtx()
  const { s, drafts } = useRows()
  return (
    <button data-shoot="send" onClick={act.send} title={`${MOD} Enter`} disabled={!drafts || s.sending} className={`inline-flex h-12 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-zinc-900/[.06] disabled:text-zinc-400 dark:disabled:bg-white/[.08] dark:disabled:text-zinc-500 ${drafts && !s.sending ? 'bg-proto-primary text-proto-primary-fg hover:bg-proto-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-proto-primary-ring' : ''} ${className}`}>
      <Icon name="send" className="size-4" />{s.sending ? 'Sending…' : drafts ? `Send ${drafts} to Claude` : 'Nothing to send'}
    </button>
  )
}

/** Add (a round button, picking on the design) and Send, with the send error and who is listening. */
export function SendBar({ className = '', onAdd }: { className?: string; onAdd?: () => void }) {
  const { store, act } = useCtx()
  const { s } = useRows()
  return (
    <div className={`space-y-2 ${className}`}>
      {s.error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300"><span className="min-w-0 flex-1">{s.error}</span><button onClick={act.clearError} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100"><Icon name="x" className="size-3.5" /></button></p>}
      <div className="flex gap-2">
        <button data-shoot="add" onClick={onAdd ?? act.toggle} aria-label="Add a comment" title="Comment on the design · C" className="grid size-12 shrink-0 place-items-center rounded-full ring-1 ring-inset ring-black/10 hover:bg-zinc-900/5 dark:ring-white/15 dark:hover:bg-white/10"><Icon name="plus" className="size-5" /></button>
        <SendButton className="flex-1" />
      </div>
      <Listening on={!!store.get().inbox?.listening} className="justify-center" />
    </div>
  )
}
export type { Said }

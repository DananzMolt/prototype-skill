// The comments as a list: the rail's body and the phone sheet's. Each row is where a comment is,
// what it says, and what came of it; the unfinished comment sits above them.
import { useCtx } from './ctx'
import { progress, useStore } from './store'
import type { CState, Item } from './types'
import { Body, Icon, Listening, PinDot, PRIMARY, Reply, STATE } from './ui'

const ORDER: Record<CState, number> = { draft: 0, seen: 1, sent: 1, done: 2 }

export function useRows() {
  const { store, act } = useCtx()
  const s = useStore(store)
  const rows = s.items.map(item => ({ item, ...progress(item, s.inbox), here: act.here(item) }))
  rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.item.at - a.item.at)
  return { s, rows, drafts: s.items.filter(i => !i.sent).length }
}

/** A comment as a row: where it is, what it says, what came of it. */
export function CommentRow({ item, state, reply, here, active, compact, onOpen }: { item: Item; state: CState; reply: string | null; here: boolean; active?: boolean; compact?: boolean; onOpen: () => void }) {
  return (
    <button onClick={onOpen} data-shoot="comment-row" className={`block w-full rounded-xl border p-2.5 text-start transition ${active ? 'border-proto-primary-ring bg-proto-primary-soft' : state === 'done' ? 'border-transparent bg-zinc-900/[.03] hover:bg-zinc-900/[.05] dark:bg-white/[.04] dark:hover:bg-white/[.07]' : 'border-black/[.08] hover:border-black/20 dark:border-white/10 dark:hover:border-white/25'}`}>
      <span className="flex items-center gap-2 text-[11px]">
        <PinDot n={item.n} done={state === 'done'} size="sm" />
        <span dir="auto" className="min-w-0 flex-1 truncate font-medium text-zinc-500 dark:text-zinc-400">{item.target.label}</span>
        {!here && <span className="shrink-0 rounded bg-zinc-900/[.05] px-1 font-mono text-[10px] text-zinc-500 dark:bg-white/10">{item.variant}</span>}
        <span className={`flex shrink-0 items-center gap-1 ${STATE[state].cls}`}>{state === 'seen' && <span className="size-1.5 animate-pulse rounded-full bg-proto-primary" />}{STATE[state].label}</span>
      </span>
      <Body c={item} className={`mt-1 block text-[12.5px] leading-[18px] ${state === 'done' ? 'text-zinc-500' : ''} ${compact ? 'line-clamp-2' : ''}`} />
      {(item.tags.length > 0 || item.shot) && !compact && <span className="mt-1.5 flex items-center gap-2">{item.shot && <img src={item.shot} alt="" className="h-8 w-12 rounded object-cover ring-1 ring-black/10" />}<span className="text-[11px] text-zinc-400">{[item.tags.length && `${item.tags.length} tagged`, item.shot && 'screenshot'].filter(Boolean).join(' · ')}</span></span>}
      {reply && <span className="mt-2 block"><Reply text={reply} /></span>}
    </button>
  )
}

export function CommentList({ compact, onOpen }: { compact?: boolean; onOpen?: (id: string) => void }) {
  const { act } = useCtx()
  const { s, rows } = useRows()
  const held = s.held && s.mode.kind !== 'compose' && s.mode.kind !== 'tag' ? s.held : null
  const unfinished = held && (
    <div className="mb-1.5 rounded-xl border border-dashed border-proto-primary-ring/60 bg-proto-primary-soft/50 p-2.5">
      <div className="flex items-center gap-2 text-[11px]"><span className="size-1.5 rounded-full bg-proto-primary" /><span className="font-medium text-proto-primary-soft-fg">Unfinished comment</span><span dir="auto" className="min-w-0 flex-1 truncate text-end text-zinc-500">{held.target.label}</span></div>
      <Body c={held} className="mt-1 line-clamp-2 block text-[12.5px] leading-[18px]" />
      <div className="mt-2 flex gap-1.5"><button onClick={() => { onOpen?.(''); act.resume() }} className={`h-7 rounded-lg px-2.5 text-xs font-semibold ${PRIMARY}`}>Continue</button><button onClick={act.discardHeld} className="h-7 rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/10">Discard</button></div>
    </div>
  )
  if (!rows.length && !held) return <p className="px-3 py-6 text-center text-xs text-zinc-400">Nothing yet. Press C, then click anything in the design.</p>
  return (
    <div className="space-y-1.5">
      {unfinished}
      {rows.map(r => <CommentRow key={r.item.id} {...r} compact={compact} active={s.active === r.item.id || (s.mode.kind === 'compose' && s.mode.id === r.item.id)} onOpen={() => { onOpen?.(r.item.id); act.open(r.item.id) }} />)}
    </div>
  )
}

export function SendButton({ className = '', label }: { className?: string; label?: string }) {
  const { act } = useCtx()
  const { s, drafts } = useRows()
  return (
    <button data-shoot="send" onClick={act.send} disabled={!drafts || s.sending} className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:bg-zinc-900/[.06] disabled:text-zinc-400 dark:disabled:bg-white/[.08] dark:disabled:text-zinc-500 ${drafts && !s.sending ? PRIMARY : ''} ${className}`}>
      <Icon name="send" className="size-4" />{s.sending ? 'Sending…' : label ?? (drafts ? `Send ${drafts} to Claude` : 'Nothing to send')}
    </button>
  )
}

/** Send, and whether anyone will see it now. */
export function SendBar({ className = '' }: { className?: string }) {
  const { store, act } = useCtx()
  const { s } = useRows()
  return (
    <div className={`space-y-2 ${className}`}>
      {s.error && <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-500/10 px-2.5 py-2 text-xs text-rose-700 dark:text-rose-300"><span className="min-w-0 flex-1">{s.error}</span><button onClick={act.clearError} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100"><Icon name="x" className="size-3.5" /></button></p>}
      <SendButton className="w-full" />
      <Listening on={!!store.get().inbox?.listening} className="justify-center" />
    </div>
  )
}

// Small pieces the comment layer shares: icons (the shell's own set plus the comment tools), the
// primary color classes (placeholder tokens in shell.css), and a few text pieces.
import type { ReactNode } from 'react'
import type { CState, Item, Seg, Target } from './types'

const PATHS: Record<string, string> = {
  chev: 'M6 9l6 6 6-6', right: 'M9 6l6 6-6 6', left: 'M15 6l-6 6 6 6',
  check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6 6 18',
  key: 'M7.5 10a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM11.4 11.6 21 2M15.5 7.5l2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4',
  comment: 'M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4.1A8 8 0 1 1 20 12z',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  send: 'M4 12 20 4l-6 16-3-7z M11 13l9-9',
  box: 'M4 5h16v14H4z', arrow: 'M5 19 19 5M10 5h9v9', pen: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  text: 'M5 6h14M12 6v13M9 19h6', hash: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10.5 8.5h2v7',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  plus: 'M12 6v12M6 12h12', up: 'M12 19V5M6 11l6-6 6 6', branch: 'M6 3v8a4 4 0 0 0 4 4h8M14 11l4 4-4 4',
}
export function Icon({ name, className = 'size-4' }: { name: string; className?: string }) {
  return <svg className={`${className} shrink-0`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>
}

export const ROW = 'text-zinc-600 hover:bg-zinc-900/[.04] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[.06] dark:hover:text-white'
export const IB = 'inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md px-2 text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white'
export const PRIMARY = 'bg-proto-primary text-proto-primary-fg hover:bg-proto-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-proto-primary-ring'

export const STATE: Record<CState, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'text-zinc-400' },
  sent: { label: 'Sent', cls: 'text-proto-primary-soft-fg' },
  seen: { label: 'Claude is on it', cls: 'text-proto-primary-soft-fg' },
  done: { label: 'Done', cls: 'text-emerald-600 dark:text-emerald-400' },
}

export function Pulse({ on = true, className = 'size-2' }: { on?: boolean; className?: string }) {
  return on
    ? <span className={`relative inline-flex ${className}`}><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex size-full rounded-full bg-emerald-500" /></span>
    : <span className={`relative inline-flex ${className} rounded-full bg-zinc-400`} />
}

/** Whether Claude will see a send now, in the page's own words. */
export function Listening({ on, className = '' }: { on: boolean; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 text-xs text-zinc-500 ${className}`}><Pulse on={on} className="size-1.5" />{on ? 'Claude is listening' : 'Claude sees these on its next turn'}</span>
}

export const PinDot = ({ n, done, size = 'md' }: { n: number; done?: boolean; size?: 'sm' | 'md' }) => (
  <span className={`grid shrink-0 place-items-center rounded-full font-semibold tabular-nums ${size === 'sm' ? 'size-4 text-[9px]' : 'size-5 text-[10px]'} ${done ? 'bg-emerald-500 text-white' : 'bg-proto-primary text-proto-primary-fg'}`}>{done ? <Icon name="check" className="size-2.5" /> : n}</span>
)

export const Chip = ({ label }: { label: string }) => <span className="mx-px inline-flex items-center rounded bg-proto-primary-soft px-1 font-medium text-proto-primary-soft-fg">@{label}</span>

export function Body({ c, className = '' }: { c: { body: Seg[]; tags: Target[] }; className?: string }): ReactNode {
  return <span dir="auto" className={className}>{c.body.map((s, i) => typeof s === 'string' ? <span key={i}>{s}</span> : <Chip key={i} label={c.tags[s.tag]?.label ?? '?'} />)}</span>
}

/** The words of a comment as plain text, tags written as @Name: what the agent reads. */
export const plain = (c: { body: Seg[]; tags: Target[] }) => c.body.map(s => typeof s === 'string' ? s : `@${c.tags[s.tag]?.label ?? '?'}`).join('').replace(/ /g, ' ').trim()

export type { Item }

/** Claude's mark: a ring of uneven rays, in its terracotta. */
export function ClaudeMark({ className = 'size-3.5' }: { className?: string }) {
  const rays = [9, 6.5, 8.5, 6, 9, 6.5, 8, 6, 9, 6.5, 8.5, 6]
  return (
    <svg className={`${className} shrink-0`} viewBox="-12 -12 24 24" fill="none" stroke="#d97757" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
      {rays.map((r, i) => <path key={i} d={`M0 -${Math.min(r, 9) * 0.35 + 1.5}V-${r + 1.5}`} transform={`rotate(${i * 30})`} />)}
    </svg>
  )
}

/** What Claude said back, as a chat message from it: its mark, then the words in a bubble. */
export function Reply({ text, small }: { text: string; small?: boolean }) {
  return (
    <span className={`flex items-start ${small ? 'gap-1.5' : 'gap-2'}`}>
      <span className={`mt-px grid shrink-0 place-items-center rounded-full bg-[#d97757]/15 ${small ? 'size-4' : 'size-6'}`}><ClaudeMark className={small ? 'size-2.5' : 'size-3.5'} /></span>
      <span dir="auto" className={`min-w-0 rounded-2xl rounded-ss-sm bg-zinc-900/[.05] text-zinc-800 dark:bg-white/[.08] dark:text-zinc-100 ${small ? 'px-2 py-1 text-[11px] leading-4' : 'px-3 py-1.5 text-[12.5px] leading-[18px]'}`}>{text}</span>
    </span>
  )
}

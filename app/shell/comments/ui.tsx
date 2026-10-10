// Small pieces the comment layer shares: icons (the shell's own set plus the comment tools), the
// primary color classes (placeholder tokens in shell.css), and a few text pieces.
import type { ReactNode } from 'react'
import type { Action, CState, Item, Seg, Target } from './types'

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
  more: 'M9 9h11v11H9zM5 15V4h11', code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
}
export function Icon({ name, className = 'size-4' }: { name: string; className?: string }) {
  return <svg className={`${className} shrink-0`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>
}

/** The modifier keys' names where this runs: ⌘ and ⌥ on a Mac, Ctrl and Alt elsewhere. */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
export const MOD = MAC ? '⌘' : 'Ctrl'
export const ALT = MAC ? '⌥' : 'Alt'

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

/**
 * Where in the code an element is written, kept short for the page: its component and the file's
 * own name with the line (`PriceCard · parts.tsx:30`). The full path is the tooltip. A component
 * named after its file (a Vue SFC) is said once.
 */
export function srcOf(t?: Pick<Target, 'src' | 'component'>) {
  if (!t?.src) return null
  const file = t.src.split('/').pop()!
  const own = t.component && t.component !== file.replace(/\.\w+:\d+$/, '') ? t.component : ''
  return { short: own ? `${own} · ${file}` : file, full: `src/protos/${t.src}${t.component ? ` · ${t.component}` : ''}` }
}
export function SrcTag({ t, className = 'max-w-[50%] shrink-0' }: { t?: Pick<Target, 'src' | 'component'>; className?: string }) {
  const s = srcOf(t)
  return s ? <span title={s.full} className={`truncate font-mono text-[11px] text-zinc-400 ${className}`}>{s.short}</span> : null
}

export const Chip = ({ t }: { t?: Target }) => <span title={srcOf(t)?.full} className="mx-px inline-flex items-center rounded bg-proto-primary-soft px-1 font-medium text-proto-primary-soft-fg">@{t?.label ?? '?'}</span>

export function Body({ c, className = '' }: { c: { body: Seg[]; tags: Target[] }; className?: string }): ReactNode {
  return <span dir="auto" className={className}>{c.body.map((s, i) => typeof s === 'string' ? <span key={i}>{s}</span> : <Chip key={i} t={c.tags[s.tag]} />)}</span>
}

/** A decision on a variant: what it says (to the agent, and as its line in the list) and its icon. */
export const ACTION: Record<Action, { say: (v: string) => string; icon: string }> = {
  pick: { say: v => `Picked ${v}`, icon: 'check' },
  unpick: { say: v => `Unpicked ${v}`, icon: 'undo' },
  more: { say: v => `More like ${v}`, icon: 'more' },
  build: { say: v => `Build ${v}`, icon: 'code' },
}
/** What a row of the list is about: the element a comment is on, or what a decision asked. */
export const aboutOf = (i: Item) => i.action ? ACTION[i.action].say(i.variant) : i.target?.label ?? ''

/** The words of a comment as plain text, tags written as @Name: what the agent reads. */
export const plain = (c: { body: Seg[]; tags: Target[] }) => c.body.map(s => typeof s === 'string' ? s : `@${c.tags[s.tag]?.label ?? '?'}`).join('').replace(/ /g, ' ').trim()

export type { Item }

// The agents' marks, from svgl.app (Claude's in its own orange; Codex's follows the text color).
const CLAUDE = "m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z"
const CODEX = "M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"
export type Agent = 'claude' | 'codex'
export const AGENT: Record<Agent, string> = { claude: 'Claude', codex: 'Codex' }
export function AgentMark({ by = 'claude', className = 'size-3.5' }: { by?: Agent; className?: string }) {
  return by === 'codex'
    ? <svg className={`${className} shrink-0`} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true"><path clipRule="evenodd" d={CODEX} /></svg>
    : <svg className={`${className} shrink-0`} viewBox="0 0 256 257" fill="#D97757" aria-hidden="true"><path d={CLAUDE} /></svg>
}

/** What the agent said back, as a chat message from it: its mark, then the words in a bubble. */
export function Reply({ text, by = 'claude', small }: { text: string; by?: Agent; small?: boolean }) {
  return (
    <span className={`flex items-start ${small ? 'gap-1.5' : 'gap-2'}`}>
      <span className={`mt-px grid shrink-0 place-items-center rounded-full ${by === 'codex' ? 'bg-zinc-900/[.07] text-zinc-900 dark:bg-white/10 dark:text-white' : 'bg-[#d97757]/15'} ${small ? 'size-4' : 'size-6'}`} title={AGENT[by]}><AgentMark by={by} className={small ? 'size-2.5' : 'size-3.5'} /></span>
      <span dir="auto" className={`min-w-0 rounded-2xl rounded-ss-sm bg-zinc-900/[.05] text-zinc-800 dark:bg-white/[.08] dark:text-zinc-100 ${small ? 'px-2 py-1 text-[11px] leading-4' : 'px-3 py-1.5 text-[12.5px] leading-[18px]'}`}>{text}</span>
    </span>
  )
}

/** Something is being worked on: a soft pulsing dot in the primary color. */
export const Working = ({ className = 'size-2' }: { className?: string }) => (
  <span className={`relative inline-flex ${className}`}><span className="absolute inline-flex size-full animate-ping rounded-full bg-proto-primary-ring opacity-60" /><span className="relative inline-flex size-full rounded-full bg-proto-primary" /></span>
)

/** "now", "5 min", "3 h", "2 d": how long ago, short. */
export function since(at?: string | number) {
  const t = typeof at === 'number' ? at : at ? Date.parse(at) : NaN
  if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((Date.now() - t) / 60000))
  return m < 1 ? 'now' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`
}

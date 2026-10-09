// The variant sheet on a phone: every variant of the prototype, opened from the bottom pill.
// It is Base UI's Drawer (swipe down to close, focus kept inside, the iOS 26 viewport handled),
// written with createElement so it runs in Vue sessions too, which have no JSX transform.
import { createElement as h, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Drawer } from '@base-ui/react/drawer'

export type SheetRow = { id: string; name: string; on: boolean; picked: boolean; editing: boolean }
export type SheetProps = {
  open: boolean
  title: string
  rows: SheetRow[]
  lobby: boolean
  onClose: () => void
  onPick: (id: string) => void
  onLobby: () => void
}

const CHECK = h('svg', { className: 'size-4 shrink-0', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M5 12l5 5 9-10' }))
const GRID = h('svg', { className: 'size-3.5 shrink-0', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' }))
const X = h('svg', { className: 'size-4 shrink-0', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M6 6l12 12M18 6 6 18' }))
const DOT = h('span', { className: 'relative inline-flex size-1.5' }, h('span', { className: 'absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60' }), h('span', { className: 'relative inline-flex size-full rounded-full bg-emerald-500' }))

const ROW = 'flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] outline-none focus-visible:bg-zinc-900/[.06] dark:focus-visible:bg-white/10'

function Sheet(p: SheetProps) {
  const row = (r: SheetRow): ReactNode => h('button', {
    key: r.id, type: 'button', 'aria-current': r.on, onClick: () => p.onPick(r.id),
    className: `${ROW} ${r.on ? 'bg-zinc-900/[.05] font-semibold text-zinc-900 dark:bg-white/[.08] dark:text-white' : 'text-zinc-700 active:bg-zinc-900/[.04] dark:text-zinc-300 dark:active:bg-white/5'}`,
  },
    h('span', { className: `w-6 shrink-0 text-center text-xs font-semibold tabular-nums ${r.on ? '' : 'text-zinc-400'}` }, r.id),
    h('span', { dir: 'auto', className: 'min-w-0 flex-1 truncate text-start' }, r.name),
    r.editing ? DOT : null,
    r.picked ? h('span', { className: 'shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400' }, 'Picked') : null,
    r.on ? CHECK : null)

  return h(Drawer.Root, { open: p.open, onOpenChange: (open: boolean) => { if (!open) p.onClose() } },
    h(Drawer.Portal, null,
      // The Backdrop and Popup classes follow Base UI's bottom drawer example: the swipe
      // variables, the bleed below the screen and the iOS 26 backdrop fix are theirs.
      h(Drawer.Backdrop, { className: '[--backdrop-opacity:0.3] [--bleed:3rem] dark:[--backdrop-opacity:0.6] fixed inset-0 z-[200] min-h-dvh bg-black opacity-[calc(var(--backdrop-opacity)*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] supports-[-webkit-touch-callout:none]:absolute' }),
      h(Drawer.Viewport, { className: 'fixed inset-0 z-[200] flex items-end justify-center' },
        h(Drawer.Popup, { className: '-mb-[3rem] w-full max-h-[calc(75vh+3rem)] overflow-y-auto overscroll-contain rounded-t-3xl bg-white pb-[calc(0.75rem+env(safe-area-inset-bottom,0px)+3rem)] pt-2 text-[13px] text-zinc-900 shadow-2xl shadow-black/20 outline-none touch-auto [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:select-none data-ending-style:[transform:translateY(calc(100%-3rem+2px))] data-starting-style:[transform:translateY(calc(100%-3rem+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] dark:bg-zinc-900 dark:text-zinc-100' },
          h('div', { className: 'mx-auto mb-1 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700' }),
          h(Drawer.Content, { className: 'px-2' },
            h('div', { className: 'flex items-center justify-between pb-1 pl-3' },
              h(Drawer.Title, { dir: 'auto', className: 'min-w-0 truncate text-[15px] font-semibold' }, p.title),
              h(Drawer.Close, { 'aria-label': 'Close', className: 'grid size-9 place-items-center rounded-full text-zinc-500 active:bg-zinc-900/5 dark:active:bg-white/10' }, X)),
            h('div', { className: 'space-y-0.5' }, p.rows.map(row)),
            h('div', { className: 'mt-1.5 border-t border-black/[.06] pt-1.5 dark:border-white/10' },
              h('button', { type: 'button', onClick: p.onLobby, 'aria-current': p.lobby, className: `${ROW} ${p.lobby ? 'font-medium text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}` },
                h('span', { className: 'flex w-6 shrink-0 justify-center text-zinc-500 dark:text-zinc-400' }, GRID),
                h('span', { className: 'min-w-0 flex-1 truncate' }, 'All variants'),
                h('span', { className: 'shrink-0 text-xs tabular-nums text-zinc-400' }, String(p.rows.length)))))))))
}

/** Mounts the sheet once; call the returned function with new props to open, close or refresh it. */
export function createSheet(host: HTMLElement) {
  const root = createRoot(host)
  return (props: SheetProps) => root.render(h(Sheet, props))
}

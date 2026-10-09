// Small HTML building blocks for the shell chrome. Everything here returns strings.

const PATHS: Record<string, string> = {
  chev: 'M6 9l6 6 6-6', right: 'M9 6l6 6-6 6', left: 'M15 6l-6 6 6 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  rows: 'M4 4h16v7H4zM4 13h16v7H4z',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  check: 'M5 12l5 5 9-10',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  grow: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  branch: 'M6 3v8a4 4 0 0 0 4 4h8M14 11l4 4-4 4',
  from: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  x: 'M6 6l12 12M18 6 6 18',
  play: 'M8 5v14l11-7z',
  pause: 'M8 5v14M16 5v14',
  replay: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4',
  diff: 'M7 4v16M17 4v16M4 8h6M14 16h6',
  pin: 'M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5',
  key: 'M7.5 10a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM11.4 11.6 21 2M15.5 7.5l2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  fill: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  minus: 'M6 12h12',
  plus: 'M12 6v12M6 12h12',
}

export const ic = (name: string, cls = 'size-4') =>
  `<svg class="${cls} shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const ON = 'bg-zinc-900/[.06] text-zinc-900 dark:bg-white/10 dark:text-white'
export const TAB_ON = 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white'
export const TAB_OFF = 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
export const IB = 'inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md px-2 text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white'
export const SEP = '<div class="mx-4 border-t border-black/[.06] dark:border-white/10"></div>'

export const pulse = (cls = 'size-2', live = true) => live
  ? `<span class="relative inline-flex ${cls}"><span class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60"></span><span class="relative inline-flex size-full rounded-full bg-emerald-500"></span></span>`
  : `<span class="relative inline-flex ${cls} rounded-full bg-zinc-400"></span>`

export const pop = (open: boolean, html: string, cls: string) => open
  ? `<div data-pop class="absolute z-40 ${cls} overflow-hidden rounded-2xl border border-black/10 bg-white text-[13px] shadow-xl shadow-black/10 dark:border-white/10 dark:bg-zinc-900">${html}</div>`
  : ''

export const item = (act: string, label: string, meta = '', on = false, lead = '') =>
  `<button data-act="${act}" class="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-zinc-900/[.03] dark:hover:bg-white/5 ${on ? 'font-medium text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}">${lead}<span class="min-w-0 flex-1 truncate">${label}</span><span class="shrink-0 text-xs text-zinc-400">${meta}</span></button>`

export const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export const clock = (iso: string) => {
  const d = new Date(iso)
  return isNaN(+d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

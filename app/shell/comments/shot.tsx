// Screenshots: the design captured around an element, and the editor to mark it up
// (Pinpoint's draw modal, cut to the tools that matter: box, arrow, pen, text, numbers).
import { useCallback, useEffect, useRef, useState } from 'react'
import { domToCanvas } from 'modern-screenshot'
import { find, zoomOf } from './dom'
import { Icon, PRIMARY } from './ui'
import type { Target } from './types'

/** The variant, drawn as it is and cropped to a margin around `target`, as a PNG data URL. Null when it can't be found. */
export async function capture(mount: HTMLElement | null, target: Target, dark: boolean) {
  const root = (mount?.firstElementChild as HTMLElement | null) ?? mount, el = find(mount, target)
  if (!mount || !root || !el) return null
  const scale = 2, z = zoomOf(mount)
  const full = await domToCanvas(root, { scale, backgroundColor: dark ? '#09090b' : '#ffffff' })
  const r = el.getBoundingClientRect(), o = root.getBoundingClientRect()
  const ow = o.width / z, oh = o.height / z
  const m = 48, x = Math.max(0, (r.left - o.left) / z - m), y = Math.max(0, (r.top - o.top) / z - m)
  const w = Math.min(ow - x, r.width / z + m * 2), h = Math.min(oh - y, r.height / z + m * 2)
  if (w <= 0 || h <= 0) return null
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale); c.height = Math.round(h * scale)
  c.getContext('2d')!.drawImage(full, x * scale, y * scale, w * scale, h * scale, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}

type Mark = { tool: 'box' | 'arrow' | 'pen' | 'text' | 'num'; color: string; pts: [number, number][]; text?: string; n?: number }
const COLORS = ['#ef4444', '#f59e0b', '#4f46e5', '#18181b']
const TOOLS: { id: Mark['tool']; icon: string; name: string }[] = [
  { id: 'box', icon: 'box', name: 'Box' }, { id: 'arrow', icon: 'arrow', name: 'Arrow' }, { id: 'pen', icon: 'pen', name: 'Pen' },
  { id: 'text', icon: 'text', name: 'Text' }, { id: 'num', icon: 'hash', name: 'Number' },
]
function draw(ctx: CanvasRenderingContext2D, m: Mark, k: number) {
  ctx.strokeStyle = ctx.fillStyle = m.color
  ctx.lineWidth = 3 * k; ctx.lineCap = ctx.lineJoin = 'round'
  const [a, b = a] = [m.pts[0], m.pts.at(-1)!]
  if (m.tool === 'box') { ctx.beginPath(); ctx.roundRect(a[0], a[1], b[0] - a[0], b[1] - a[1], 4 * k); ctx.stroke() }
  if (m.tool === 'pen') { ctx.beginPath(); m.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke() }
  if (m.tool === 'arrow') {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = 14 * k
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45)); ctx.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill()
  }
  if (m.tool === 'text' && m.text) {
    ctx.font = `600 ${15 * k}px system-ui, sans-serif`
    const w = ctx.measureText(m.text).width
    ctx.beginPath(); ctx.roundRect(a[0] - 6 * k, a[1] - 15 * k, w + 12 * k, 22 * k, 5 * k); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.fillText(m.text, a[0], a[1] + 1 * k)
  }
  if (m.tool === 'num') {
    ctx.beginPath(); ctx.arc(a[0], a[1], 12 * k, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = `700 ${13 * k}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(m.n), a[0], a[1] + 0.5 * k); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic'
  }
}

export function ShotEditor({ src, onCancel, onDone }: { src: string; onCancel: () => void; onDone: (url: string) => void }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const img = useRef<HTMLImageElement | null>(null)
  const [marks, setMarks] = useState<Mark[]>([])
  const [tool, setTool] = useState<Mark['tool']>('box')
  const [color, setColor] = useState(COLORS[0])
  const [typing, setTyping] = useState<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const live = useRef<Mark | null>(null)
  const [, force] = useState(0)

  const paint = useCallback(() => {
    const c = cv.current, i = img.current
    if (!c || !i) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(i, 0, 0)
    const k = c.width / c.clientWidth
    for (const m of [...marks, ...(live.current ? [live.current] : [])]) draw(ctx, m, k)
  }, [marks])
  useEffect(() => {
    const i = new Image()
    i.onload = () => { img.current = i; const c = cv.current!; c.width = i.naturalWidth; c.height = i.naturalHeight; force(x => x + 1) }
    i.src = src
  }, [src])
  useEffect(paint)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !typing) { e.preventDefault(); e.stopPropagation(); onCancel() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.stopPropagation(); setMarks(m => m.slice(0, -1)) }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [onCancel, typing])

  const at = (e: React.PointerEvent): [number, number] => {
    const c = cv.current!, r = c.getBoundingClientRect(), k = c.width / r.width
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]
  }
  const down = (e: React.PointerEvent) => {
    const p = at(e)
    if (tool === 'num') { setMarks(m => [...m, { tool, color, pts: [p], n: m.filter(x => x.tool === 'num').length + 1 }]); return }
    if (tool === 'text') { const r = cv.current!.getBoundingClientRect(); setTyping({ x: e.clientX - r.left, y: e.clientY - r.top, cx: p[0], cy: p[1] }); return }
    cv.current!.setPointerCapture(e.pointerId)
    live.current = { tool, color, pts: [p] }
  }
  const move = (e: React.PointerEvent) => { if (!live.current) return; const p = at(e); live.current.pts = tool === 'pen' ? [...live.current.pts, p] : [live.current.pts[0], p]; paint() }
  const up = () => { if (live.current && live.current.pts.length > 1) { const m = live.current; setMarks(x => [...x, m]) } live.current = null }
  const done = () => {
    const c = document.createElement('canvas'), i = img.current!
    c.width = i.naturalWidth; c.height = i.naturalHeight
    const ctx = c.getContext('2d')!; ctx.drawImage(i, 0, 0)
    const k = cv.current!.width / cv.current!.clientWidth
    marks.forEach(m => draw(ctx, m, k))
    onDone(c.toDataURL('image/png'))
  }
  return (
    <div className="pointer-events-auto fixed inset-0 z-[300] grid place-items-center bg-zinc-950/70 p-4" onPointerDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-zinc-900 text-white shadow-2xl ring-1 ring-white/10">
        <div className="flex flex-wrap items-center gap-1 border-b border-white/10 p-2">
          {TOOLS.map(t => <button key={t.id} onClick={() => setTool(t.id)} title={t.name} aria-pressed={tool === t.id} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs ${tool === t.id ? 'bg-white text-zinc-900' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}><Icon name={t.icon} className="size-3.5" /><span className="hidden sm:inline">{t.name}</span></button>)}
          <span className="mx-1 h-5 w-px bg-white/15" />
          {COLORS.map(c => <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`} className={`grid size-8 place-items-center rounded-lg ${color === c ? 'bg-white/15' : 'hover:bg-white/10'}`}><span className="size-4 rounded-full ring-1 ring-white/30" style={{ background: c }} /></button>)}
          <button onClick={() => setMarks(m => m.slice(0, -1))} disabled={!marks.length} title="Undo · ⌘Z" aria-label="Undo" className="ml-auto grid size-8 place-items-center rounded-lg text-white/70 hover:bg-white/10 disabled:opacity-30"><Icon name="undo" className="size-4" /></button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-auto bg-zinc-800 p-4">
          <div className="relative mx-auto w-fit">
            <canvas ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} className={`block max-h-[52vh] max-w-full touch-none rounded-lg shadow-lg ${tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`} />
            {typing && <input autoFocus placeholder="Type, then Enter" className="absolute h-7 rounded-md bg-white px-2 text-[13px] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:text-base text-zinc-900 shadow outline-none ring-2 ring-proto-primary-ring" style={{ left: typing.x, top: typing.y - 14 }}
              onKeyDown={e => { if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v) setMarks(m => [...m, { tool: 'text', color, pts: [[typing.cx, typing.cy]], text: v }]); setTyping(null) } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTyping(null) } }}
              onBlur={() => setTyping(null)} />}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-white/10 p-2 text-xs text-white/50">
          <span className="px-1">Draw on what should change. ⌘Z undoes.</span>
          <button onClick={onCancel} className="ml-auto h-8 rounded-lg px-3 font-medium text-white/80 hover:bg-white/10">Cancel</button>
          <button onClick={done} className={`h-8 rounded-lg px-3 font-semibold ${PRIMARY}`}>Attach</button>
        </div>
      </div>
    </div>
  )
}

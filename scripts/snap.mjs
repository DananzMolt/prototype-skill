#!/usr/bin/env node
// Snapshot variants as static HTML modules for a Claude Doc widget.
// Usage: snap.mjs <app-url> <out-dir> <width> <spec.json>
// spec = [{ route: "hero/A", proto: "hero", id: "A", name: "Split media", title: "Hero sections", kind: "web"|"phone" }]
// Each variant is rendered in headless Chrome, its DOM copied with every style it needs
// written inline (no classes, no <style>, no scripts), and saved as
// `<proto>-<id>.jsx`: `export default () => <section style={{…}}>…</section>;`.
// Normally run through `proto snap`.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [rawUrl, outDir, widthArg, specFile] = process.argv.slice(2)
if (!rawUrl || !outDir || !specFile) { console.error('usage: snap.mjs <app-url> <out-dir> <width> <spec.json>'); process.exit(1) }
const spec = JSON.parse(readFileSync(specFile, 'utf8'))
const WIDTH = Number(widthArg) || 672
const STAGE = Math.round(WIDTH * 0.775) // height of a web snapshot: one screen at the doc's width

// ---------- in the page: DOM → tree with inline styles ----------
const extractor = async () => {
  const INHERITED = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'white-space', 'text-transform', 'font-variant-numeric', 'text-decoration-line', 'cursor', 'overflow-wrap', 'word-break', '-webkit-font-smoothing']
  const OTHER = {
    display: 'inline', position: 'static', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto', 'z-index': 'auto', 'box-sizing': 'content-box',
    'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px', 'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px',
    'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px', 'border-top-style': 'none', 'border-right-style': 'none', 'border-bottom-style': 'none', 'border-left-style': 'none',
    'border-top-color': '', 'border-right-color': '', 'border-bottom-color': '', 'border-left-color': '',
    'border-top-left-radius': '0px', 'border-top-right-radius': '0px', 'border-bottom-right-radius': '0px', 'border-bottom-left-radius': '0px',
    'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none', 'background-size': 'auto', 'background-position': '0% 0%', 'background-repeat': 'repeat',
    'box-shadow': 'none', opacity: '1', 'overflow-x': 'visible', 'overflow-y': 'visible', transform: 'none', 'transform-origin': '',
    'flex-direction': 'row', 'flex-wrap': 'nowrap', 'justify-content': 'normal', 'align-items': 'normal', 'align-self': 'auto', 'align-content': 'normal', 'justify-items': 'normal', 'justify-self': 'auto', 'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto', order: '0',
    'row-gap': 'normal', 'column-gap': 'normal', 'grid-template-columns': 'none', 'grid-template-rows': 'none', 'grid-column-start': 'auto', 'grid-column-end': 'auto', 'grid-row-start': 'auto', 'grid-row-end': 'auto',
    'text-overflow': 'clip', 'object-fit': 'fill', 'backdrop-filter': 'none', filter: 'none', 'text-decoration-color': '', 'text-underline-offset': 'auto', 'vertical-align': 'baseline', 'list-style-type': 'disc', 'aspect-ratio': 'auto',
  }
  // Elements the doc page styles on its own (margins, fonts, button chrome): their resets are written out.
  const UA = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'LI', 'A', 'FIGURE', 'BLOCKQUOTE', 'HR', 'IMG', 'LABEL', 'DL', 'DD', 'TABLE', 'TH', 'TD', 'STRONG', 'B', 'SMALL', 'CODE'])
  const FORCE = new Set(['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'background-color', 'display'])
  const FORCE_TEXT = ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'letter-spacing']
  const dataUrl = async src => {
    try {
      const blob = await (await fetch(src)).blob()
      if (blob.size > 300_000) return null
      return await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob) })
    } catch { return null }
  }
  const mount = document.querySelector('[data-layers]').firstElementChild.querySelector('[data-mount]')
  const walk = async (el, parentCs, isRoot) => {
    if (el.nodeType === 3) {
      const t = el.textContent
      if (!t.trim()) { const d = parentCs?.display || ''; return d.includes('flex') || d.includes('grid') ? null : ' ' }
      return t.replace(/\s+/g, ' ')
    }
    if (el.nodeType !== 1) return null
    const cs = getComputedStyle(el)
    if (cs.display === 'none') return null
    const tag = el.tagName
    const svg = el instanceof SVGElement
    const style = {}
    if (!svg || tag === 'svg') {
      for (const p of INHERITED) {
        const v = cs.getPropertyValue(p)
        if (isRoot) { if (!['normal', 'none', 'visible', 'auto', 'start'].includes(v)) style[p] = v }
        else if (parentCs.getPropertyValue(p) !== v) style[p] = v
        // The doc styles headings and buttons itself; these take the design's values back.
        else if (UA.has(tag) && FORCE_TEXT.includes(p)) style[p] = 'inherit'
      }
      for (const [p, init] of Object.entries(OTHER)) {
        const v = cs.getPropertyValue(p)
        if (!v) continue
        if (p.startsWith('border') && p.endsWith('color')) { if (cs.getPropertyValue(p.replace('color', 'width')) !== '0px') style[p] = v; continue }
        if (p === 'transform-origin') { if (cs.transform !== 'none') style[p] = v; continue }
        if (p === 'text-decoration-color') { if (cs.textDecorationLine !== 'none') style[p] = v; continue }
        if (v !== init || (UA.has(tag) && FORCE.has(p))) style[p] = v
      }
      // A border style without its width falls back to "medium" (3px): write every side's width.
      for (const side of ['top', 'right', 'bottom', 'left']) if (style[`border-${side}-style`] && !style[`border-${side}-width`]) style[`border-${side}-width`] = cs.getPropertyValue(`border-${side}-width`)
      if (style['box-shadow']) style['box-shadow'] = style['box-shadow'].split(/,(?![^(]*\))/).map(s => s.trim()).filter(s => !/^rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/.test(s)).join(', ') || 'none'
      if (style['box-shadow'] === 'none') delete style['box-shadow']
      const r = el.getBoundingClientRect()
      const boxed = !cs.display.startsWith('inline') || ['inline-block', 'inline-flex', 'inline-grid'].includes(cs.display) || tag === 'svg' || tag === 'IMG'
      if (boxed) { style.width = r.width + 'px'; style.height = r.height + 'px' }
      // A fixed element is pinned to the snapshot, not the reader's window.
      if (cs.position === 'fixed') style.position = 'absolute'
      if (cs.position === 'relative' || cs.position === 'sticky') for (const k of ['top', 'right', 'bottom', 'left']) if (style[k] === '0px' || style[k] === 'auto') delete style[k]
      if (cs.position === 'absolute' || cs.position === 'fixed') {
        // Keep the anchor on the near side so a wider fallback font grows away from the edge.
        const f = (a, b) => parseFloat(style[a]) <= parseFloat(style[b]) ? b : a
        if (style.left && style.right) delete style[f('left', 'right')]
        if (style.top && style.bottom) delete style[f('top', 'bottom')]
      }
      // One-line labels may grow (another font can be wider) and stay one line; longer text keeps its width.
      const textOnly = el.childNodes.length && [...el.childNodes].every(c => c.nodeType === 3)
      if (textOnly && boxed && !isRoot) {
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5
        const oneLine = r.height <= lh * 1.5 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 1
        if (oneLine && cs.textOverflow !== 'ellipsis') { style['white-space'] = 'nowrap'; style['min-width'] = style.width; delete style.width }
      }
      if (isRoot) { if (!style.position || style.position === 'static') style.position = 'relative'; style.overflow = 'hidden' }
      if (style['background-image']?.includes('url(')) {
        let bg = style['background-image']
        for (const m of [...bg.matchAll(/url\("?([^")]+)"?\)/g)]) { const d = await dataUrl(m[1]); bg = bg.replace(m[0], d ? `url("${d}")` : 'none') }
        style['background-image'] = bg
      }
    } else if (parentCs && cs.color !== parentCs.color) style.color = cs.color
    const attrs = {}
    for (const a of el.attributes) {
      const n = a.name
      if (n === 'class' || n === 'style' || n.startsWith('data-') || n.startsWith('on')) continue
      if (svg || ['alt', 'placeholder', 'type', 'role', 'title', 'disabled', 'colspan', 'rowspan'].includes(n) || n.startsWith('aria-')) attrs[n] = a.value
    }
    if (tag === 'IMG') { const d = await dataUrl(el.currentSrc || el.src); if (d) attrs.src = d }
    if (tag === 'INPUT' || tag === 'TEXTAREA') attrs.value = el.value
    if (tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) attrs.checked = el.checked
    const kids = []
    if (tag !== 'TEXTAREA') for (const c of el.childNodes) { const k = await walk(c, cs, false); if (k !== null && k !== undefined) kids.push(k) }
    return { tag: svg ? el.tagName : tag.toLowerCase(), svg, attrs, style, kids }
  }
  return walk(mount.firstElementChild, null, true)
}

// ---------- tree → JSX module ----------
const camel = p => (p.startsWith('-webkit-') ? 'Webkit-' + p.slice(8) : p).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
const SIDES = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'], padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'], 'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
}
// Round sizes up a tenth so text never loses the pixel it needs; Tailwind's full radius becomes 9999px.
const px = v => v.replace(/(-?[0-9.]+(?:e[+-]?[0-9]+)?)px/g, (_, n) => { let x = Number(n); x = x > 1e5 ? 9999 : x > 0 ? Math.ceil(x * 10) / 10 : Math.floor(x * 10) / 10; return `${x}px` })
function compact(style, tag) {
  const st = Object.fromEntries(Object.entries(style).map(([k, v]) => [k, px(v)]))
  for (const [short, longs] of Object.entries(SIDES)) {
    if (!longs.every(l => l in st)) continue
    const vals = longs.map(l => { const v = st[l]; delete st[l]; return v })
    st[short] = new Set(vals).size === 1 ? vals[0] : vals.join(' ')
  }
  const noBorder = !Object.entries(st).some(([k, v]) => k.startsWith('border') && k.endsWith('width') && v.split(' ').some(w => w !== '0px'))
  if (noBorder) for (const k of Object.keys(st)) if (k.startsWith('border') && (k.endsWith('style') || k.endsWith('color'))) delete st[k]
  if (!['ul', 'ol', 'li'].includes(tag)) delete st['list-style-type']
  return st
}
const ATTR = { colspan: 'colSpan', rowspan: 'rowSpan', value: 'defaultValue', checked: 'defaultChecked' }
function jsx(n) {
  if (typeof n === 'string') return `{${JSON.stringify(n)}}`
  const parts = [n.tag]
  for (const [k, v] of Object.entries(n.attrs)) {
    if (k.includes(':') || k === 'xmlns') continue
    const name = n.svg ? (k === 'viewBox' ? k : camel(k)) : ATTR[k] || k
    if (typeof v === 'boolean' || name === 'disabled') { if (v !== false) parts.push(`${name}={${v === true || name === 'disabled'}}`); continue }
    parts.push(`${name}=${JSON.stringify(v)}`)
  }
  const st = n.svg && n.tag !== 'svg' ? n.style : compact(n.style, n.tag)
  if (Object.keys(st).length) parts.push(`style={{${Object.entries(st).map(([k, v]) => `${JSON.stringify(camel(k))}: ${JSON.stringify(v)}`).join(', ')}}}`)
  // Adjacent text runs (from React expressions) read better as one string.
  const kids = []
  for (const k of n.kids) typeof k === 'string' && typeof kids.at(-1) === 'string' ? kids.push(kids.pop() + k) : kids.push(k)
  if (['input', 'img', 'br', 'hr'].includes(n.tag)) return `<${parts.join(' ')}/>`
  return `<${parts.join(' ')}>${kids.map(jsx).join('')}</${n.tag}>`
}
const PHONE = { width: '373px', height: '832px', borderRadius: '55px', border: '10px solid #18181b', overflow: 'hidden', boxSizing: 'content-box', background: '#fff', flexShrink: '0', position: 'relative' }
const phoneFrame = body => `<div style={{"display": "flex", "justifyContent": "center", "zoom": "0.8", "padding": "8px 0"}}><div style={{${Object.entries(PHONE).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}}>${body}</div></div>`

// ---------- drive Chrome ----------
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'proto-snap-'))
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
const cleanup = () => { chrome.kill('SIGKILL'); try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* temp dir */ } }
const timer = setTimeout(() => { console.error('snap: timed out'); cleanup(); process.exit(1) }, 180_000)
try {
  const wsUrl = await new Promise((ok, fail) => { let b = ''; chrome.stderr.on('data', d => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]) }); chrome.on('exit', () => fail(new Error('Chrome exited early'))) })
  const ws = new WebSocket(wsUrl)
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
  let id = 0
  const pending = new Map()
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { ok, fail } = pending.get(m.id); pending.delete(m.id); m.error ? fail(new Error(m.error.message)) : ok(m.result) } }
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => { const i = ++id; pending.set(i, { ok, fail }); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const index = []
  for (const v of spec) {
    const phone = v.kind === 'phone'
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    // A phone variant is captured at 100% in its frame; a web one at the doc's width, one screen tall.
    await send('Emulation.setDeviceMetricsOverride', { width: phone ? 900 : WIDTH, height: phone ? 1100 : STAGE + 48, deviceScaleFactor: 1, mobile: false }, sessionId)
    const url = new URL(rawUrl)
    url.searchParams.set('theme', 'light')
    if (phone) url.searchParams.set('focus', '1')
    url.hash = '/' + v.route
    await send('Page.navigate', { url: url.href }, sessionId)
    for (let i = 0; i < 100; i++) { const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement.dataset.ready === "1"', returnByValue: true }, sessionId); if (result.value) break; await sleep(100) }
    await sleep(1200)
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression: `(${extractor})()`, awaitPromise: true, returnByValue: true }, sessionId)
    if (exceptionDetails) throw new Error(`${v.route}: ${exceptionDetails.exception?.description || exceptionDetails.text}`)
    const body = jsx(result.value)
    const code = `export default () => ${phone ? phoneFrame(body) : body};`
    const file = resolve(outDir, `${v.proto}-${v.id}.jsx`)
    writeFileSync(file, code)
    index.push({ ...v, file, bytes: code.length, caption: `${v.title} · ${v.id} · ${v.name} · snapshot ${new Date().toISOString().slice(0, 10)}` })
    console.log(`${file}  ${(code.length / 1024).toFixed(1)} KB  ${v.id} · ${v.name}`)
    await send('Target.closeTarget', { targetId })
  }
  writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(index, null, 2))
  ws.close()
} catch (err) {
  console.error('snap:', err.message)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  cleanup()
}

// End-to-end check of the skill on this machine: create a session app in a scratch project,
// add prototypes (one built from another, one from two at once, one from the picks), screenshot
// them (one by one and on a contact sheet) and snapshot them, open a state listed in meta.ts,
// then stop and delete the session. Run by .github/workflows/smoke.yml on Windows, Linux and macOS.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const skill = dirname(dirname(fileURLToPath(import.meta.url)))
const scratch = process.env.RUNNER_TEMP || tmpdir()
// The project is reached through a link, as /tmp is on macOS: the app must still serve its files.
const real = join(scratch, 'proto-smoke')
const project = join(scratch, 'proto-smoke-link')
const keepShots = join(scratch, 'proto-shots')
const app = join(project, '.prototypes', 'smoke')
rmSync(project, { recursive: true, force: true })
rmSync(real, { recursive: true, force: true })
mkdirSync(real, { recursive: true })
symlinkSync(real, project, 'junction')
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'proto-smoke', private: true, dependencies: { react: '^19.2.0' } }))

const fail = msg => {
  console.error(`\nFAILED: ${msg}`)
  const log = join(app, '.proto', 'dev.log')
  if (existsSync(log)) console.error(`\n--- dev.log ---\n${readFileSync(log, 'utf8')}`)
  process.exit(1)
}
const proto = (args, { ok = true } = {}) => {
  console.log(`\n$ proto ${args.join(' ')}`)
  const r = spawnSync(process.execPath, [join(skill, 'scripts', 'proto.mjs'), ...args, '--project', project, '--session', 'smoke'], { encoding: 'utf8', timeout: 600_000 })
  process.stdout.write(r.stdout || '')
  process.stderr.write(r.stderr || '')
  if (ok && r.status !== 0) fail(`proto ${args[0]} exited ${r.status}`)
  if (!ok && r.status === 0) fail(`proto ${args.join(' ')} should have been refused`)
  return (r.stdout || '') + (r.stderr || '')
}
const answers = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok } catch { return false } }
const pngs = dir => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.png')) : []

const out = proto(['up', '--name', 'Smoke'])
const local = (out.match(/^local (\S+)/m) || out.match(/^url (\S+)/m) || [])[1]
if (!local || !await answers(`${local}__proto/status`)) fail(`the server does not answer at ${local}`)
const { pid } = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8'))

// The stylesheet as served, read once before any prototype folder exists. Each read opens
// its own connection: the spawnSync calls block this script for many seconds, long enough for
// the server to close an idle kept-alive socket without fetch noticing.
const css = () => new Promise(ok => get(`${local}shell/shell.css?direct`, { agent: false }, r => {
  let text = ''
  r.setEncoding('utf8').on('data', c => { text += c }).on('end', () => r.statusCode === 200 ? ok(text) : fail(`the stylesheet answered ${r.statusCode}: ${text.slice(0, 400)}`))
}).on('error', e => fail(`could not read the stylesheet: ${e.message}`)))
await css()

proto(['add', 'home', '--title', 'Home page', '--ask', 'Two takes on the home page', '--variants', 'A:Classic,B:Big price'])
proto(['add', 'hero', '--title', 'Hero section', '--ask', 'The hero from B, further', '--from', 'home/B', '--variants', 'A:Price only,B:Fuel tabs'])
proto(['add', 'home', '--from', 'hero/A'], { ok: false })
proto(['add', 'cta', '--from', 'home/Z', '--variants', 'A:x'], { ok: false })
const meta = readFileSync(join(app, 'src', 'protos', 'hero', 'meta.ts'), 'utf8')
if (!meta.includes('"from": "home/B"')) fail('hero/meta.ts has no "from": "home/B"')
if (meta.includes('"also"')) fail('hero/meta.ts has one parent, so it should have no "also"')
// Nothing is picked yet, so a design from the picks has nothing to start from.
if (!/nothing is picked/.test(proto(['add', 'final', '--from-picks', '--variants', 'A:x'], { ok: false }))) fail('--from-picks with no picks did not say so')

proto(['pick', 'home', 'B'])
proto(['pick', 'home', 'Z'], { ok: false })
if (!readFileSync(join(app, 'src', 'protos', 'home', 'meta.ts'), 'utf8').includes('"picked": "B"')) fail('home/meta.ts has no "picked": "B"')

// The working variant: a pick sets it, `proto work` moves it (the old one goes under before),
// and asks are kept per variant in session.json.
proto(['work', 'hero/A', '--ask', 'Bigger price'])
proto(['work', 'hero/Z'], { ok: false })
proto(['ask', 'And a shorter title'])
const sess = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8'))
if (sess.work?.proto !== 'hero' || sess.work.variant !== 'A') fail(`work should be hero/A, is ${JSON.stringify(sess.work)}`)
if (!sess.before?.some(b => b.proto === 'home' && b.variant === 'B')) fail('home/B (the pick) should be under before')
if (sess.asks?.['hero/A']?.length !== 2 || sess.asks?.['home/B']?.[0]?.text !== 'Picked B') fail(`asks are wrong: ${JSON.stringify(sess.asks)}`)

// One design from two variants ("A's layout with hero B's style"): the first parent stays a plain
// "from", the other goes in "also". A loop is refused when it runs through the second parent
// given, and on through an "also" above it: combo is built from hero, so hero can't be from combo.
const metaOf = slug => readFileSync(join(app, 'src', 'protos', slug, 'meta.ts'), 'utf8')
proto(['add', 'combo', '--title', 'Combined', '--from', 'home/A,hero/B', '--variants', 'A:Both'])
if (!metaOf('combo').includes('"from": "home/A"') || !/"also": \[\s*"hero\/B"\s*\]/.test(metaOf('combo'))) fail('combo/meta.ts should have "from": "home/A" and "also": ["hero/B"]')
proto(['add', 'hero', '--from', 'home/A,combo/A'], { ok: false })
proto(['add', 'mix', '--from', 'home/A,hero/Z', '--variants', 'A:x'], { ok: false })
// Another prototype as a whole is kept without a letter (hero's overview lists it in its header).
proto(['add', 'whole', '--title', 'All of hero', '--from', 'home/A,hero', '--variants', 'A:x'])
if (!/"also": \[\s*"hero"\s*\]/.test(metaOf('whole'))) fail('whole/meta.ts should have "also": ["hero"]')
// From the picks: every picked variant, oldest prototype first; an archived one is left out.
proto(['add', 'old', '--title', 'Dropped', '--variants', 'A:x'])
proto(['pick', 'old', 'A'])
proto(['archive', 'old'])
proto(['pick', 'hero', 'A'])
const final = proto(['add', 'final', '--title', 'Final', '--from-picks', '--variants', 'A:All picks'])
if (!/from home\/B, hero\/A$/m.test(final) || !metaOf('final').includes('"from": "home/B"') || !/"also": \[\s*"hero\/A"\s*\]/.test(metaOf('final'))) fail('final should be built from home/B, then hero/A')

proto(['shoot', '', 'hero', 'hero/A', 'combo'])
const shots = join(app, '.proto', 'shots')
const made = pngs(shots)
for (const want of ['session-desktop.png', 'hero-mobile.png', 'hero-A-desktop.png', 'combo-desktop.png']) {
  if (!made.includes(want)) fail(`no ${want} (made: ${made.join(', ') || 'none'})`)
  if (statSync(join(shots, want)).size < 10_000) fail(`${want} looks empty`)
}
// A state listed in meta.ts opens by its clicks; one whose clicks match nothing says so.
const heroMeta = join(app, 'src', 'protos', 'hero', 'meta.ts')
const metaSrc = readFileSync(heroMeta, 'utf8')
const at = metaSrc.indexOf('export default') + 'export default'.length
writeFileSync(heroMeta, metaSrc.slice(0, at) + ' ' + JSON.stringify({
  ...JSON.parse(metaSrc.slice(at)),
  about: { A: 'Price only.' },
  states: [
    { id: 'open', name: 'Panel', click: ['[data-shoot=open]'], about: { A: 'The panel, open.' } },
    { id: 'gone', name: 'Missing', click: ['[data-shoot=missing]'] },
  ],
}, null, 2) + '\n')
// The variant also reports hints for the Try it panel, through the app's own src/hints.ts.
if (!existsSync(join(app, 'src', 'hints.ts'))) fail('the app has no src/hints.ts')
writeFileSync(join(app, 'src', 'protos', 'hero', 'A.tsx'), `import { useState } from 'react'
import { useHints } from '../../hints'
export default function A() {
  const [open, setOpen] = useState(false)
  useHints([{ kind: 'value', label: 'Code', value: 'SAVE20' }, { kind: 'try', text: 'Open the panel', done: open }])
  return <div className="h-full w-[4321px] p-8"><button data-shoot="open" onClick={() => setOpen(true)}>Open</button>{open && <p>Panel</p>}</div>
}
`)
// A class in a prototype folder made while the server runs reaches the stylesheet.
let styled = false
for (let i = 0; i < 40 && !(styled = (await css()).includes('4321px')); i++) await new Promise(r => setTimeout(r, 250))
if (!styled) fail('a class in a new prototype folder never reached the stylesheet')
const stateOut = proto(['shoot', 'hero/A/open', 'hero/A/gone'])
if (!pngs(shots).includes('hero-A-open-desktop.png')) fail('no hero-A-open-desktop.png')
if (/nothing matches \[data-shoot=open\]/.test(stateOut)) fail('the state hero/A/open did not open')
if (!/nothing matches \[data-shoot=missing\]/.test(stateOut)) fail('proto shoot did not report the state whose clicks match nothing')
// One contact sheet per prototype: every variant, desktop above phone, no more than 2000 px
// either way, printed alone, then one line for the singles. A third variant on home lets the
// sheet take the whole width (two are held to its height instead). --sheet goes last: before a
// slug it would take the slug as its value.
proto(['add', 'home', '--variants', 'C:Map first'])
const sheetOut = proto(['shoot', 'home', '--sheet'])
const sheet = sheetOut.split(/\r?\n/)[0].trim()
if (!sheet.endsWith('home-sheet.png') || !existsSync(sheet)) fail(`proto shoot --sheet should print home-sheet.png first, printed: ${sheetOut}`)
const sheetHead = readFileSync(sheet)
const [sw, sh] = [sheetHead.readUInt32BE(16), sheetHead.readUInt32BE(20)]
if (sw < 1800 || sw > 2000 || sh > 2000) fail(`home-sheet.png is ${sw}x${sh}; it should be about 2000 wide and no taller`)
if (sheetOut.split(/\r?\n/).filter(l => /\.png$/.test(l.trim())).length !== 1 || !/^6 single shots in /m.test(sheetOut)) fail(`proto shoot --sheet should print the sheet, then one line for its 6 singles: ${sheetOut}`)
for (const want of ['home-A-desktop.png', 'home-C-mobile.png']) if (!pngs(shots).includes(want)) fail(`proto shoot --sheet wrote no ${want}`)
// The same state across the variants that have it.
proto(['shoot', 'hero', '--state', 'open', '--sheet'])
if (!pngs(shots).includes('hero-open-sheet.png')) fail('proto shoot hero --state open --sheet wrote no hero-open-sheet.png')
cpSync(shots, keepShots, { recursive: true })

proto(['snap', 'hero/A'])
if (!existsSync(join(app, '.proto', 'snaps', 'hero-A.jsx'))) fail('proto snap wrote no hero-A.jsx')

// A phone prototype at a device's size, compared with a reference screenshot. The path is
// relative to the app, not to where proto runs.
proto(['add', 'phone', '--title', 'Phone', '--variants', 'A:Current', '--kind', 'phone', '--screen', '402x874'])
proto(['add', 'phone', '--screen', 'big'], { ok: false })
if (!readFileSync(join(app, 'src', 'protos', 'phone', 'meta.ts'), 'utf8').includes('"screen": [\n    402,\n    874\n  ]')) fail('phone/meta.ts has no screen [402, 874]')
proto(['shoot', 'phone/A', '--ref', '.proto/shots/hero-A-desktop.png'])
const screen = join(shots, 'phone-A-screen.png')
if (!existsSync(screen)) fail('proto shoot --ref wrote no phone-A-screen.png')
const head = readFileSync(screen)
const size = `${head.readUInt32BE(16)}x${head.readUInt32BE(20)}`
if (size !== '1206x2622') fail(`phone-A-screen.png is ${size}, not the 402x874 screen at 3x (1206x2622)`)
if (!existsSync(join(shots, 'phone-A-vs-ref.png'))) fail('proto shoot --ref wrote no phone-A-vs-ref.png')
if (pngs(shots).some(f => /^phone-A-(desktop|mobile)\.png$/.test(f))) fail('proto shoot --ref should write only the screen and the sheet')

// Comments from the page: a batch with a screenshot goes in through the server, is taken by
// `proto inbox` (a directory rename, which Windows can refuse), shown with its image on disk,
// answered with `proto reply`, and the page's status then says what became of it. A listener
// started first wakes up by itself when the next batch arrives.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const send = async comments => {
  const res = await fetch(`${local}__proto/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ comments, viewport: { w: 390, h: 844, phone: true }, theme: 'dark' }) })
  const body = await res.json()
  if (!res.ok) fail(`posting comments answered ${res.status}: ${JSON.stringify(body)}`)
  return body
}
const sent = await send([
  { route: 'hero/A', text: 'Make the price bigger', target: { selector: ':scope > div:nth-child(1)', shoot: 'open', tag: 'button', text: 'Open', rect: { x: 4, y: 8, w: 120, h: 40 } }, tags: [{ selector: ':scope > p', tag: 'p', text: 'Panel' }], images: [{ dataUrl: PNG, name: 'marked up' }] },
  { route: 'home/B', text: 'Second one', point: { x: 10, y: 20 } },
])
if (!sent.sent || sent.inbox?.new !== 1) fail(`the batch was not queued: ${JSON.stringify(sent)}`)
const got = proto(['inbox'])
if (!/Make the price bigger/.test(got) || !/data-shoot=open/.test(got) || !/at 4,8 120x40/.test(got)) fail('proto inbox did not print the comment with its element and place')
const image = (got.match(/image: (.+?)(?:  \(|$)/m) || [])[1]?.trim()
if (!image || !existsSync(image)) fail(`the screenshot is not on disk at ${image}`)
if (!/no new comments/.test(proto(['inbox']))) fail('a batch was handed out twice')
const batch = (got.match(/^batch (\S+)/m) || [])[1]
proto(['reply', `${batch}/1`, 'Price is now 48px', '--done', '--as', 'codex'])
let state = await (await fetch(`${local}__proto/status`)).json()
const c1 = state.inbox.batches.find(b => b.id === batch)?.comments.find(c => c.n === 1)
if (!c1?.done || c1.reply?.text !== 'Price is now 48px' || c1.reply.by !== 'codex') fail(`the reply did not reach the page: ${JSON.stringify(c1)}`)
proto(['reply', batch, 'All handled', '--done'])
state = await (await fetch(`${local}__proto/status`)).json()
if (state.inbox.batches.find(b => b.id === batch)?.state !== 'done') fail('the batch is not done after replying to all of it')
proto(['reply', 'nope/1', 'x'], { ok: false })
if ((await fetch(`${local}__proto/comments`, { method: 'POST', body: '{"comments":[{"route":"BAD","text":"x"}]}' })).status !== 400) fail('a comment with a bad route was accepted')
// Listening: --wait exits, printing the batch, once another one lands.
const waiter = spawn(process.execPath, [join(skill, 'scripts', 'proto.mjs'), 'inbox', '--wait', '--project', project, '--session', 'smoke'], { stdio: ['ignore', 'pipe', 'pipe'] })
let heard = ''
waiter.stdout.on('data', d => { heard += d })
const exited = new Promise(ok => waiter.on('exit', ok))
for (let i = 0; i < 40 && !/listening for comments/.test(heard); i++) await new Promise(r => setTimeout(r, 250))
if (!/listening for comments/.test(heard)) { waiter.kill(); fail('proto inbox --wait never said it was listening') }
await send([{ route: 'hero/A', text: 'Woke you up', point: { x: 1, y: 1 } }])
const code = await Promise.race([exited, new Promise(r => setTimeout(() => r('timeout'), 20_000))])
if (code === 'timeout') { waiter.kill(); fail('proto inbox --wait did not wake for a new batch') }
if (!/Woke you up/.test(heard)) fail(`the listener exited without the batch: ${heard}`)

// A right-to-left variant: physical sides are listed, while sides chosen per direction,
// centring and logical sides are not.
writeFileSync(join(app, 'src', 'protos', 'phone', 'A.tsx'), [
  'export default function A() {',
  '  return <div dir="rtl" className="h-full ps-4">',
  '    <p className="ml-3 text-start">שלום</p>',
  '    <span className="absolute left-1/2 -translate-x-1/2 rtl:-scale-x-100 ltr:bg-linear-to-r rtl:bg-linear-to-l">‹</span>',
  '    <span style={{ paddingRight: 8 }}>0/10</span>',
  '    <div dir="ltr" className="relative">',
  '      <span className="absolute left-2">11:35</span>',
  '    </div>',
  '  </div>',
  '}',
].join('\n'))
const rtl = proto(['shoot', 'phone/A'])
if (!/A\.tsx:3 +ml-3/.test(rtl)) fail('the rtl check did not list ml-3')
if (!/A\.tsx:5 +paddingRight:/.test(rtl)) fail('the rtl check did not list paddingRight')
if (/A\.tsx:[2467] /.test(rtl)) fail('the rtl check listed a logical side, centring, a per-direction class or an LTR island')
// A phone prototype's variant is shot at phone size only.
if (!pngs(shots).includes('phone-A-mobile.png') || pngs(shots).includes('phone-A-desktop.png')) fail('a phone variant should be shot at phone size only')

proto(['stop'])
for (let i = 0; i < 40 && await answers(`${local}__proto/status`); i++) await new Promise(r => setTimeout(r, 250))
if (await answers(`${local}__proto/status`)) fail('the server still answers after proto stop')
let gone = false
try { process.kill(pid, 0) } catch { gone = true }
if (!gone) fail(`the dev server (pid ${pid}) is still running after proto stop`)

proto(['rm'])
if (existsSync(app)) fail('proto rm left the session folder')
console.log(`\nOK: ${made.length} screenshots in ${keepShots}`)

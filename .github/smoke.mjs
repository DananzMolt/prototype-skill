// End-to-end check of the skill on this machine: create a session app in a scratch project,
// add two prototypes (one built from the other), screenshot and snapshot them, open a state
// listed in meta.ts, then stop and delete the session. Run by .github/workflows/smoke.yml on Windows, Linux and macOS.
import { spawnSync } from 'node:child_process'
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

proto(['shoot', '', 'hero', 'hero/A'])
const shots = join(app, '.proto', 'shots')
const made = pngs(shots)
for (const want of ['session-desktop.png', 'hero-mobile.png', 'hero-A-desktop.png']) {
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

// Where each part of a design is written, for comments to point at code. Every DOM element the
// session's own prototype files write (src/protos/**, not the shell, not an @project import)
// carries `data-src`, its file under src/protos and line (`today/parts.tsx:30`), and
// `data-component`, the component it is written in. The comment layer reads both off the element
// a comment is on, and `proto inbox` prints them for the agent.
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))
// Compared with forward slashes: Vite's ids and these differ on Windows, where case doesn't count
// either (a drive letter comes either way). A project reached through a link (macOS /tmp is
// /private/tmp) shows up under its real path, so both names count.
const slash = p => p.replaceAll('\\', '/')
const same = p => { const s = slash(p.split('?')[0]); return process.platform === 'win32' ? s.toLowerCase() : s }
const protos = [...new Set([dir, realpathSync(dir)].map(d => `${same(join(d, 'src', 'protos'))}/`))]
const inProtos = file => protos.some(p => same(file).startsWith(p))
const relative = file => { const f = slash(file.split('?')[0]); return f.slice(f.lastIndexOf('/src/protos/') + 12) }

/**
 * React: the dev JSX transform hands `jsxDEV` the file and line of every tag, and React ignores
 * them. The prototype files' `react/jsx-dev-runtime` resolves to shell/jsx.ts instead, React's own
 * plus the two attributes; everything else (the shell, the project's files) keeps React's.
 */
export function reactSource() {
  const runtime = join(dir, 'shell', 'jsx.ts')
  return {
    name: 'prototype-source',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === 'react/jsx-dev-runtime' && importer && inProtos(importer)) return runtime
    },
  }
}

/**
 * Vue: a template node transform (plugin-vue's `template.compilerOptions.nodeTransforms`) adds the
 * two as static attributes to each plain element, at its line in the .vue file. The component is
 * the SFC's name from its file, as Vue itself derives it. Components and slots are skipped: an
 * attribute on one would fall through to its root and hide where that root is written.
 */
export function vueSource(node, context) {
  if (node.type !== 1 || node.tagType !== 0 || !inProtos(context.filename || '')) return
  // plugin-vue can hand the same parsed template over again (a script-only update reuses it), so
  // an element that already has the attribute is left as it is.
  if (node.props.some(p => p.type === 6 && p.name === 'data-src')) return
  const attr = (name, content) => ({ type: 6, name, nameLoc: node.loc, value: { type: 2, content, loc: node.loc }, loc: node.loc })
  node.props.push(attr('data-src', `${relative(context.filename)}:${node.loc.start.line}`))
  if (context.selfName) node.props.push(attr('data-component', context.selfName))
}

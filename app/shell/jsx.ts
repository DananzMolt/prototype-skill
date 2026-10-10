// The JSX runtime of the session's prototype files (source.mjs points their
// `react/jsx-dev-runtime` here; the shell and the project's files keep React's). It is React's,
// plus where each DOM element is written: `data-src` is its file under src/protos and its line
// (`today/parts.tsx:30`), `data-component` the component it is written in. The dev transform
// passes every tag's file and line as jsxDEV's fifth argument, which React itself no longer reads.
import { Fragment, jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime'

export { Fragment }

type Source = { fileName?: string; lineNumber?: number; columnNumber?: number }
const E = Error as ErrorConstructor & { stackTraceLimit?: number }
const names = new Map<string, string>()
// An edit can rename the function a tag sits in without moving the tag, so each update starts afresh.
if (import.meta.hot) import.meta.hot.on('vite:beforeUpdate', () => names.clear())

/**
 * The component a tag is written in: going out from the tag, the first capitalized function in
 * the same file (a map callback or a lowercase helper can sit between). Read once per tag from the
 * call stack, the way React reads its own dev stacks, and kept, since a tag never moves function.
 * A stack that can't be read leaves the element without a component; its file and line still stand.
 */
function componentOf(file: string, tag: string) {
  let name = names.get(tag)
  if (name !== undefined) return name
  name = ''
  const was = E.stackTraceLimit
  E.stackTraceLimit = 30
  const stack = new Error().stack ?? ''
  E.stackTraceLimit = was
  for (const line of stack.split('\n')) {
    if (!line.includes(file)) continue
    // Chrome: "    at PriceCard (http://…/parts.tsx:3:10)"; Safari and Firefox: "PriceCard@http://…".
    const m = line.match(/^\s*at (?:[\w$]+\.)*([\w$]+) \(/) ?? line.match(/^(?:[\w$]+[./<])*([\w$]+)@/)
    if (m && /^[A-Z]/.test(m[1])) { name = m[1]; break }
  }
  names.set(tag, name)
  return name
}

export function jsxDEV(type: unknown, props: Record<string, unknown>, key: unknown, isStatic: boolean, source?: Source, self?: unknown) {
  const file = source?.fileName?.replaceAll('\\', '/') ?? ''
  const at = file.lastIndexOf('/src/protos/')
  // Only DOM elements: a component would get a prop it doesn't expect.
  if (typeof type === 'string' && at >= 0 && source?.lineNumber && !('data-src' in props)) {
    const src = `${file.slice(at + 12)}:${source.lineNumber}`
    const component = componentOf(file.slice(at), `${src}:${source.columnNumber ?? 0}`)
    props = { ...props, 'data-src': src, ...(component ? { 'data-component': component } : {}) }
  }
  return (reactJsxDEV as (...a: unknown[]) => unknown)(type, props, key, isStatic, source, self)
}

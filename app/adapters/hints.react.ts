// Hints for the page's Try it panel, from a React variant: call useHints once, in the variant's
// own component, with what applies right now. See shell/hints.ts for the kinds.
import { createContext, useContext, useEffect } from 'react'
import { hints, type Hint } from '../shell/hints'

export type { Hint }
/** The element the variant is mounted in; set by src/mount.tsx. */
export const HintHost = createContext<HTMLElement | null>(null)

export function useHints(list: Hint[]) {
  const host = useContext(HintHost)
  useEffect(() => { if (host) hints.set(host, list) })
  useEffect(() => () => { if (host) hints.drop(host) }, [host])
}

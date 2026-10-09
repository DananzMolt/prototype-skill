// Hints for the page's Try it panel, from a Vue variant: call useHints once in the variant's
// setup, with a function that returns what applies right now (it is re-read when its reactive
// sources change). See shell/hints.ts for the kinds.
import { inject, onBeforeUnmount, watchEffect, type InjectionKey } from 'vue'
import { hints, type Hint } from '../shell/hints'

export type { Hint }
/** The element the variant is mounted in; provided by src/mount.ts. */
export const HintHost: InjectionKey<HTMLElement> = Symbol('hint host')

export function useHints(list: () => Hint[]) {
  const host = inject(HintHost, null)
  if (!host) return
  watchEffect(() => hints.set(host, list()))
  onBeforeUnmount(() => hints.drop(host))
}

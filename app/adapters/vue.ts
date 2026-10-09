// Mounts a Vue variant into a host element. A render error shows in place of the variant
// instead of taking down the shell, and clears on the next hot update.
import { createApp, h, shallowRef, type Component } from 'vue'
import { HintHost } from './hints'

const errors = new Set<{ value: unknown }>()
if (import.meta.hot) import.meta.hot.on('vite:afterUpdate', () => errors.forEach(e => { e.value = null }))

export function mount(el: HTMLElement, Variant: Component) {
  const error = shallowRef<unknown>(null)
  errors.add(error)
  const app = createApp({
    render: () => error.value
      ? h('pre', { class: 'm-4 whitespace-pre-wrap rounded-lg bg-rose-50 p-4 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-200' }, String((error.value as Error).stack || error.value))
      : h(Variant),
  })
  app.config.errorHandler = err => { error.value = err }
  app.provide(HintHost, el)
  app.mount(el)
  return () => { errors.delete(error); app.unmount() }
}

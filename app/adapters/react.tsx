// Mounts a React variant into a host element. The error boundary keeps one broken
// variant from taking down the shell; Fast Refresh retries it after the next edit.
import { Component, StrictMode, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    const { error } = this.state
    return error
      ? <pre className="m-4 whitespace-pre-wrap rounded-lg bg-rose-50 p-4 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-200">{String(error.stack || error)}</pre>
      : this.props.children
  }
}

export function mount(el: HTMLElement, Variant: ComponentType) {
  const root = createRoot(el)
  root.render(<StrictMode><Boundary><Variant /></Boundary></StrictMode>)
  return () => root.unmount()
}

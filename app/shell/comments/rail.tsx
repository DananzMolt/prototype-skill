// The comments tab of the side panel, and the phone's list as a bottom sheet (Base UI's Drawer,
// like the variant sheet).
import { Drawer } from '@base-ui/react/drawer'
import { useCtx } from './ctx'
import { CommentList, SendBar, useRows } from './list'
import { Icon } from './ui'

export function Rail() {
  const { s } = useRows()
  return (
    <div className="flex h-full min-h-0 flex-col" data-shoot="comments">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 pt-3"><CommentList /></div>
      <div className="shrink-0 border-t border-black/[.07] p-2 dark:border-white/10">
        {s.place
          ? <SendBar />
          : <p className="px-1 py-1 text-center text-xs text-zinc-400">Open a variant to comment on it.</p>}
      </div>
    </div>
  )
}

const BACKDROP = '[--backdrop-opacity:0.3] [--bleed:3rem] dark:[--backdrop-opacity:0.6] fixed inset-0 z-[200] min-h-dvh bg-black opacity-[calc(var(--backdrop-opacity)*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] supports-[-webkit-touch-callout:none]:absolute'
const POPUP = '-mb-[3rem] flex w-full max-h-[calc(82vh+3rem)] flex-col overflow-hidden rounded-t-3xl bg-white pb-[calc(0.75rem+env(safe-area-inset-bottom,0px)+3rem)] pt-2 text-[13px] text-zinc-900 shadow-2xl shadow-black/20 outline-none touch-auto [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:select-none data-ending-style:[transform:translateY(calc(100%-3rem+2px))] data-starting-style:[transform:translateY(calc(100%-3rem+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] dark:bg-zinc-900 dark:text-zinc-100'

export function PhoneSheet() {
  const { act } = useCtx()
  const { s } = useRows()
  return (
    <Drawer.Root open={s.sheet} onOpenChange={(open: boolean) => act.openSheet(open)}>
      <Drawer.Portal>
        <Drawer.Backdrop className={BACKDROP} />
        <Drawer.Viewport className="fixed inset-0 z-[200] flex items-end justify-center">
          <Drawer.Popup className={POPUP}>
            <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <Drawer.Content className="flex min-h-0 flex-1 flex-col px-3">
              <div className="flex items-center gap-2 pb-1 pl-1 pt-1">
                <Drawer.Title className="text-[17px] font-semibold">Comments</Drawer.Title>
                <Drawer.Close aria-label="Close" className="ms-auto grid size-9 place-items-center rounded-full text-zinc-500 active:bg-zinc-900/5 dark:active:bg-white/10"><Icon name="x" /></Drawer.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1"><CommentList roomy onOpen={() => act.openSheet(false)} /></div>
              <SendBar className="-mx-3 mt-2 shrink-0 border-t border-black/[.06] px-3 pt-3 dark:border-white/10" onAdd={() => { act.openSheet(false); act.toggle() }} />
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

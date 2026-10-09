import type { Inbox } from '../shell'

/** A box in CSS px. Display boxes are measured from the comment layer; a Target's rect from the variant root. */
export type Box = { x: number; y: number; w: number; h: number }

/**
 * What a comment is on, or tags. `selector` finds it again from the variant's mount (it holds
 * across hot reloads while the structure does); `rect` is where it was, in CSS px from the
 * variant root's top left, which is what the agent is told.
 */
export type Target = { label: string; selector: string; shoot?: string; src?: string; tag: string; text: string; rect: Box }

/** A comment's words: text, and tags (an index into the comment's `tags`) between. */
export type Seg = string | { tag: number }
export type Draft = { body: Seg[]; tags: Target[]; shot?: string }
/** An unfinished new comment, and the element it was started on. */
export type Held = Draft & { target: Target }

export type Item = Draft & {
  id: string
  proto: string
  variant: string
  state?: string
  /** The pin's number, counted within its variant. */
  n: number
  target: Target
  at: number
  /** Once sent: the batch, and its place in it (1-based, as `proto reply` counts). */
  sent?: { batch: string; i: number }
}

export type CState = 'draft' | 'sent' | 'seen' | 'done'
export type Mode =
  | { kind: 'idle' }
  | { kind: 'pick' }
  | { kind: 'compose'; target: Target; id?: string }
  | { kind: 'tag'; target: Target; id?: string }

/** Where the page is, when it is on a single variant that can be commented on. */
export type Place = { proto: string; variant: string; state?: string; phone: boolean; title: string }

export type State = {
  items: Item[]
  held: Held | null
  mode: Mode
  active: string | null
  /** Bumped to make a composer that can't take a click say so (it shakes). */
  nudge: number
  /** An element picked to be tagged, waiting for the open composer to take it. */
  pendingTag: Target | null
  place: Place | null
  inbox?: Inbox
  /** The phone's list, in a sheet. */
  sheet: boolean
  sending: boolean
  error: string
}

export const routeOf = (p: { proto: string; variant: string; state?: string }) => `${p.proto}/${p.variant}${p.state ? `/${p.state}` : ''}`

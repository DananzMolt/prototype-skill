---
name: prototype
description: Use when the user asks to prototype a UI, wants several versions or variations of a screen, component, section or interaction, or says "/prototype", "/prototype 3 <feature>", "show me options for…", "give me a few versions of…". Also use for follow-up requests in the same session ("now 5 variations of the hero", "add two more", "try it on the phone"). NOT for a single straightforward UI change, logic with no visible surface, or comparing libraries or APIs.
allowed-tools:
  - Bash(node "${CLAUDE_SKILL_DIR}/scripts/proto.mjs" *)
---

# Prototype

Each Claude Code session gets **one live prototype app**. The user gets its link once, at
the start, and watches every prototype appear and fill in as you write the files: the page
updates through hot module replacement, never a reload. Everything the user asks for in the
session lives in that one app: **session › prototype › variant**.

The app already has its navigation (a sidebar tree, breadcrumbs that open lobbies, jump menus,
variant tabs (on a phone, a pill at the bottom you drag along), edge arrows, a focus mode with a dock, light and dark, phone frames, "editing" dots,
a "Working on" card for the variant being changed). You only write variant files.

`proto` below means `node "${CLAUDE_SKILL_DIR}/scripts/proto.mjs"` (through `node`, the path in
double quotes, not a shell variable: the same command works in Bash, Git Bash and PowerShell). It
finds the session from `$CLAUDE_CODE_SESSION_ID` and the project from the git root of the current
folder. A subagent building into the main session's app passes `--session <the main session id>`
on every call.

## 1. Start the session app, then send the link

Before reading the codebase or designing anything:

```
proto up --name "<short session title, e.g. Refuel redesign>"
```

It creates the app on the first call in a session, restarts it if it stopped, and prints
`url …`. Send that URL to the user right away in one short message ("Live link: … it fills
in as I build"). Then continue. On later requests in the same session run `proto up` again
(same app, same link) and don't resend the link unless the user lost it.

What `proto up` does: the app lives in `<project>/.prototypes/<session>/` (git-ignored, the
project's own files are untouched), its stack follows the project (React for React, Next or
Expo projects, Vue for Vue or Nuxt, React for anything else), it runs a Vite dev server and
publishes it on the tailnet with `tailscale serve`, so the link opens on the user's phone too.

## 2. Ground it in the real product: Current first

When the request changes something that already exists (a screen, a tab, a component), variant
**A is "Current"**: a rebuild of what ships today, close enough that the user can't tell it from
a screenshot of the real app at a glance. Every other variant starts as a copy of Current and
changes only what its direction is about. Variants drawn on an invented look get rejected
however good the idea is, so this step comes before any idea.

1. **Screenshots of the real thing.** Capture the screen and its states the user will judge
   against, into the app's `.proto/ref/<slug>/`, and read every one:
   - Web: run the project's app and screenshot the page in a browser, at 1440 wide (desktop)
     or 390 wide at 3x (phone).
   - iOS simulator: `xcrun simctl io <udid> screenshot <file>` on a booted simulator that
     already shows the screen. Don't drive someone else's simulator to get there; ask.
   - Mac app: `screencapture -l <window id> <file>`.
   - Nothing running: ask the user for screenshots. Existing ones in the repo (design folders,
     store assets, docs) count.
2. **The real assets.** Import the project's images, illustrations and fonts straight from
   the repo (`import hero from '@project/apps/app/assets/images/hero.webp'`, `@font-face` with
   a relative `url()`). Icons: the web package of the same icon set (`phosphor-react-native` →
   `@phosphor-icons/react`), added with `pnpm add --ignore-workspace` (or `npm i`) in the app's
   folder before you write variants (adding one reloads the page once). When the device draws
   icons no web package has (SF Symbols), use the project's own web fallback set if it has
   one, else the closest set, and say so in Current's `about`. Never an emoji or text glyph.
3. **The real tokens.** For a web project, the import above. For a native project (React
   Native, SwiftUI, Android), read its theme source (Tailwind or NativeWind config and
   `global.css`, a `theme.ts`, asset catalog colors, `colors.xml`) and copy the exact values
   into `src/theme.css`, with a comment naming the file each came from, converted where the
   format differs (an RGB triplet becomes `rgb()`, a line-height ratio becomes px). Same for
   the font family and type scale. The shell imports this file too, so new names go in
   `@theme {}` (`--color-brand-ink`), but values that replace Tailwind's own (`--font-sans`,
   `--text-xs`, `--radius-2xl`) go on a class (`.app { --font-sans: … }`) set on each variant's
   root; otherwise they restyle the shell. Right-to-left products: see "Right to left" below.
4. **The real chrome, once.** Rebuild the app's recurring pieces (tab bar, header, cards,
   buttons, sheets, status bar and home indicator on a phone) in `src/protos/<slug>/parts.tsx`,
   measured from the component source (radii, padding, sizes, blur), not eyeballed. System
   chrome with no numbers in the source (a native tab bar, Liquid Glass) is measured off the
   reference at its scale. When the source and the screenshot disagree, the screenshot wins:
   it is what the user sees. Every variant imports these parts, so the chrome can't drift.
5. **The device.** A phone prototype's screen is the reference's size in points:
   `--screen 402x874` for an iPhone 17 shot (1206×2622 px at 3x). Without it the frame is
   393×852.
6. **Match before anything else.** Write Current, then
   `proto shoot <slug>/A --ref .proto/ref/<slug>/<file>.png` (a relative path is looked up from
   the current folder, then the app's). It writes only `<slug>-A-screen.png`, the screen alone (a
   phone at 3x, so the same pixels as an iPhone shot of the same `--screen`), and
   `<slug>-A-vs-ref.png`, a sheet with the variant, the reference and the two laid over each
   other. Read the sheet (the `-screen.png` beside the reference for small detail), list every difference (position, size, color, type, copy, missing
   pieces), fix, and shoot again until the overlay shows no double edges on the layout. Only
   then write the other variants.

The feature itself: write down in two or three lines what it must do. Every variant does all of it.

**A new product** (nothing ships yet, so there's no Current): import the project's tokens and
components if it has any (`@import` its token CSS in `src/theme.css`; import presentational
components through `@project/…` and add `@source "../../../src/components";` so their classes
are generated). With none, choose a restrained palette and type that fit the product, put them
in a `@theme {}` block, and tell the user they are invented.

## Right to left (Hebrew, Arabic, Persian, Urdu)

When the product reads right to left, every variant (Current and new designs alike) is built
right to left from its first line. Never draw it left to right and flip it, and never copy a
screenshot's pixel positions: RTL layout comes from the flow, not from coordinates.

- **Direction.** `dir="rtl"` and `lang` (`he`, `ar`, …) on each variant's root. Everything
  inside inherits it; set `dir` again only on an LTR island.
- **Logical sides only.** `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`/`text-end`,
  `rounded-s`/`rounded-e`, `border-s`/`border-e`; rows and grids already begin at the right.
  Never `ml`/`mr`/`pl`/`pr`/`left`/`right`/`text-left`/`text-right`, in classes or styles. Measure
  sizes and gaps off the screenshot and let the flow place them. Center with
  `left-1/2 -translate-x-1/2` (`start-1/2` with a translate goes wrong: translate is physical).
  Anything that really depends on the side (a scrim behind start-aligned text, a slide-in, a
  translate) gets both versions: `ltr:bg-linear-to-r rtl:bg-linear-to-l`.
- **What mirrors.** Reading order: the first tab, step, crumb, chip and carousel page sit at
  the right, and carousels start from their right end. Back points right and forward points
  left; `‹` is drill-in. Progress bars, sliders and rings fill from the right. A pushed page
  enters from the left, swipe back starts at the right edge, and a side drawer opens from the
  side its button is on. Icons that show a direction
  (arrows, chevrons, send, reply, undo/redo, trend charts, text alignment) flip with
  `rtl:-scale-x-100`.
- **What doesn't mirror (LTR islands).** Numbers joined by symbols (`0/10`, `3.1K`, `+2`,
  `4–10`), times, phone numbers, Latin names, code, URLs, emails, media controls (play, seek), clocks,
  checkmarks, logos, and a device's own status bar when the device's language reads LTR
  (follow the reference). Wrap an LTR run inside a sentence in
  `<bdi>` or `<span dir="ltr">` so punctuation and the words around it stay put. A plain number
  (`22.5`, `1,250`) needs no wrapper. Where the project writes ranges, units or dates its own
  way in its locale files (`8 עד 10 חזרות`), that wins over a symbol.
- **Type.** The project's own font for that script; confirm it has the glyphs, because a
  missing one falls back silently and changes every width. No letter-spacing or italics the app
  doesn't ship (Hebrew has no italics, spacing breaks Arabic joining), no `uppercase`. Arabic
  needs more line height than Latin. Truncation puts the ellipsis on the left; check what's cut.
- **Copy.** Real copy in the product's language, from the project's locale files where the
  string exists. New strings follow the project's rules (gender, register, punctuation). Never
  English placeholder text in an RTL screen.
- **Check.** `proto shoot` lists every physical side in an RTL prototype's files (margins,
  padding, insets, text alignment, corners, borders, gradients, translates, transform origins,
  image positions), skipping anything nested under a `dir="ltr"` element, centring, and classes
  chosen per direction (`rtl:…`). Each one it lists is a bug. It can't see an icon that should
  have flipped; check those in the shots. In every shot, check that text is ragged on the
  left, that numbers and Latin words sit right inside Hebrew lines, and that arrows point the
  way they go. A product that also ships LTR: flip the root's `dir` once and check the variant
  mirrors cleanly.

## 3. Pick genuinely different directions

N is 5 unless the user said otherwise ("/prototype 3 …"). Name each direction in a few words.
Vary something structural: where it lives, how it is triggered, how much it shows, the
interaction model. Two directions that differ only in color or spacing are one direction.
With a Current, the directions are B onwards, and each keeps Current's chrome and visual
language unless the direction is about them.

## 4. Add the prototype, then build each variant

```
proto add <slug> --title "Hero sections" --ask "<the user's request, in their words>" --variants "A:Current,B:Split media,C:Big price" [--kind phone] [--screen 402x874] [--from <slug>/<letter>]
```

`--from` is for a prototype built from part of an existing variant ("take the hero from
home B further", then "now just that hero's CTA"): `proto add hero --from home/B …`, then
`proto add cta --from hero/C …`. The page nests it under that variant in the sidebar, its
breadcrumbs show the chain it came from, and the parent's overview links to it. `--from home`
(no letter) nests it under the prototype as a whole.

This writes `src/protos/<slug>/meta.ts` and a "Building…" placeholder per variant, prints a
direct link to the prototype (`…/#/<slug>`), and the page jumps there by itself. Then replace each placeholder file whole, one at a time,
so the user sees them land:

- One file per variant, named by its letter: `A.tsx` (or `A.vue` in a Vue app). Names live in
  `meta.ts`. Never rename the files; letters run A … Z, then AA.
- Default export is the component. Its root fills the stage: `h-full` for anything that is one
  screen (app screens, drawers, sheets, overlays, a bar pinned to the bottom), `min-h-full`
  for a page that scrolls. `--kind phone` variants go in a phone frame whose screen is
  `--screen` (393×852 when not given).
- `position: fixed` inside a variant is pinned to the stage (or the phone frame), not the
  window, so drawers and sheets can use it.
- Make it real: realistic content (never lorem ipsum), working hover, focus, open and close,
  typing, empty and loading states where they matter. Local state is fine.
- Esc on a variant page goes back to the prototype's variants. A design that closes its own
  menu or dialog with Esc calls `e.preventDefault()` on that keydown, and the page stays.
- Responsive from 360px up, touch targets 36px (44px for primary actions), nothing hover-only.
- The shell's Light/Dark switch sets `.dark` on `<html>`. When the project has a dark mode,
  give the variants `dark:` classes; when it doesn't, leave them light (the shell around them
  still turns dark, which is expected).
- Small helpers can go in the same folder under lowercase names (`parts.tsx`).

**Show what's behind the clicks.** Whenever a variant has states a reviewer would otherwise
have to find (a menu, a drawer, a step, an empty state, anything one variant adds), list them in
`meta.ts` next to `variants`. The sidebar then shows each variant's line and its states under
it, and a ⋯ on the variant's row offers Autoplay, All states and Compare:

```
"about": {
  "A": "The baseline. Every action is one menu deep.",
  "B": "Looks the same as A at rest. Adds shortcuts inside."
},
"states": [
  { "id": "row-menu", "name": "Row menu", "click": ["[data-shoot=row-menu]"],
    "about": { "A": "Remind, download, mark paid or delete.", "B": "Adds Duplicate and Record payment." } },
  { "id": "payments", "name": "Payments", "click": ["[data-shoot=row]", "[data-shoot=payments]"], "only": ["B"],
    "about": { "B": "What is still owed, and when it was paid." } }
]
```

- `about` per variant: one line on what it is (the first variant) or how it differs from it.
- `click` is the selectors clicked in order, from rest, inside the variant: the same
  `data-shoot` attributes `proto shoot --click` uses. Every variant that has the state answers
  to the same selectors; a state only some variants have lists them in `only`.
- A state's `about`: the first variant's note says what the state is; the others say only what
  changed, or what it is when only they have it (both shown in amber). No note means unchanged.
- Put `data-diff` on what a variant adds; Compare outlines it.
- `proto add`, `pick` and `archive` keep these fields; edit `meta.ts` after `proto add`.

**Say what to type and try.** When getting through a variant takes something a reviewer can't
guess (a login, a code, a search that returns results), or it has scenarios, outside events or
limits worth knowing, report them with `useHints` from `src/hints.ts`, once, in the variant's
component. The page shows them in a Try it panel beside the design, where each value copies with
a click and Fill in types them into the design's fields; `proto shoot` leaves the panel out.

```
import { useHints } from '../../hints'

useHints([
  { kind: 'value', label: 'Email', value: 'mira@arc.audio', fill: 'input[type=email]' },
  { kind: 'value', label: '2FA code', value: () => codeNow(), fill: 'input[inputmode=numeric]', note: 'changes every 30 s' },
  { kind: 'try', text: 'Lock the account: 5 wrong passwords', done: misses >= 5, at: '[data-shoot=sign-in]' },
  { kind: 'try', text: 'Drag a mix onto the queue', done: queued, at: '[data-shoot=mix]', to: '[data-shoot=queue]' },
  { kind: 'switch', label: 'Scenario', options: ['Few', 'Empty', 'Busy', 'Can’t load'], value: scenario, set: setScenario },
  { kind: 'event', label: 'A new mix arrives', run: addMix },
  { kind: 'caveat', text: 'Audio doesn’t play in the prototype.' },
])
```

- Report what applies now, from the variant's own state: the values for the step on screen, and
  `done` once a thing to try has happened. The panel follows along.
- `fill` is a selector inside the variant; a function `value` is read every second.
- **Give each thing to try its spot.** Pointing at it in the panel (or tapping it on a phone)
  dims the design except where it happens, with a label: `at` is where you start, `to` where a
  drag ends. `act` says what you do there, `click` unless `to` makes it a `drag`; also
  `right-click`, `hover` and `type`. `label` replaces the act's word (`Type “rain”`, `Any of
  these`). `key: '⌘ K'` shows the keys to press, with or without a spot. `all: true` lights every
  match of `at`. A thing done in order (open a menu, then pick in it) is `steps: [{ at, label },
  …]`: the light moves to the last step on the page. Selectors are the same `data-shoot`
  attributes as states. A spot scrolled out of view is scrolled to; one that isn't on the page
  says so in the panel.
- Made-up demo data only, never real credentials: the page is served on the tailnet.
- A scenario switch is for the same design with other data (empty, busy, an error, a first
  visit); a different design is a variant.
- Vue: `useHints(() => [...])` in `<script setup>`. A variant with nothing to say makes no call.

## 5. Look at it, then iterate

```
proto shoot <slug> <slug>/A <slug>/B …          # lobby plus each variant, desktop and phone
proto shoot <slug>/A --theme=dark               # dark mode
proto shoot <slug>/B/row-menu                   # a state listed in meta.ts
proto shoot <slug>/B --click "[data-shoot=add]" # a state reached by clicking (repeatable)
proto shoot <slug>/A --ref <screenshot.png>     # beside and over a screenshot of the real screen
```

It prints absolute PNG paths (in the app's `.proto/shots/`), and for a right-to-left prototype
first lists any physical left or right in its files (see Right to left). Each shot is the stage
only (the design, or a lobby's grid), without the page's sidebar and bars, in a 1440×900 or a
390×844 page; a `--kind phone` prototype's variants get only the phone shot, where the phone
shows larger. For states behind an interaction, put `data-shoot="…"` on the
elements and list the state in `meta.ts`, or pass one `--click` per step. If a state's clicks
match nothing, `proto shoot` says so. Read every screenshot, all of one shoot's in a single
message (one Read per file, sent together), so they are compared side by side. For each
variant, note what breaks: alignment, hierarchy, clipped text, overflow on the phone shot,
weak affordance, too many steps. Fix it and push each variant further in its own direction
instead of letting them converge. Do 2 rounds unless the user asked for more, and shoot again
after the last round.

## 6. Pick one and say why

Choose the best variant yourself (never Current; if nothing beats it, say so). The reply always
includes:

1. The live link, at the top.
2. With a Current, its `-vs-ref.png` sheet first, so the user sees it matches. Then screenshots
   of the final variants as images with absolute paths
   (`![A · Split media](/abs/path/hero-A-desktop.png)`; `-mobile.png` for a phone prototype),
   plus the phone shot wherever a web variant changes noticeably on mobile.
3. One line per variant: its direction and its main weakness.
4. The pick and why it wins for this product and its users, in two to four sentences, and
   what you would take from the runners-up.

That is your recommendation; it marks nothing in the page. The page marks a pick only when the
user makes one (next section).

## When the user chooses

As soon as the user chooses a variant ("go with A", "A it is", "build B", "let's move forward
with C"), run `proto pick <slug> <letter>` before anything else, without asking. If they don't
name the prototype, it's the one you showed them last. The page then marks it (a check in the
sidebar, the variant first and outlined in its overview, the rest faded but still there) and
everything built from the prototype stays nested under it. Choosing again replaces the pick;
"undo that" is `proto pick <slug> --off`. A pick also makes that variant the one being worked
on (next section). Then do what they asked next, if anything.

A pick is not an archive: archive is for directions the user drops, and a picked prototype is
the one they will come back to.

If `proto up` or `proto shoot` failed, say so with the error instead of leaving things out.

## While the user works on one variant

After a pick the user usually asks for changes to one variant, round after round. The page pins
that variant in a "Working on" card at the top of the sidebar: one click (or W) brings the user
back to it from anywhere, and on it the card lists what they asked for, what was built from it,
its sibling variants (with Hide others) and the variants worked on before.

- **Each change the user asks for on it:** run `proto ask "<what they asked, a few words>"`
  before you edit, one line per request, in their terms ("Plus card: make it the obvious
  choice"), not yours.
- **When their request is about a different variant** ("now let's do D", "B's header, same
  idea"): `proto work <slug>/<letter> --ask "<what they asked>"` first. The card moves there and
  offers Undo; the old one goes under Before, with its history kept.
- **Only on purpose.** Don't move it for an edit in passing (a typo in A, a shared `parts.tsx`):
  those light the editing dot as always. A variant built with `proto add --from` becomes the
  working one only when the user starts asking for changes to it.
- `proto work` alone prints the current one; `proto work --off` clears it. Archiving its
  prototype clears it too.

## Comments from the page

The user can leave comments on the design in the page and send them, several at once. Each
send is a batch waiting for you in the app's inbox. You hear about it only while you listen, so
**at the end of every turn in a prototype session, listen**: run, in the background, with the
Bash tool's longest timeout (2 hours),

```
proto inbox --wait
```

It exits when a batch arrives (printing it), which wakes you; after 115 minutes with nothing
it exits saying so, and you listen again. If one is already listening it says so and exits;
leave it. `proto inbox` without `--wait` takes whatever is waiting now and tells you whether
something is listening.

Each comment prints its route (`<slug>/<letter>[/<state>]`), the user's words, the element
it is on (tag, text, `data-shoot` or selector, its box in CSS px from the variant's top left)
and any elements it tags, and the absolute path of each screenshot attached to it. Read every
screenshot. Then, per comment:

1. The same as a request typed in chat: `proto ask` (or `proto work … --ask`) in the user's
   words, then edit the variant.
2. `proto reply <batch>/<n> "<what you changed, one line>" --done`. The page shows it on the
   comment. A comment you can't act on gets a reply without `--done` saying why.
3. When the batch is handled, listen again.

## 7. Only if asked: build it

When the request says to implement the winner (the picked variant), build it in the real codebase with the
project's own components and patterns; the variant file is a starting point, not a paste.
Check it in the running app and reply with screenshots of the real feature.

## Only if asked: snapshots in a Claude Doc

When the user wants the prototypes in a doc or artifact to share, and the Claude Docs
connector is available (otherwise say so and offer the `proto shoot` images):

1. `proto snap <slug> …` (or `<slug>/<letter>`) renders each variant and writes it as a static
   HTML module to the app's `.proto/snaps/<slug>-<letter>.jsx`, plus `index.json` with a caption
   per variant. Web variants are captured at 672 px (the doc's column), phone variants in a
   frame. They are snapshots: light theme, no interaction.
2. Build the doc by the connector's own rules: one section per prototype, and per variant one
   widget whose `code` is that file's content exactly as written (read it, paste it whole),
   embedded with its caption.
3. Look at every widget with the connector's screenshot read before you hand the link over.
4. To refresh it later, run `proto snap` again and replace each widget's code with a `draft`
   (it publishes at once). Keep the doc link and the widget ids in `.proto/snaps/doc.json` so
   the next refresh updates the same doc instead of making a new one.

Each module is roughly 4 to 30 KB and goes through your tool calls, so snap only what was asked.

## Follow-up requests in the same session

| The user asks for | Do |
|---|---|
| More takes on an existing prototype ("two more heroes") | `proto add <same slug> --variants "D:…,E:…"` |
| Something new ("now the pricing page") | `proto add <new slug> …` |
| Variations of one variant ("B but with a map") | new letters in the same prototype, named after B |
| A part of one variant, explored on its own ("B's hero, but better") | `proto add <new slug> --from <slug>/B …` |
| A choice ("go with A", "build B") | `proto pick <slug> <letter>` first, then what they asked |
| A change to the variant being worked on ("make the price bigger") | `proto ask "…"`, then edit it |
| A change to another variant ("now D, same idea") | `proto work <slug>/<letter> --ask "…"`, then edit it |
| To drop a direction or prototype | `proto archive <slug>` (still reachable under Archived) |
| The prototypes in a doc to share | `proto snap`, then a Claude Doc (section above) |
| Comments sent from the page (a `proto inbox --wait` exited) | handle each, `proto reply … --done`, listen again |
| Prototypes for a different project | `proto up --project <dir>`: a separate app for that project |

## Lifecycle

| When | Do |
|---|---|
| The user says they are done, or the winner has been built into the codebase | `proto stop` (files kept; `proto up` brings it back on the same link) |
| The user asks to throw the prototypes away | `proto rm` |
| The user wants to keep them | `proto keep` (`--off` undoes) |
| The user wants their links | `proto ls` |

On its own: a server stops after 6 hours with no edits and no open page (30 minutes once every
prototype in the session is picked or archived), and every
`proto up` deletes sessions untouched for 14 days unless kept and drops leftover tailnet
rules (`proto gc` does the same on demand). The user can also Keep or Stop from the session
menu in the page.

## When something is off

- **No tailnet** (Tailscale missing or logged out): the link is local only; say so.
- **The link doesn't answer:** `proto up` prints the error and the local link; the server log
  is the app's `.proto/dev.log`.
- **A variant shows a red error box:** that variant threw. Fix the file; it re-renders.
- **`proto shoot` prints `slow …`:** a shot took over 3 s, and the line says which step took
  the time. Pass the line on to the user.
- **Don't edit** the app's `shell/`, `src/main.ts`, `src/registry.ts`, `src/mount.*` or `src/hints.ts`. If the
  shell itself misbehaves, say so; the template is `${CLAUDE_SKILL_DIR}/app/` (replaced on
  every plugin update, so a fix belongs upstream).

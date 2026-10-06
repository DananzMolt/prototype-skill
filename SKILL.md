---
name: prototype
description: Use when the user asks to prototype a UI, wants several versions or variations of a screen, component, section or interaction, or says "/prototype", "/prototype 3 <feature>", "show me options for…", "give me a few versions of…". Also use for follow-up requests in the same session ("now 5 variations of the hero", "add two more", "try it on the phone"). NOT for a single straightforward UI change, logic with no visible surface, or comparing libraries or APIs.
---

# Prototype

Each Claude Code session gets **one live prototype app**. The user gets its link once, at
the start, and watches every prototype appear and fill in as you write the files: the page
updates through hot module replacement, never a reload. Everything the user asks for in the
session lives in that one app: **session › prototype › variant**.

The app already has its navigation (breadcrumbs that open lobbies, jump menus, variant tabs,
edge arrows, a focus mode with a dock, light and dark, phone frames, "editing" dots). You
only write variant files.

`proto` below means `~/.claude/skills/prototype/scripts/proto.mjs` (executable; call it by
that path, not through a shell variable). It finds the session from `$CLAUDE_CODE_SESSION_ID`
and the project from the git root of the current folder. A subagent building into the main
session's app passes `--session <the main session id>` on every call.

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

## 2. Ground it in the real product

- **Tokens.** Put the project's look in the app's `src/theme.css`: an `@import` of the
  project's token CSS (relative path, e.g. `@import "../../../src/styles/tokens.css";`) or
  its values in a Tailwind `@theme {}` block. Variants style with Tailwind.
- **Components.** Variants may import the project's presentational components through
  `@project/…` (e.g. `import { Button } from '@project/src/components/Button'`). When you do,
  add `@source "../../../src/components";` (the folder they come from) to `src/theme.css` so
  their classes are generated.
- **No tokens or components** (a new or non-web project): choose a restrained palette and type
  that fit the product, put them in a `@theme {}` block in `src/theme.css`, and tell the user
  they are invented.
- Write down in two or three lines what the feature must do. Every variant does all of it.

## 3. Pick genuinely different directions

N is 5 unless the user said otherwise ("/prototype 3 …"). Name each direction in a few words.
Vary something structural: where it lives, how it is triggered, how much it shows, the
interaction model. Two directions that differ only in color or spacing are one direction.

## 4. Add the prototype, then build each variant

```
proto add <slug> --title "Hero sections" --ask "<the user's request, in their words>" \
  --variants "A:Split media,B:Big price,C:Map first" [--kind phone]
```

This writes `src/protos/<slug>/meta.ts` and a "Building…" placeholder per variant, prints a
direct link to the prototype (`…/#/<slug>`), and the page jumps there by itself. Then replace each placeholder file whole, one at a time,
so the user sees them land:

- One file per variant, named by its letter: `A.tsx` (or `A.vue` in a Vue app). Names live in
  `meta.ts`. Never rename the files; letters run A … Z, then AA.
- Default export is the component. Its root fills the stage: `h-full` for anything that is one
  screen (app screens, drawers, sheets, overlays, a bar pinned to the bottom), `min-h-full`
  for a page that scrolls. `--kind phone` variants go in a 393×852 phone frame.
- `position: fixed` inside a variant is pinned to the stage (or the phone frame), not the
  window, so drawers and sheets can use it.
- Make it real: realistic content (never lorem ipsum), working hover, focus, open and close,
  typing, empty and loading states where they matter. Local state is fine.
- Responsive from 360px up, touch targets 36px (44px for primary actions), nothing hover-only.
- The shell's Light/Dark switch sets `.dark` on `<html>`. When the project has a dark mode,
  give the variants `dark:` classes; when it doesn't, leave them light (the shell around them
  still turns dark, which is expected).
- Small helpers can go in the same folder under lowercase names (`parts.tsx`).

## 5. Look at it, then iterate

```
proto shoot <slug> <slug>/A <slug>/B …          # lobby plus each variant, desktop and phone
proto shoot <slug>/A --theme=dark               # dark mode
proto shoot <slug>/B --click "[data-shoot=add]" # a state reached by clicking (repeatable)
```

It prints absolute PNG paths (in the app's `.proto/shots/`). Phone shots are the whole page
at 390×844, shell bars included. For states behind an interaction, put `data-shoot="…"` on the
elements and pass one `--click` per step. Read every screenshot. For each
variant, note what breaks: alignment, hierarchy, clipped text, overflow on the phone shot,
weak affordance, too many steps. Fix it and push each variant further in its own direction
instead of letting them converge. Do 2 rounds unless the user asked for more, and shoot again
after the last round.

## 6. Pick one and say why

Choose the best variant yourself. The reply always includes:

1. The live link, at the top.
2. Screenshots of the final variants as images with absolute paths
   (`![A · Split media](/abs/path/hero-A-desktop.png)`), plus the phone shot wherever a variant
   is a phone screen or changes noticeably on mobile.
3. One line per variant: its direction and its main weakness.
4. The pick and why it wins for this product and its users, in two to four sentences, and
   what you would take from the runners-up.

If `proto up` or `proto shoot` failed, say so with the error instead of leaving things out.

## 7. Only if asked: build it

When the request says to implement the winner, build it in the real codebase with the
project's own components and patterns; the variant file is a starting point, not a paste.
Check it in the running app and reply with screenshots of the real feature.

## Follow-up requests in the same session

| The user asks for | Do |
|---|---|
| More takes on an existing prototype ("two more heroes") | `proto add <same slug> --variants "D:…,E:…"` |
| Something new ("now the pricing page") | `proto add <new slug> …` |
| Variations of one variant ("B but with a map") | new letters in the same prototype, named after B |
| To drop a direction or prototype | `proto archive <slug>` (still reachable under Archived) |
| Prototypes for a different project | `proto up --project <dir>`: a separate app for that project |

## Lifecycle

| When | Do |
|---|---|
| The user says they are done, or the winner has been built into the codebase | `proto stop` (files kept; `proto up` brings it back on the same link) |
| The user asks to throw the prototypes away | `proto rm` |
| The user wants to keep them | `proto keep` (`--off` undoes) |
| The user wants their links | `proto ls` |

On its own: a server stops after 6 hours with no edits and no open page, and every
`proto up` deletes sessions untouched for 14 days unless kept and drops leftover tailnet
rules (`proto gc` does the same on demand). The user can also Keep or Stop from the session
menu in the page.

## When something is off

- **No tailnet** (Tailscale missing or logged out): the link is local only; say so.
- **The link doesn't answer:** `proto up` prints the error and the local link; the server log
  is the app's `.proto/dev.log`.
- **A variant shows a red error box:** that variant threw. Fix the file; it re-renders.
- **Don't edit** the app's `shell/`, `src/main.ts`, `src/registry.ts` or `src/mount.*`. If the
  shell itself misbehaves, fix it in `~/.claude/skills/prototype/app/` and say so.

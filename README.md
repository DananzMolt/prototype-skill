# Prototype

A Claude Code plugin that turns "show me a few versions of this" into real, clickable variants you watch being built, live, in one app per session.

![Three hero variants appearing one after another as Claude writes them](docs/images/live.gif)

- **One link per session.** Claude starts a small app before it designs anything and sends you the link. It opens on your phone too.
- **Live, no reloads.** Every variant shows up as a placeholder and fills in through hot module replacement the moment its file is written.
- **Built from your product.** The app follows your stack (React or Vue), uses your design tokens and can import your components, so the winner is close to drop-in.
- **A pick, not a pile.** Claude screenshots every variant, fixes what it sees over two rounds, then recommends one and says why.

## Install

In Claude Code:

```
/plugin marketplace add DananzMolt/prototype-skill
/plugin install prototype@prototype-skill
```

To get updates automatically, open `/plugin`, go to **Marketplaces**, pick `prototype-skill` and choose **Enable auto-update**. Otherwise, to get the latest, choose **Update marketplace** there, or run `claude plugin update prototype@prototype-skill` in a terminal.

**Runs on** macOS, Linux and Windows (PowerShell or Git Bash). **Needs** Node 22+, pnpm or npm, and Chrome for screenshots (Chromium or Edge work too; set `CHROME` to a browser's path to pick one). For the link on your phone, [Tailscale](https://tailscale.com) too.

<details>
<summary>Without the plugin system</summary>

Clone it as a personal skill and update it with `git pull`:

```sh
git clone https://github.com/DananzMolt/prototype-skill ~/.claude/skills/prototype
```

In PowerShell:

```powershell
git clone https://github.com/DananzMolt/prototype-skill "$HOME\.claude\skills\prototype"
```
</details>

## Use

```
/prototype the checkout page
/prototype 3 empty states for the inbox
/prototype a pricing section, then build the best one
```

Or just ask: "show me a few versions of the settings drawer". `/prototype` works when nothing else uses the name; `/prototype:prototype` always does.

Keep going in the same session and everything lands in the same app, under the same link:

| You say | You get |
|---|---|
| "two more heroes" | D and E next to A, B, C |
| "now the pricing page" | a new prototype in the same app |
| "B, but with a map" | new variants built from B |
| "take B's hero further" | a new prototype nested under B, then its CTA under that |
| "try it on the phone" | the variants in phone frames |
| "build the winner" | the real feature in your codebase, with screenshots |
| "go with A" | A is marked as picked in the page, the others stay |
| "put these in a doc I can share" | a Claude Doc with a static snapshot of each variant |

## What you get

### Every variant is a real page

Breadcrumbs go session › prototype › variant. Each name opens an overview, each chevron jumps anywhere, and the tabs or the arrow keys step through variants. A sidebar shows the same thing as a tree, with a prototype built from part of another variant (its hero, then that hero's CTA) nested under the variant it came from. Hide it with ⌘\ for breadcrumbs alone.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/menu-dark.png">
  <img alt="A variant with its breadcrumbs, tabs and jump menu" src="docs/images/menu-light.png">
</picture>

### Compare them side by side, or at full size

The prototype page shows every variant as a live thumbnail, or one after another at full size so you can click through each.

<p>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/grid-dark.png">
  <img alt="Variants in a grid" src="docs/images/grid-light.png" width="49%">
</picture>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/fullsize-dark.png">
  <img alt="Phone variants at full size" src="docs/images/fullsize-light.png" width="49%">
</picture>
</p>

### Focus mode

Press `F` and the chrome disappears. A small dock stays at the bottom and grows as your pointer gets close; edge arrows appear near the sides.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/focus-dark.png">
  <img alt="Focus mode with the dock" src="docs/images/focus-light.png">
</picture>

### On your phone

The link works on any device on your tailnet, and phone prototypes sit in a real 393×852 frame.

<p>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/phone-dark.png">
  <img alt="A phone prototype on a phone" src="docs/images/phone-light.png" width="32%">
</picture>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/session-dark.png">
  <img alt="The session overview with every prototype" src="docs/images/session-light.png" width="66%">
</picture>
</p>

## How Claude uses it

1. Starts the session app and sends you the link.
2. Reads your tokens and nearest existing screens, and writes down what the feature must do.
3. Picks genuinely different directions (where it lives, how it's triggered, how much it shows), five unless you say otherwise.
4. Writes each variant into the app; you watch them land.
5. Screenshots every variant on desktop and phone, fixes what breaks, two rounds.
6. Recommends one, says why, and what to take from the others.

## Where things go

Each session's app lives in `<project>/.prototypes/<session>/`, git-ignored, with its own dependencies. Your project's files are never touched.

| When | What happens |
|---|---|
| No edits and no open page for 6 hours | the server stops; asking again restarts it on the same link |
| A session untouched for 14 days | it's deleted, unless you pressed **Keep** in the session menu |
| You say you're done | Claude stops it; the files stay |

## What's inside

| Path | |
|---|---|
| `SKILL.md` | What Claude does, step by step |
| `scripts/proto.mjs` | Session manager: `up`, `add`, `shoot`, `snap`, `archive`, `stop`, `rm`, `keep`, `ls`, `gc` |
| `scripts/shoot.mjs` | Desktop and phone screenshots through headless Chrome |
| `scripts/snap.mjs` | Static HTML snapshots of variants, for sharing in a Claude Doc |
| `scripts/chrome.mjs` | Finds Chrome, Chromium or Edge for the two above |
| `app/` | The template each session app is copied from (Vite, Tailwind, the shell, React and Vue adapters) |
| `.claude-plugin/` | Plugin and marketplace manifests |

## License

MIT

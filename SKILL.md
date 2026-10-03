---
name: prototype
description: Explore a UI feature by building N different versions of it (default 5) side by side in one HTML file, previewing them, improving them over a few rounds, then picking the best one and saying why. Always replies with a tailnet link to the page and screenshots of every version. Use for "/prototype", "/prototype 3 <feature>", "prototype <feature>", "show me options for <feature>", "give me a few versions of this screen/component/interaction". Ends with a recommendation; only builds the winner into the real codebase when the request says so ("then implement the best one"). NOT for a single straightforward UI change, for logic with no visible surface, or for comparing libraries or APIs.
---

# Prototype

Turn one feature idea into several real, clickable versions, look at them the way a designer
would, make them better, and pick one. The value is in versions that are **actually different**:
five shades of the same layout is one option, not five.

## Inputs

Read from the request:

- **N**: number of versions. Default 5. Accept "/prototype 3 ..." or "three options".
- **Feature**: what is being designed. If it is missing, ask one short question.
- **Extras** the user may have added in the same prompt, and should be followed:
  - "research online" / "look at how others do it" → search for real examples first
    (Mobbin via the `mobbin-search` skill when it is available, otherwise the web).
  - "look at Slack / Docs / the issue" → read those sources for constraints before designing.
  - "implement the best one", "verify", "open a PR" → continue past the pick (step 6).

## 1. Ground it in the real product

Before drawing anything, read enough of the project to make the versions look like they belong:

- The design tokens: colors, type scale, radii, spacing, dark mode (CSS variables, Tailwind
  config, theme file).
- The closest existing screen or component to the feature, and the component library in use.
- Any constraints in the request or the linked issue.

Write down, in two or three lines, what the feature must do. Every version must do all of it.

## 2. Pick N genuinely different directions

Name each direction in a few words before building it. Vary something structural between them,
for example:

- Where it lives (inline, popover, side panel, full screen, command palette)
- How it is triggered (always visible, on hover, on a key, on demand)
- How much it shows (minimal vs. rich, progressive disclosure vs. all at once)
- Interaction model (click, drag, type-ahead, direct manipulation)

If two directions differ only in color or spacing, replace one.

## 3. Build them in one HTML file

Start from `template.html` in this skill's folder. Copy it to
`<project root>/.prototypes/<feature-slug>.html`, and add `.prototypes/` to `.git/info/exclude`
so it never gets committed. Outside a git repo, use `./.prototypes/` in the current directory.

The template already has the page frame. Keep it working:

- **Switcher.** One `<section class="version" data-version="A" data-name="...">` per version.
  Tabs are built from the sections, plus an "All" tab. The URL hash selects a version (`#B`,
  `#all`), which the screenshot script relies on. `?theme=dark` and `?scale=75` set the
  initial theme and phone scale.
- **Phone screens.** When a version is a mobile app screen, wrap each screen in a `.phone`
  frame (393×852, as in the template). The 100% / 75% / 50% scale control then appears for
  that version. Until the user picks a scale, it uses the largest one that fits the screen,
  so on a phone a 393px frame shows at 75% instead of overflowing. Several screens of one
  flow go side by side in the `.phone-row` and wrap on narrow screens.
- **Fully responsive.** The whole page must work from 360px wide up, with no sideways
  scrolling. The header wraps and the tabs scroll sideways on a phone. Web and desktop
  versions must reflow too (stack columns, full-width controls), touch targets are at
  least 36px (44px for primary actions), nothing depends on hover alone, and safe-area
  insets are respected.

Inside each version:

- Use the project's real tokens copied into `tailwind.config`. Style with Tailwind through the
  Play CDN unless the project clearly uses something else.
- Make it **interactive**: real hover, focus, open/close, typing, empty and loading states
  where they matter. Use realistic content, never lorem ipsum.
- No build step. Opening the file in a browser must be enough.

## 4. Publish, look at it, then iterate

Publish the file on the tailnet right away:

```
~/.claude/skills/prototype/scripts/publish.sh <project>/.prototypes/<slug>.html
```

It prints a URL like `https://<machine>.<tailnet>.ts.net:9440/<project>/<slug>.html`, which
opens on any device on the tailnet, including the user's phone. The script starts a small
local server on port 8940 if one isn't running, adds a `tailscale serve` rule on port 9440
if it's missing, and fails loudly if the URL doesn't answer. Ports can be changed with
`PROTOTYPE_LOCAL_PORT` and `PROTOTYPE_TAILNET_PORT`. The file is served live, so later edits
show on reload with no re-publish.

Take screenshots of every version at desktop (1440×900) and phone (390×844) size:

```
node ~/.claude/skills/prototype/scripts/shoot.mjs http://127.0.0.1:8940/<project>/<slug>.html \
  <project>/.prototypes/<slug>-shots A B C D E
```

Add `--theme=dark` for dark-mode shots, or `--scale=50` to check phone frames at another
scale. Shots are named `<version>-<desktop|mobile>[-dark][-50pct].png`.

Read every screenshot and actually look at it. For each version, note what breaks:
alignment, hierarchy, clipped text, overflow on the phone shot, weak affordance, too many
steps. Fix those, and push each version further in its own direction rather than letting
them converge. Do **2 rounds** by default (more if the user asked). Re-shoot after the last
round so the screenshots match the final file.

## 5. Pick one and say why

Choose the best version yourself instead of handing the choice back. The response must
always include:

1. **The tailnet URL** from `publish.sh`, as a link at the top.
2. **Screenshots** of the final versions, embedded as images with absolute paths
   (`![A · Inline chip](/abs/path/A-desktop.png)`). Show each version's desktop shot, plus its
   phone shot wherever the version is a phone screen or changes noticeably on mobile.
3. One line per version: its direction and its main weakness.
4. **The pick**, and why it wins for this product and its users, in two to four sentences.
   Name what you would take from the runners-up, if anything.

If publishing or screenshots failed, say so plainly with the error instead of leaving
them out. Design is a judgment call, so state the pick as a recommendation the user can
overrule.

## 6. Only if asked: build it

When the request asked to implement the winner:

- Build it in the real codebase using the project's own components and patterns, not by pasting
  the prototype markup.
- Match the existing styles exactly; check it in the running app, not just the HTML.
- If asked to verify or open a PR, attach a screenshot or short recording of the real feature.

Leave the `.prototypes/` file in place so the alternatives stay available for comparison,
and reply with screenshots of the real feature as well.

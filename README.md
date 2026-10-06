# prototype

A Claude Code skill that turns "show me a few versions of this" into one live app per session. You get a link at the start and watch every prototype appear and fill in as Claude writes it: hot module replacement, no reloads. Everything you ask for in the session lives in that one app, as session › prototype › variant, with breadcrumbs that open lobbies, jump menus, variant tabs, edge arrows and a focus mode.

The app follows your project's stack (React or Vue; anything else gets React) and can use your design tokens and import your components, so the winning variant is close to drop-in.

## Install

```sh
git clone https://github.com/DananzMolt/prototype-skill ~/.claude/skills/prototype
```

Needs Node 22+, pnpm or npm, and Google Chrome (for screenshots). For the link on your phone, Tailscale too (macOS app or CLI).

## Use

```
/prototype <feature>
/prototype 3 <feature>
/prototype <feature>, research online, then implement the best one
```

Follow-ups in the same session ("now five hero variations", "add two more") land in the same app, under the same link.

## Where things go

Each session's app lives in `<project>/.prototypes/<session>/`, git-ignored, with its own dependencies. A server stops itself after 6 hours with no edits and no open page; sessions untouched for 14 days are deleted unless you press Keep. `scripts/proto.mjs` manages all of it (`up`, `add`, `shoot`, `stop`, `rm`, `keep`, `ls`, `gc`).

## License

MIT

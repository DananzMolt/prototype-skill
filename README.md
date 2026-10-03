# prototype

A Claude Code skill that builds several versions of a UI feature side by side in one HTML page, improves them over a few rounds, and picks the best one. Every run replies with a Tailscale link to the page and screenshots of each version.

## Install

```sh
git clone https://github.com/DananzMolt/prototype-skill ~/.claude/skills/prototype
```

Needs Google Chrome, Node 22+ and Python 3. For the phone link, Tailscale too (macOS app or CLI).

## Use

```
/prototype <feature>
/prototype 3 <feature>
/prototype <feature>, research online, then implement the best one
```

## License

MIT

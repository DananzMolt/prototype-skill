#!/usr/bin/env bash
# Publish a prototype HTML file on the tailnet and print its URL.
# Usage: publish.sh <project>/.prototypes/<slug>.html
set -euo pipefail

FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
[ -f "$FILE" ] || { echo "publish: no such file: $1" >&2; exit 1; }

LOCAL_PORT="${PROTOTYPE_LOCAL_PORT:-8940}"
TAILNET_PORT="${PROTOTYPE_TAILNET_PORT:-9440}"
ROOT="$HOME/.prototypes-serve"
PROTO_DIR="$(dirname "$FILE")"
PROJECT="$(basename "$(dirname "$PROTO_DIR")")"

# Each project's .prototypes/ folder is linked under one served root.
mkdir -p "$ROOT"
ln -sfn "$PROTO_DIR" "$ROOT/$PROJECT"
echo ok > "$ROOT/.prototype-server"

# The Tailscale app is sandboxed and answers 403 when it serves a folder
# directly, so a local server holds the files and Tailscale proxies to it.
if ! curl -fsS "http://127.0.0.1:$LOCAL_PORT/.prototype-server" >/dev/null 2>&1; then
  if lsof -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "publish: port $LOCAL_PORT is taken by something else; set PROTOTYPE_LOCAL_PORT" >&2
    exit 1
  fi
  nohup python3 -m http.server "$LOCAL_PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -fsS "http://127.0.0.1:$LOCAL_PORT/.prototype-server" >/dev/null 2>&1 && break
    sleep 0.3
  done
fi

HOST="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
if ! tailscale serve status 2>/dev/null | grep -q "$HOST:$TAILNET_PORT"; then
  tailscale serve --bg --https="$TAILNET_PORT" "http://127.0.0.1:$LOCAL_PORT" >/dev/null 2>&1
fi

URL="https://$HOST:$TAILNET_PORT/$PROJECT/$(basename "$FILE")"
if ! curl -fsS -o /dev/null --max-time 10 "$URL"; then
  echo "publish: $URL did not answer" >&2
  exit 1
fi
echo "$URL"

#!/bin/bash
# Applies the screen brightness chosen on the desk hub (server 2).
# Started from /var/lib/hub/kiosk-env, so it lives and dies with the kiosk service.

PIDFILE=/run/hub-brightness.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then exit 0; fi
echo $$ > "$PIDFILE"

HUB_HOST=10.42.1.6
HUB_PORT=8787
BL=/sys/class/backlight/backlight
MAX=$(cat "$BL/max_brightness")
# nocturned owns the backlight; with auto=true it follows the light sensor and overrides us
NOCTURNE_CFG=/var/lib/brightness.json
applied=""

# Save the level where nocturned keeps it, restart nocturned so it loads it, then set the backlight.
apply() {
  local raw=$(( $1 * MAX / 100 ))
  printf '{"auto":false,"brightness":%d}' "$raw" > "$NOCTURNE_CFG.tmp" && mv "$NOCTURNE_CFG.tmp" "$NOCTURNE_CFG"
  if [ "$(cat "$BL/brightness")" != "$raw" ] || [ -z "$applied" ]; then
    systemctl restart nocturned
    sleep 2
  fi
  echo "$raw" > "$BL/brightness"
}

[ -f "$NOCTURNE_CFG.orig" ] || cp "$NOCTURNE_CFG" "$NOCTURNE_CFG.orig" 2>/dev/null

fetch_pct() {
  exec 3<>"/dev/tcp/$HUB_HOST/$HUB_PORT" || return 1
  printf 'GET /api/brightness HTTP/1.0\r\nHost: hub\r\n\r\n' >&3
  timeout 3 cat <&3 | tail -n 1
  exec 3>&-
}

while :; do
  pct=$(fetch_pct 2>/dev/null)
  if [[ "$pct" =~ ^[0-9]+$ ]] && [ "$pct" -ge 5 ] && [ "$pct" -le 100 ] && [ "$pct" != "$applied" ]; then
    apply "$pct" && applied=$pct
  fi
  sleep 2
done
